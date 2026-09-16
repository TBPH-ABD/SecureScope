import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuth, requireAuth } from "../../auth/guards.js";
import { prisma } from "../../lib/db.js";
import { parse } from "../../lib/validation.js";
import { computeScore, emptyCounts, gradeFor } from "../../scanner/scoring.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: requireAuth("dashboard:read") }, async (req) => {
    const { organizationId } = getAuth(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const active = { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } };

    const [bySeverity, byStatus, assetsByStatus, recentScans, topFindings, snapshots, recentChanges, lastScan] =
      await Promise.all([
        prisma.finding.groupBy({ by: ["severity"], where: active, _count: true }),
        prisma.finding.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
        prisma.asset.groupBy({ by: ["authorizationStatus"], where: { organizationId }, _count: true }),
        prisma.scan.findMany({
          where: { organizationId },
          orderBy: { queuedAt: "desc" },
          take: 6,
          include: { asset: { select: { id: true, value: true, type: true } } },
        }),
        prisma.finding.findMany({
          where: { ...active, severity: { in: ["CRITICAL", "HIGH"] } },
          orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
          take: 6,
          include: { asset: { select: { id: true, value: true } } },
        }),
        prisma.scoreSnapshot.findMany({
          where: { organizationId, createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          select: { score: true, critical: true, high: true, medium: true, low: true, createdAt: true },
        }),
        prisma.changeEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 6 }),
        prisma.scan.findFirst({
          where: { organizationId, status: { in: ["COMPLETED", "PARTIAL"] } },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true },
        }),
      ]);

    const counts = emptyCounts();
    for (const g of bySeverity) counts[g.severity] = g._count;
    const statusCounts = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, ACCEPTED: 0 };
    for (const g of byStatus) statusCounts[g.status] = g._count;
    const assets = { total: 0, VERIFIED: 0, PENDING: 0, REVOKED: 0 };
    for (const g of assetsByStatus) {
      assets[g.authorizationStatus] = g._count;
      assets.total += g._count;
    }

    // One point per day (last snapshot of the day) keeps the chart readable.
    const byDay = new Map<string, (typeof snapshots)[number]>();
    for (const s of snapshots) byDay.set(s.createdAt.toISOString().slice(0, 10), s);
    const trend = [...byDay.entries()].map(([date, s]) => ({ date, score: s.score, critical: s.critical, high: s.high, medium: s.medium, low: s.low }));

    const hasData = lastScan !== null;
    const score = computeScore(counts);
    const previous = trend.length > 1 ? trend[trend.length - 2]!.score : null;

    return {
      score: hasData ? { value: score, grade: gradeFor(score), previous } : null,
      severityCounts: counts,
      statusCounts,
      openTotal: statusCounts.OPEN + statusCounts.IN_PROGRESS,
      assets,
      lastScanAt: lastScan?.finishedAt ?? null,
      trend,
      recentScans,
      topFindings,
      recentChanges,
    };
  });
}
