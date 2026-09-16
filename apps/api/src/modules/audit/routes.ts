import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { prisma } from "../../lib/db.js";
import { cleanText, pagination, parse } from "../../lib/validation.js";

const query = pagination.extend({
  action: cleanText(60).optional(),
  actor: cleanText(254).optional(),
  outcome: z.enum(["success", "failure", "denied"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get("/audit-logs", { preHandler: requireAuth("audit:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const q = parse(query, req.query);
    const where = {
      organizationId,
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actor ? { actorEmail: { contains: q.actor, mode: "insensitive" as const } } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const [items, total, actions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where: { organizationId }, distinct: ["action"], select: { action: true }, take: 100 }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, actions: actions.map((a) => a.action).sort() };
  });
}
