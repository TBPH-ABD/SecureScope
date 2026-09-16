"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ScoreGauge } from "@/components/dashboard/score-gauge";
import { ScoreTrend } from "@/components/dashboard/score-trend";
import { SeverityBars } from "@/components/dashboard/severity-bars";
import {
  Button, Card, EmptyState, ErrorState, PageHeader, ScanStatusBadge, SeverityBadge, Skeleton, Stat, Tabs,
} from "@/components/ui";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import type { ChangeEvent, Scan, Severity, SeverityCounts } from "@/lib/types";

interface Dashboard {
  score: { value: number; grade: string; previous: number | null } | null;
  severityCounts: SeverityCounts;
  statusCounts: Record<string, number>;
  openTotal: number;
  assets: { total: number; VERIFIED: number; PENDING: number; REVOKED: number };
  lastScanAt: string | null;
  trend: Array<{ date: string; score: number; critical: number; high: number; medium: number; low: number }>;
  recentScans: Scan[];
  topFindings: Array<{ id: string; title: string; severity: Severity; lastSeenAt: string; asset: { id: string; value: string } }>;
  recentChanges: ChangeEvent[];
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
      <Skeleton className="h-72 lg:row-span-2" />
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      <Skeleton className="h-80 lg:col-span-2" />
      <Skeleton className="h-80" />
    </div>
  );
}

export default function DashboardPage() {
  const [days, setDays] = useState<"30" | "90" | "365">("90");
  const q = useQuery({
    queryKey: ["dashboard", days],
    queryFn: () => api.get<Dashboard>("/dashboard", { days }),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const header = (
    <PageHeader
      title="Security overview"
      description="Your external security posture across all verified assets."
      actions={
        <Can permission="scans:run">
          <Link href="/assets"><Button icon={<Radar className="h-4 w-4" />}>Scan assets</Button></Link>
        </Can>
      }
    />
  );

  if (q.isPending) return <>{header}<DashboardSkeleton /></>;
  if (q.isError) return <>{header}<div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div></>;
  const d = q.data;

  if (!d.score) {
    return (
      <>
        {header}
        <div className="card">
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title={d.assets.total ? "No completed scans yet" : "Start by adding your assets"}
            description={
              d.assets.total
                ? `You have ${d.assets.total} asset(s), ${d.assets.VERIFIED} verified. Run a scan on a verified asset to calculate your security score.`
                : "Add the domains, subdomains, IPs and applications your organization owns. After verifying ownership you can scan them."
            }
            action={<Link href="/assets"><Button icon={<Boxes className="h-4 w-4" />}>{d.assets.total ? "Go to assets" : "Add your first asset"}</Button></Link>}
          />
        </div>
      </>
    );
  }

  const delta = d.score.previous !== null ? d.score.value - d.score.previous : null;

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Security score" description={`Last scan ${timeAgo(d.lastScanAt)}`} bodyClassName="flex flex-col items-center justify-center gap-4 py-6">
          <ScoreGauge score={d.score.value} grade={d.score.grade} />
          {delta !== null && (
            <div className={`flex items-center gap-1 text-sm ${delta > 0 ? "text-ok" : delta < 0 ? "text-sev-critical" : "text-muted"}`}>
              {delta > 0 ? <ArrowUpRight className="h-4 w-4" /> : delta < 0 ? <ArrowDownRight className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              <span className="tabular-nums">{delta > 0 ? `+${delta}` : delta}</span>
              <span className="text-muted">since previous snapshot</span>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat label="Critical issues" value={d.severityCounts.CRITICAL} tone={d.severityCounts.CRITICAL ? "text-sev-critical" : undefined} sub="Require immediate action" href="/findings?severity=CRITICAL&status=OPEN,IN_PROGRESS" />
          <Stat label="High issues" value={d.severityCounts.HIGH} tone={d.severityCounts.HIGH ? "text-sev-high" : undefined} sub="Fix within days" href="/findings?severity=HIGH&status=OPEN,IN_PROGRESS" />
          <Stat label="Open findings" value={d.openTotal} sub={`${d.statusCounts.IN_PROGRESS ?? 0} in progress · ${d.statusCounts.RESOLVED ?? 0} resolved`} href="/findings?status=OPEN,IN_PROGRESS" />
          <Stat label="Monitored assets" value={d.assets.VERIFIED} sub={`${d.assets.PENDING} awaiting verification`} href="/assets" />
        </div>

        <Card
          className="lg:col-span-2"
          title="Security score over time"
          description="Daily snapshot after each scan or status change"
          action={<Tabs bare value={days} onChange={setDays} tabs={[{ id: "30", label: "30d" }, { id: "90", label: "90d" }, { id: "365", label: "1y" }]} />}
        >
          {d.trend.length ? <ScoreTrend data={d.trend} /> : <p className="py-16 text-center text-sm text-muted">No snapshots in this range.</p>}
        </Card>

        <Card title="Open findings by severity">
          <SeverityBars counts={d.severityCounts} />
        </Card>

        <Card
          className="lg:col-span-2"
          title="Priority issues"
          description="Open critical and high severity findings"
          action={<Link href="/findings" className="text-xs text-accent hover:underline">View all</Link>}
          bodyClassName="p-0"
        >
          {d.topFindings.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No critical or high issues" description="Nice work. Keep monitoring for new exposures." />
          ) : (
            <ul className="divide-y divide-line/40">
              {d.topFindings.map((f) => (
                <li key={f.id}>
                  <Link href={`/findings/${f.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-raised/50">
                    <SeverityBadge severity={f.severity} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{f.title}</span>
                      <span className="block truncate font-mono text-xs text-faint">{f.asset.value}</span>
                    </span>
                    <span className="hidden text-xs text-faint sm:block">{timeAgo(f.lastSeenAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent scans" action={<Link href="/scans" className="text-xs text-accent hover:underline">History</Link>} bodyClassName="p-0">
          <ul className="divide-y divide-line/40">
            {d.recentScans.map((s) => (
              <li key={s.id}>
                <Link href={`/scans/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-raised/50">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-ink">{s.asset.value}</span>
                    <span className="text-[11px] text-faint">{s.trigger === "SCHEDULED" ? "Scheduled" : "Manual"} · {timeAgo(s.queuedAt)}</span>
                  </span>
                  <ScanStatusBadge status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-3" title="Recent changes" description="Significant changes detected by continuous monitoring" action={<Link href="/monitoring" className="text-xs text-accent hover:underline">Monitoring</Link>} bodyClassName="p-0">
          {d.recentChanges.length === 0 ? (
            <EmptyState icon={<Activity className="h-5 w-5" />} title="No changes detected yet" description="Changes appear after an asset has been scanned at least twice." />
          ) : (
            <ul className="divide-y divide-line/40">
              {d.recentChanges.map((c) => (
                <li key={c.id} className="flex items-center gap-4 px-5 py-3">
                  <SeverityBadge severity={c.severity} compact />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.summary}</span>
                  <span className="hidden font-mono text-[11px] text-faint md:block">{c.kind}</span>
                  <span className="whitespace-nowrap text-xs text-faint">{timeAgo(c.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
