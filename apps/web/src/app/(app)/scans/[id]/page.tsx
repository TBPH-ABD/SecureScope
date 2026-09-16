"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CodeBlock, ErrorState, ScanStatusBadge, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { duration, formatDateTime, moduleLabel } from "@/lib/format";
import type { Scan } from "@/lib/types";

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["scan", id],
    queryFn: () => api.get<Scan>(`/scans/${id}`),
    refetchInterval: (query) => (["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "QUEUED") ? 2500 : false),
  });
  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>;
  if (q.isError) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const s = q.data;
  const active = s.status === "QUEUED" || s.status === "RUNNING";

  return (
    <>
      <Link href="/scans" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Scans</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ScanStatusBadge status={s.status} /><span className="text-xs text-muted">{s.trigger === "SCHEDULED" ? "Scheduled scan" : "Manual scan"}</span></div>
          <h1 className="mt-2 font-mono text-xl font-semibold"><Link href={`/assets/${s.asset.id}`} className="hover:text-accent">{s.asset.value}</Link></h1>
          <p className="mt-1 text-sm text-muted">Queued {formatDateTime(s.queuedAt)} · Duration {duration(s.startedAt, s.finishedAt)}</p>
        </div>
        {!active && (
          <div className="flex gap-6 text-right">
            <div><div className="label">Findings</div><div className="text-2xl font-semibold tabular-nums">{s.findingsTotal}</div></div>
            <div><div className="label">New</div><div className="text-2xl font-semibold tabular-nums text-sev-high">{s.findingsNew}</div></div>
          </div>
        )}
      </div>

      {s.status === "BLOCKED" && (
        <div role="alert" className="mb-4 rounded-xl border border-sev-critical/30 bg-sev-critical/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-sev-critical"><CircleSlash className="h-4 w-4" /> Scan blocked by authorization check</div>
          <p className="mt-1 text-muted">{s.error} No traffic was sent to the target.</p>
        </div>
      )}
      {s.status === "FAILED" && s.error && (
        <div role="alert" className="mb-4 rounded-xl border border-sev-critical/30 bg-sev-critical/10 p-4 text-sm text-muted">{s.error}</div>
      )}
      {active && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          {s.status === "QUEUED" ? "Waiting for a scanner worker…" : "Scan in progress — results update automatically."}
        </div>
      )}

      <Card title="Checks" bodyClassName="p-0">
        {!s.moduleRuns?.length ? (
          <p className="px-5 py-6 text-sm text-muted">{active ? "Checks will appear as they complete." : "No checks were executed."}</p>
        ) : (
          <ul className="divide-y divide-line/40">
            {s.moduleRuns.map((m) => (
              <li key={m.id} className="px-5 py-4">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    {m.status === "COMPLETED" ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-sev-critical" />}
                    <span className="flex-1 text-sm">{moduleLabel[m.moduleId] ?? m.moduleId}</span>
                    <span className="text-xs text-faint">{m.durationMs !== null ? `${(m.durationMs / 1000).toFixed(1)}s` : ""}</span>
                    <span className="text-xs text-accent group-open:hidden">Raw data</span>
                  </summary>
                  <div className="mt-3">
                    {m.error ? <p className="text-sm text-sev-critical">{m.error}</p> : <CodeBlock>{JSON.stringify(m.observations, null, 2)}</CodeBlock>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
