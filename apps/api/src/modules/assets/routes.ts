import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { audit } from "../../lib/audit.js";
import { randomToken } from "../../lib/crypto.js";
import { prisma } from "../../lib/db.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { isNonPublicIp, normalizeHostname, normalizeIp, registrableDomain } from "../../lib/net.js";
import { cleanText, pagination, parse, uuidParam } from "../../lib/validation.js";
import { modulesFor } from "../../scanner/engine.js";
import { assetHost, establishAuthorization, TXT_PREFIX } from "./authorization.js";

const assetType = z.enum(["DOMAIN", "SUBDOMAIN", "IP_ADDRESS", "APPLICATION", "OTHER"]);
const severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
const tags = z.array(cleanText(32).pipe(z.string().min(1).regex(/^[\w.-]+$/, "Tags may contain letters, digits, . _ -"))).max(10);

const createSchema = z.object({
  type: assetType,
  value: z.string().trim().min(1).max(2048),
  label: cleanText(120).optional(),
  description: cleanText(1000).optional(),
  tags: tags.default([]),
  criticality: severity.default("MEDIUM"),
});

const updateSchema = z.object({
  label: cleanText(120).nullable().optional(),
  description: cleanText(1000).nullable().optional(),
  tags: tags.optional(),
  criticality: severity.optional(),
  monitoringEnabled: z.boolean().optional(),
});

const listQuery = pagination.extend({
  type: assetType.optional(),
  status: z.enum(["PENDING", "VERIFIED", "REVOKED"]).optional(),
  q: cleanText(100).optional(),
});

const attestSchema = z.object({
  authorizerName: cleanText(120).pipe(z.string().min(2)),
  scopeNote: cleanText(1000).pipe(z.string().min(10, "Describe the scope of the permission (min. 10 characters)")),
  validUntil: z.coerce.date(),
  confirm: z.literal(true, { errorMap: () => ({ message: "You must confirm that you are authorized" }) }),
});

