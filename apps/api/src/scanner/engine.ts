import type { Asset, Prisma, ScanStatus } from "@prisma/client";
import { isIP } from "node:net";
import { env } from "../config/env.js";
import { dispatchAlerts, type Alert } from "../integrations/notifier.js";
import { prisma } from "../lib/db.js";
import { resolvePublicAddresses, UnsafeTargetError, withTimeout } from "../lib/net.js";
import {
  assertScanAuthorized,
  assetHost,
  ScanNotAuthorizedError,
} from "../modules/assets/authorization.js";
import { detectChanges, type ChangeDraft } from "./changes.js";
import { safeGet } from "./http.js";
import { SCANNER_MODULES } from "./modules/index.js";
import { computeScore, emptyCounts } from "./scoring.js";
import type { FindingDraft, HomepageResult, ScanContext, ScanTarget } from "./types.js";

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

const MODULE_TIMEOUT_MS = 120_000;

export function modulesFor(asset: Pick<Asset, "type">) {
  return SCANNER_MODULES.filter((m) => m.appliesTo.includes(asset.type));
}

export function buildTarget(asset: Asset): ScanTarget | null {
  if (asset.type === "OTHER") return null;
  if (asset.type === "IP_ADDRESS") {
    const bracketed = asset.value.includes(":") ? `[${asset.value}]` : asset.value;
    return { assetId: asset.id, type: asset.type, host: asset.value, url: `https://${bracketed}/`, isIp: true };
  }
  const host = assetHost(asset);
  if (!host) return null;
  const url = asset.type === "APPLICATION" ? asset.value : `https://${host}/`;
  return { assetId: asset.id, type: asset.type, host, url, isIp: isIP(host) !== 0 };
}

function makeHomepage(target: ScanTarget, timeoutMs: number): () => Promise<HomepageResult> {
  let cached: Promise<HomepageResult> | undefined;
  return () => {
    cached ??= (async () => {
      const httpsUrl = new URL(target.url);
      httpsUrl.protocol = "https:";
      const httpUrl = new URL(target.url);
      httpUrl.protocol = "http:";
      const [https, http] = await Promise.allSettled([
        safeGet(httpsUrl.toString(), timeoutMs),
        safeGet(httpUrl.toString(), timeoutMs),
      ]);
      return {
        https: https.status === "fulfilled" ? https.value : null,
        httpsError: https.status === "rejected" ? String((https.reason as Error).message) : undefined,
        http: http.status === "fulfilled" ? http.value : null,
        httpError: http.status === "rejected" ? String((http.reason as Error).message) : undefined,
      };
    })();
    return cached;
  };
}

export const fingerprintOf = (moduleId: string, assetId: string, f: Pick<FindingDraft, "checkId" | "detail">) =>
  [moduleId, f.checkId, assetId, f.detail].filter(Boolean).join(":");

async function finishScan(scanId: string, status: ScanStatus, error?: string) {
  await prisma.scan.update({ where: { id: scanId }, data: { status, error, finishedAt: new Date() } });
}

/** Recompute the organization's score from its open findings and store a snapshot. */
export async function snapshotScore(organizationId: string) {
  const grouped = await prisma.finding.groupBy({
    by: ["severity"],
    where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    _count: true,
  });
  const counts = emptyCounts();
  for (const g of grouped) counts[g.severity] = g._count;
  const score = computeScore(counts);
  await prisma.scoreSnapshot.create({
    data: {
      organizationId,
      score,
      critical: counts.CRITICAL,
      high: counts.HIGH,
      medium: counts.MEDIUM,
      low: counts.LOW,
      info: counts.INFO,
    },
  });
  return score;
}

/**
 * Execute one scan. This is the only code path that sends probes, and it
 * starts by re-checking authorization for the asset.
 */
