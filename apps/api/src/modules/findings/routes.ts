import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { can } from "../../auth/permissions.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "../../lib/db.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { cleanText, pagination, parse, uuidParam } from "../../lib/validation.js";
import { snapshotScore } from "../../scanner/engine.js";

const severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
const status = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED"]);
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === "string" && v ? v.split(",") : undefined), z.array(item).optional());

const listQuery = pagination.extend({
  severity: csv(severity),
  status: csv(status),
  assetId: z.string().uuid().optional(),
  q: cleanText(100).optional(),
  sort: z.enum(["severity", "lastSeen", "firstSeen"]).default("severity"),
});

const updateSchema = z
  .object({
    status: status.optional(),
    acceptedReason: cleanText(1000).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => b.status !== "ACCEPTED" || (b.acceptedReason && b.acceptedReason.length >= 10), {
    message: "A justification (min. 10 characters) is required to accept a risk",
    path: ["acceptedReason"],
  });

const commentSchema = z.object({ body: cleanText(4000).pipe(z.string().min(1)) });

export async function findingRoutes(app: FastifyInstance) {
  app.get("/findings", { preHandler: requireAuth("findings:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const q = parse(listQuery, req.query);
    const where = {
      organizationId,
      ...(q.severity ? { severity: { in: q.severity } } : {}),
      ...(q.status ? { status: { in: q.status } } : {}),
      ...(q.assetId ? { assetId: q.assetId } : {}),
      ...(q.q ? { title: { contains: q.q, mode: "insensitive" as const } } : {}),
    };
    const orderBy =
      q.sort === "severity"
        ? [{ severity: "asc" as const }, { lastSeenAt: "desc" as const }]
        : q.sort === "lastSeen"
          ? [{ lastSeenAt: "desc" as const }]
          : [{ firstSeenAt: "desc" as const }];
    const [items, total, facets] = await Promise.all([
      prisma.finding.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, title: true, severity: true, status: true, moduleId: true, checkId: true,
          firstSeenAt: true, lastSeenAt: true, resolvedAt: true,
          asset: { select: { id: true, value: true, type: true } },
        },
      }),
      prisma.finding.count({ where }),
      prisma.finding.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      statusCounts: Object.fromEntries(facets.map((f) => [f.status, f._count])),
    };
  });

  app.get("/findings/:id", { preHandler: requireAuth("findings:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const finding = await prisma.finding.findFirst({
      where: { id, organizationId },
      include: {
        asset: { select: { id: true, value: true, type: true, criticality: true } },
        comments: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!finding) throw notFound("Finding");
    const userIds = [...new Set([...finding.comments.map((c) => c.authorId), ...(finding.assigneeId ? [finding.assigneeId] : [])])];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const history = await prisma.auditLog.findMany({
      where: { organizationId, resourceType: "finding", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, actorEmail: true, metadata: true, createdAt: true },
    });
    return {
      ...finding,
      assignee: finding.assigneeId ? byId.get(finding.assigneeId) ?? null : null,
      comments: finding.comments.map((c) => ({ ...c, author: byId.get(c.authorId) ?? null })),
      history,
    };
  });

  app.patch("/findings/:id", { preHandler: requireAuth("findings:update") }, async (req) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(updateSchema, req.body);
    const finding = await prisma.finding.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!finding) throw notFound("Finding");

    if ((body.status === "ACCEPTED" || finding.status === "ACCEPTED") && body.status && body.status !== finding.status) {
      if (!can(auth.role, "findings:accept")) throw forbidden("Only administrators can accept or un-accept risks");
    }
    if (body.assigneeId) {
      const member = await prisma.membership.findFirst({ where: { userId: body.assigneeId, organizationId: auth.organizationId } });
      if (!member) throw badRequest("Assignee is not a member of this organization");
    }

    const data: Record<string, unknown> = {};
    if (body.status && body.status !== finding.status) {
      data.status = body.status;
      data.resolvedAt = body.status === "RESOLVED" ? new Date() : null;
      data.acceptedReason = body.status === "ACCEPTED" ? body.acceptedReason : null;
    }
    if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId;
    if (Object.keys(data).length === 0) return { ok: true };

    await prisma.finding.update({ where: { id }, data });
    await audit(req, {
      action: "finding.update",
      resourceType: "finding",
      resourceId: id,
      metadata: {
        title: finding.title,
        ...(data.status ? { from: finding.status, to: data.status as string } : {}),
        ...(body.acceptedReason && data.status === "ACCEPTED" ? { reason: body.acceptedReason } : {}),
        ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      },
    });
    if (data.status) await snapshotScore(auth.organizationId);
    return { ok: true };
  });

  app.post("/findings/:id/comments", { preHandler: requireAuth("findings:update") }, async (req, reply) => {
    const auth = getAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { body } = parse(commentSchema, req.body);
    const finding = await prisma.finding.findFirst({ where: { id, organizationId: auth.organizationId }, select: { id: true } });
    if (!finding) throw notFound("Finding");
    const comment = await prisma.findingComment.create({ data: { findingId: id, authorId: auth.user.id, body } });
    await audit(req, { action: "finding.comment", resourceType: "finding", resourceId: id });
    return reply.code(201).send(comment);
  });
}