/** Validate and normalize an asset value for its type. */
export function normalizeAssetValue(type: z.infer<typeof assetType>, raw: string): string {
  switch (type) {
    case "DOMAIN": {
      const host = normalizeHostname(raw);
      if (!host) throw badRequest("Enter a valid public domain name, e.g. example.com");
      if (registrableDomain(host) !== host) {
        throw badRequest("This looks like a subdomain. Add the registrable domain, or choose the Subdomain type.");
      }
      return host;
    }
    case "SUBDOMAIN": {
      const host = normalizeHostname(raw);
      if (!host) throw badRequest("Enter a valid public hostname, e.g. app.example.com");
      if (registrableDomain(host) === host) throw badRequest("This is a registrable domain. Choose the Domain type.");
      return host;
    }
    case "IP_ADDRESS": {
      const ip = normalizeIp(raw);
      if (!ip) throw badRequest("Enter a valid IPv4 or IPv6 address");
      if (isNonPublicIp(ip)) throw badRequest("Private, loopback and reserved addresses cannot be monitored");
      return ip;
    }
    case "APPLICATION": {
      let url: URL;
      try {
        url = new URL(raw.trim());
      } catch {
        throw badRequest("Enter a full URL, e.g. https://app.example.com");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") throw badRequest("Only http(s) URLs are supported");
      if (url.username || url.password) throw badRequest("URLs must not contain credentials");
      const host = normalizeHostname(url.hostname);
      if (!host) throw badRequest("The URL must use a public hostname");
      url.hostname = host;
      url.hash = "";
      url.search = "";
      return url.toString();
    }
    case "OTHER": {
      const value = raw.trim();
      if (value.length > 200 || /[\x00-\x1F\x7F]/.test(value)) throw badRequest("Invalid asset identifier");
      return value;
    }
  }
}

function verificationInstructions(asset: { type: string; value: string; verificationToken: string }) {
  const host = assetHost(asset as never);
  return {
    txtRecordName: host,
    txtRecordValue: `${TXT_PREFIX}${asset.verificationToken}`,
    parentDomain: host ? registrableDomain(host) : null,
    attestationAllowed: asset.type !== "DOMAIN",
  };
}

export async function assetRoutes(app: FastifyInstance) {
  app.get("/assets", { preHandler: requireAuth("assets:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const q = parse(listQuery, req.query);
    const where = {
      organizationId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { authorizationStatus: q.status } : {}),
      ...(q.q ? { OR: [{ value: { contains: q.q, mode: "insensitive" as const } }, { label: { contains: q.q, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { _count: { select: { findings: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } } } } },
      }),
      prisma.asset.count({ where }),
    ]);
    const ids = items.map((a) => a.id);
    const worst = await prisma.finding.groupBy({
      by: ["assetId", "severity"],
      where: { assetId: { in: ids }, status: { in: ["OPEN", "IN_PROGRESS"] } },
      _count: true,
    });
    return {
      items: items.map(({ verificationToken: _t, _count, ...a }) => ({
        ...a,
        openFindings: _count.findings,
        severityCounts: Object.fromEntries(worst.filter((w) => w.assetId === a.id).map((w) => [w.severity, w._count])),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.post("/assets", { preHandler: requireAuth("assets:write") }, async (req, reply) => {
    const auth = getAuth(req);
    const body = parse(createSchema, req.body);
    const value = normalizeAssetValue(body.type, body.value);
    const exists = await prisma.asset.findUnique({
      where: { organizationId_type_value: { organizationId: auth.organizationId, type: body.type, value } },
    });
    if (exists) throw conflict("This asset is already in your inventory");

    let asset = await prisma.asset.create({
      data: {
        organizationId: auth.organizationId,
        type: body.type,
        value,
        label: body.label,
        description: body.description,
        tags: body.tags,
        criticality: body.criticality,
        verificationToken: randomToken(18),
        createdById: auth.user.id,
      },
    });
    // Subdomains of verified domains and IPs they resolve to are authorized immediately.
    if (body.type !== "DOMAIN" && body.type !== "OTHER") {
      const method = await establishAuthorization(asset);
      if (method) {
        asset = await prisma.asset.update({
          where: { id: asset.id },
          data: { authorizationStatus: "VERIFIED", verificationMethod: method, verifiedAt: new Date() },
        });
      }
    }
    await audit(req, { action: "asset.create", resourceType: "asset", resourceId: asset.id, metadata: { type: asset.type, value, status: asset.authorizationStatus } });
    const { verificationToken: _t, ...rest } = asset;
    return reply.code(201).send({ ...rest, verification: verificationInstructions(asset) });
  });

  app.get("/assets/:id", { preHandler: requireAuth("assets:read") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const asset = await prisma.asset.findFirst({
      where: { id, organizationId: auth.organizationId },
      include: {
        authorizations: { orderBy: { createdAt: "desc" } },
        observations: true,
        scans: { orderBy: { queuedAt: "desc" }, take: 10 },
        changeEvents: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!asset) throw notFound("Asset");
    const findingCounts = await prisma.finding.groupBy({
      by: ["severity"],
      where: { assetId: id, status: { in: ["OPEN", "IN_PROGRESS"] } },
      _count: true,
    });
    const { verificationToken, ...rest } = asset;
    const canManage = auth.role === "OWNER" || auth.role === "SECURITY_ADMIN";
    return {
      ...rest,
      observations: Object.fromEntries(asset.observations.map((o) => [o.moduleId, { data: o.data, updatedAt: o.updatedAt }])),
      severityCounts: Object.fromEntries(findingCounts.map((f) => [f.severity, f._count])),
      applicableModules: modulesFor(asset).map((m) => ({ id: m.id, name: m.name, description: m.description })),
      // The verification token is only useful to people who can act on it.
      verification: canManage ? verificationInstructions({ ...asset, verificationToken }) : null,
    };
  });

  app.patch("/assets/:id", { preHandler: requireAuth("assets:write") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(updateSchema, req.body);
    const result = await prisma.asset.updateMany({ where: { id, organizationId: auth.organizationId }, data: body });
    if (result.count === 0) throw notFound("Asset");
    await audit(req, { action: "asset.update", resourceType: "asset", resourceId: id, metadata: { fields: Object.keys(body) } });
    return { ok: true };
  });

  app.delete("/assets/:id", { preHandler: requireAuth("assets:delete") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const asset = await prisma.asset.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!asset) throw notFound("Asset");
    await prisma.asset.delete({ where: { id } });
    await audit(req, { action: "asset.delete", resourceType: "asset", resourceId: id, metadata: { type: asset.type, value: asset.value } });
    return { ok: true };
  });

  app.post(
    "/assets/:id/verify",
    { preHandler: requireAuth("assets:write"), config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const auth = getAuth(req);
      const { id } = parse(uuidParam, req.params);
      const asset = await prisma.asset.findFirst({ where: { id, organizationId: auth.organizationId } });
      if (!asset) throw notFound("Asset");
      const method = await establishAuthorization(asset);
      if (!method) {
        await audit(req, { action: "asset.verify", outcome: "failure", resourceType: "asset", resourceId: id });
        return {
          verified: false,
          message: asset.type === "DOMAIN"
            ? "The verification TXT record was not found. DNS changes can take a few minutes to propagate."
            : "Could not verify: no TXT record, verified parent domain, or active authorization attestation was found.",
        };
      }
      await prisma.asset.update({
        where: { id },
        data: { authorizationStatus: "VERIFIED", verificationMethod: method, verifiedAt: new Date() },
      });
      await audit(req, { action: "asset.verify", resourceType: "asset", resourceId: id, metadata: { method } });
      return { verified: true, method };
    },
  );

  app.post("/assets/:id/attestations", { preHandler: requireAuth("assets:attest") }, async (req, reply) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(attestSchema, req.body);
    const asset = await prisma.asset.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!asset) throw notFound("Asset");
    if (asset.type === "DOMAIN") throw badRequest("Domains must be verified with a DNS TXT record");
    const maxDate = new Date(Date.now() + 366 * 86_400_000);
    if (body.validUntil <= new Date() || body.validUntil > maxDate) {
      throw badRequest("Authorization must expire within the next 12 months");
    }
    const attestation = await prisma.assetAuthorization.create({
      data: {
        assetId: id,
        attestedById: auth.user.id,
        authorizerName: body.authorizerName,
        scopeNote: body.scopeNote,
        validUntil: body.validUntil,
      },
    });
    await prisma.asset.update({
      where: { id },
      data: { authorizationStatus: "VERIFIED", verificationMethod: "ATTESTATION", verifiedAt: new Date() },
    });
    await audit(req, {
      action: "asset.attest",
      resourceType: "asset",
      resourceId: id,
      metadata: { attestationId: attestation.id, authorizerName: body.authorizerName, validUntil: body.validUntil.toISOString() },
    });
    return reply.code(201).send(attestation);
  });

  app.delete("/assets/:id/attestations/:attestationId", { preHandler: requireAuth("assets:attest") }, async (req) => {
    const auth = getAuth(req);
    const { id, attestationId } = parse(z.object({ id: z.string().uuid(), attestationId: z.string().uuid() }), req.params);
    const asset = await prisma.asset.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!asset) throw notFound("Asset");
    const revoked = await prisma.assetAuthorization.updateMany({
      where: { id: attestationId, assetId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw notFound("Attestation");
    const method = await establishAuthorization(asset);
    await prisma.asset.update({
      where: { id },
      data: method
        ? { verificationMethod: method }
        : { authorizationStatus: "REVOKED", verificationMethod: null, verifiedAt: null },
    });
    await audit(req, { action: "asset.attestation_revoke", resourceType: "asset", resourceId: id, metadata: { attestationId } });
    return { ok: true, stillAuthorized: Boolean(method) };
  });
}