export async function runScan(scanId: string, log: Log): Promise<void> {
  const scan = await prisma.scan.findUnique({ where: { id: scanId }, include: { asset: true } });
  if (!scan || scan.status !== "QUEUED") return;
  const { asset } = scan;

  await prisma.scan.update({ where: { id: scanId }, data: { status: "RUNNING", startedAt: new Date() } });

  // 1. Authorization gate.
  try {
    await assertScanAuthorized(asset);
  } catch (err) {
    if (err instanceof ScanNotAuthorizedError) {
      await finishScan(scanId, "BLOCKED", err.message);
      await prisma.auditLog.create({
        data: {
          organizationId: asset.organizationId,
          action: "scan.blocked",
          resourceType: "asset",
          resourceId: asset.id,
          outcome: "denied",
          metadata: { scanId, reason: err.message },
        },
      });
      return;
    }
    throw err;
  }

  // 2. Target resolution + SSRF guard.
  const target = buildTarget(asset);
  if (!target) {
    await finishScan(scanId, "FAILED", "This asset type has no network-scannable target");
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolvePublicAddresses(target.host);
  } catch (err) {
    const message = err instanceof UnsafeTargetError ? err.message : `Resolution failed: ${(err as Error).message}`;
    // DNS-only checks are still meaningful for a domain without address records (e.g. mail-only domains).
    if (asset.type === "DOMAIN" && message.includes("does not resolve")) {
      addresses = [];
    } else {
      await finishScan(scanId, "FAILED", message);
      return;
    }
  }

  const ctx: ScanContext = {
    target,
    addresses,
    ports: env.SCAN_PORTS,
    timeoutMs: env.SCAN_TIMEOUT_MS,
    homepage: makeHomepage(target, env.SCAN_TIMEOUT_MS),
  };

  const modules = modulesFor(asset).filter(
    (m) => scan.modules.length === 0 || scan.modules.includes(m.id),
  ).filter((m) => addresses.length > 0 || m.id === "dns" || m.id === "email-security");

  // 3. Run modules.
  const drafts: Array<{ moduleId: string; finding: FindingDraft }> = [];
  const changes: ChangeDraft[] = [];
  const succeeded = new Set<string>();
  let failures = 0;

  for (const mod of modules) {
    const started = Date.now();
    try {
      const result = await withTimeout(mod.run(ctx), MODULE_TIMEOUT_MS, mod.name);
      const observations = result.observations as Prisma.InputJsonValue;
      await prisma.scanModuleRun.create({
        data: { scanId, moduleId: mod.id, status: "COMPLETED", durationMs: Date.now() - started, observations },
      });
      const previous = await prisma.assetObservation.findUnique({
        where: { assetId_moduleId: { assetId: asset.id, moduleId: mod.id } },
      });
      changes.push(...detectChanges(mod.id, target.host, (previous?.data as Record<string, unknown>) ?? null, result.observations));
      await prisma.assetObservation.upsert({
        where: { assetId_moduleId: { assetId: asset.id, moduleId: mod.id } },
        create: { assetId: asset.id, moduleId: mod.id, data: observations, scanId },
        update: { data: observations, scanId },
      });
      for (const f of result.findings) drafts.push({ moduleId: mod.id, finding: f });
      succeeded.add(mod.id);
    } catch (err) {
      failures++;
      log.warn({ err, scanId, module: mod.id }, "scanner module failed");
      await prisma.scanModuleRun.create({
        data: { scanId, moduleId: mod.id, status: "FAILED", durationMs: Date.now() - started, error: String((err as Error).message).slice(0, 500) },
      });
    }
  }

  // 4. Reconcile findings.
  const now = new Date();
  const seen = new Set<string>();
  const newFindings: Array<{ id: string; title: string; severity: FindingDraft["severity"] }> = [];
  for (const { moduleId, finding } of drafts) {
    const fingerprint = fingerprintOf(moduleId, asset.id, finding);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const existing = await prisma.finding.findUnique({
      where: { organizationId_fingerprint: { organizationId: asset.organizationId, fingerprint } },
    });
    const content = {
      title: finding.title,
      severity: finding.severity,
      description: finding.description,
      remediation: finding.remediation,
      evidence: finding.evidence as Prisma.InputJsonValue,
      references: finding.references ?? [],
      lastSeenAt: now,
    };
    if (!existing) {
      const created = await prisma.finding.create({
        data: { ...content, organizationId: asset.organizationId, assetId: asset.id, fingerprint, moduleId, checkId: finding.checkId },
      });
      newFindings.push(created);
    } else {
      const reopened = existing.status === "RESOLVED";
      await prisma.finding.update({
        where: { id: existing.id },
        data: { ...content, ...(reopened ? { status: "OPEN", resolvedAt: null } : {}) },
      });
      if (reopened) newFindings.push({ id: existing.id, title: `${finding.title} (reappeared)`, severity: finding.severity });
    }
  }

  // Auto-resolve findings from modules that ran successfully and no longer report them.
  const stale = await prisma.finding.findMany({
    where: {
      assetId: asset.id,
      moduleId: { in: [...succeeded] },
      status: { in: ["OPEN", "IN_PROGRESS"] },
      fingerprint: { notIn: [...seen] },
    },
    select: { id: true, title: true },
  });
  if (stale.length) {
    await prisma.finding.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { status: "RESOLVED", resolvedAt: now },
    });
  }

  // 5. Persist results, change events and alerts.
  await prisma.asset.update({ where: { id: asset.id }, data: { lastScannedAt: now } });
  const status: ScanStatus = failures === 0 ? "COMPLETED" : succeeded.size > 0 ? "PARTIAL" : "FAILED";
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status,
      finishedAt: new Date(),
      findingsNew: newFindings.length,
      findingsTotal: seen.size,
      error: failures ? `${failures} module(s) failed` : null,
    },
  });

  for (const f of newFindings) {
    changes.push({ kind: "finding.new", severity: f.severity, summary: `New finding on ${target.host}: ${f.title}`, details: { findingId: f.id } });
  }
  for (const s of stale) {
    changes.push({ kind: "finding.resolved", severity: "INFO", summary: `No longer detected on ${target.host}: ${s.title}`, details: { findingId: s.id } });
  }
  if (changes.length) {
    await prisma.changeEvent.createMany({
      data: changes.map((c) => ({
        organizationId: asset.organizationId,
        assetId: asset.id,
        kind: c.kind,
        severity: c.severity,
        summary: c.summary,
        details: c.details as Prisma.InputJsonValue,
      })),
    });
  }

  await snapshotScore(asset.organizationId);

  const alerts: Alert[] = changes.map((c) => ({
    organizationId: asset.organizationId,
    severity: c.severity,
    title: c.summary,
    body: c.kind.startsWith("finding.") ? "A scan detected a new security issue." : `Change detected: ${c.kind}`,
    link: c.kind === "finding.new" ? `/findings/${c.details.findingId}` : `/assets/${asset.id}`,
  }));
  await dispatchAlerts(alerts, log);

  log.info({ scanId, status, findings: seen.size, new: newFindings.length, changes: changes.length }, "scan finished");
}

export async function failScan(scanId: string, error: string) {
  await prisma.scan.updateMany({
    where: { id: scanId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: error.slice(0, 500), finishedAt: new Date() },
  });
}
