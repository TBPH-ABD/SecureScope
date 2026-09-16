import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "../../lib/db.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { pagination, parse, uuidParam } from "../../lib/validation.js";
import { enqueueScan } from "../../jobs/queue.js";
import { modulesFor } from "../../scanner/engine.js";
import { SCANNER_MODULES } from "../../scanner/modules/index.js";

const createSchema = z.object({
  assetId: z.string().uuid(),
  modules: z.array(z.string().max(40)).max(20).default([]),
});

export async function scanRoutes(app: FastifyInstance) {
  app.get("/scanner/modules", { preHandler: requireAuth("scans:read") }, async () =>
    SCANNER_MODULES.map((m) => ({ id: m.id, name: m.name, description: m.description, appliesTo: m.appliesTo })),
  );

  app.get("/scans", { preHandler: requireAuth("scans:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const q = parse(pagination.extend({ assetId: z.string().uuid().optional() }), req.query);
    const where = { organizationId, ...(q.assetId ? { assetId: q.assetId } : {}) };
    const [items, total] = await Promise.all([
      prisma.scan.findMany({
        where,
        orderBy: { queuedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { asset: { select: { id: true, value: true, type: true } } },
      }),
      prisma.scan.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get("/scans/:id", { preHandler: requireAuth("scans:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const scan = await prisma.scan.findFirst({
      where: { id, organizationId },
      include: {
        asset: { select: { id: true, value: true, type: true } },
        moduleRuns: { orderBy: { moduleId: "asc" } },
      },
    });
    if (!scan) throw notFound("Scan");
    return scan;
  });

  app.post(
    "/scans",
    { preHandler: requireAuth("scans:run"), config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const auth = getAuth(req);
      const body = parse(createSchema, req.body);
      const asset = await prisma.asset.findFirst({ where: { id: body.assetId, organizationId: auth.organizationId } });
      if (!asset) throw notFound("Asset");

      if (asset.authorizationStatus !== "VERIFIED") {
        await audit(req, { action: "scan.request", outcome: "denied", resourceType: "asset", resourceId: asset.id, metadata: { reason: "not_verified" } });
        throw new AppError(403, "ASSET_NOT_AUTHORIZED", "This asset has not been verified. Prove ownership or record an authorization before scanning.");
      }
      const available = modulesFor(asset).map((m) => m.id);
      if (available.length === 0) throw badRequest("No scanner modules apply to this asset type");
      const unknown = body.modules.filter((m) => !available.includes(m));
      if (unknown.length) throw badRequest(`Modules not applicable to this asset: ${unknown.join(", ")}`);

      const running = await prisma.scan.count({ where: { assetId: asset.id, status: { in: ["QUEUED", "RUNNING"] } } });
      if (running) throw conflict("A scan is already queued or running for this asset");

      const scan = await prisma.scan.create({
        data: {
          organizationId: auth.organizationId,
          assetId: asset.id,
          requestedById: auth.user.id,
          modules: body.modules,
          trigger: "MANUAL",
        },
      });
      await enqueueScan(scan.id);
      await audit(req, { action: "scan.request", resourceType: "scan", resourceId: scan.id, metadata: { assetId: asset.id, asset: asset.value, modules: body.modules } });
      return reply.code(202).send(scan);
    },
  );
}
