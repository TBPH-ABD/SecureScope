import type { Severity } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { computeScore, emptyCounts, gradeFor, SEVERITY_ORDER } from "../../scanner/scoring.js";

export interface ReportContent {
  version: 1;
  organization: string;
  generatedAt: string;
  generatedBy: string;
  scope: { assetCount: number; assetIds: string[] | null };
  summary: {
    score: number;
    grade: string;
    riskLevel: "Critical" | "High" | "Moderate" | "Low";
    openFindings: number;
    severityCounts: Record<Severity, number>;
    resolvedLast30Days: number;
    verifiedAssets: number;
    lastScanAt: string | null;
    narrative: string;
  };
  assets: Array<{ id: string; value: string; type: string; criticality: string; open: number; worst: Severity | null }>;
  findings: Array<{
    id: string; title: string; severity: Severity; status: string; asset: string;
    description: string; remediation: string; evidence: unknown; firstSeenAt: string;
  }>;
  recommendations: Array<{ priority: number; title: string; detail: string; affected: number }>;
  trend: Array<{ date: string; score: number }>;
}

function riskLevel(counts: Record<Severity, number>): ReportContent["summary"]["riskLevel"] {
  if (counts.CRITICAL > 0) return "Critical";
  if (counts.HIGH > 0) return "High";
  if (counts.MEDIUM > 0) return "Moderate";
  return "Low";
}

export async function buildReport(opts: {
  organizationId: string;
  generatedBy: string;
  assetIds?: string[];
}): Promise<ReportContent> {
  const { organizationId } = opts;
  const assetFilter = opts.assetIds?.length ? { assetId: { in: opts.assetIds } } : {};
  const [org, assets, findings, resolved, lastScan, snapshots] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.asset.findMany({
      where: { organizationId, ...(opts.assetIds?.length ? { id: { in: opts.assetIds } } : {}) },
      orderBy: { value: "asc" },
    }),
    prisma.finding.findMany({
      where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] }, ...assetFilter },
      include: { asset: { select: { value: true } } },
      orderBy: [{ severity: "asc" }, { firstSeenAt: "asc" }],
      take: 500,
    }),
    prisma.finding.count({
      where: { organizationId, status: "RESOLVED", resolvedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, ...assetFilter },
    }),
    prisma.scan.findFirst({
      where: { organizationId, status: { in: ["COMPLETED", "PARTIAL"] }, ...assetFilter },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.scoreSnapshot.findMany({
      where: { organizationId, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const counts = emptyCounts();
  for (const f of findings) counts[f.severity]++;
  const score = computeScore(counts);
  const level = riskLevel(counts);

  const perAsset = new Map<string, { open: number; worst: Severity | null }>();
  for (const f of findings) {
    const entry = perAsset.get(f.assetId) ?? { open: 0, worst: null };
    entry.open++;
    if (!entry.worst || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(entry.worst)) entry.worst = f.severity;
    perAsset.set(f.assetId, entry);
  }

  // Group by check to turn many findings into a short list of actions.
  const groups = new Map<string, { title: string; detail: string; severity: Severity; affected: Set<string> }>();
  for (const f of findings) {
    if (f.severity === "INFO") continue;
    const g = groups.get(f.checkId) ?? { title: f.title, detail: f.remediation, severity: f.severity, affected: new Set<string>() };
    g.affected.add(f.asset.value);
    groups.set(f.checkId, g);
  }
  const recommendations = [...groups.values()]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.affected.size - a.affected.size)
    .slice(0, 10)
    .map((g, i) => ({ priority: i + 1, title: g.title, detail: g.detail, affected: g.affected.size }));

  const byDay = new Map<string, number>();
  for (const s of snapshots) byDay.set(s.createdAt.toISOString().slice(0, 10), s.score);

  const verified = assets.filter((a) => a.authorizationStatus === "VERIFIED").length;
  const open = findings.length;
  const narrative =
    open === 0
      ? `No open security issues were identified across ${verified} verified asset(s). Continue monitoring to catch configuration drift.`
      : `SecureScope identified ${open} open issue(s) across ${perAsset.size} asset(s), including ${counts.CRITICAL} critical and ${counts.HIGH} high severity finding(s). ` +
        `The overall external risk level is ${level.toLowerCase()} with a security score of ${score}/100 (grade ${gradeFor(score)}). ` +
        (recommendations[0] ? `The highest-priority action is: ${recommendations[0].title.toLowerCase()}.` : "");

  return {
    version: 1,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    generatedBy: opts.generatedBy,
    scope: { assetCount: assets.length, assetIds: opts.assetIds?.length ? opts.assetIds : null },
    summary: {
      score,
      grade: gradeFor(score),
      riskLevel: level,
      openFindings: open,
      severityCounts: counts,
      resolvedLast30Days: resolved,
      verifiedAssets: verified,
      lastScanAt: lastScan?.finishedAt?.toISOString() ?? null,
      narrative,
    },
    assets: assets.map((a) => ({
      id: a.id,
      value: a.value,
      type: a.type,
      criticality: a.criticality,
      open: perAsset.get(a.id)?.open ?? 0,
      worst: perAsset.get(a.id)?.worst ?? null,
    })),
    findings: findings.map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      status: f.status,
      asset: f.asset.value,
      description: f.description,
      remediation: f.remediation,
      evidence: f.evidence,
      firstSeenAt: f.firstSeenAt.toISOString(),
    })),
    recommendations,
    trend: [...byDay.entries()].map(([date, s]) => ({ date, score: s })),
  };
}
