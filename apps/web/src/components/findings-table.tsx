"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  EmptyState, ErrorState, Input, Pagination, Select, SeverityBadge, StatusBadge, Table, TableSkeleton,
} from "@/components/ui";
import { api } from "@/lib/api";
import { moduleLabel, SEVERITIES, severityLabel, timeAgo } from "@/lib/format";
import type { FindingStatus, FindingSummary, Paged, Severity } from "@/lib/types";

const STATUS_TABS: Array<{ id: string; label: string; statuses: FindingStatus[] | null }> = [
  { id: "active", label: "Active", statuses: ["OPEN", "IN_PROGRESS"] },
  { id: "OPEN", label: "Open", statuses: ["OPEN"] },
  { id: "IN_PROGRESS", label: "In progress", statuses: ["IN_PROGRESS"] },
  { id: "RESOLVED", label: "Resolved", statuses: ["RESOLVED"] },
  { id: "ACCEPTED", label: "Accepted", statuses: ["ACCEPTED"] },
  { id: "all", label: "All", statuses: null },
];

export function FindingsTable({ assetId, initialSeverity, initialStatus }: { assetId?: string; initialSeverity?: Severity[]; initialStatus?: string }) {
  const initialTab = (initialStatus && STATUS_TABS.find((t) => t.statuses?.join(",") === initialStatus)?.id) || "active";
  const [tab, setTab] = useState(initialTab);
  const [severity, setSeverity] = useState<Severity | "">(initialSeverity?.length === 1 ? initialSeverity[0]! : "");
  const [sort, setSort] = useState("severity");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => { setQ(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const statuses = STATUS_TABS.find((t) => t.id === tab)?.statuses;
  const query = useQuery({
    queryKey: ["findings", { assetId, tab, severity, sort, q, page }],
    queryFn: () =>
      api.get<Paged<FindingSummary> & { statusCounts: Record<string, number> }>("/findings", {
        assetId, status: statuses ?? undefined, severity: severity || undefined, sort, q, page, pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
  const counts = query.data?.statusCounts ?? {};
  const countFor = (t: (typeof STATUS_TABS)[number]) =>
    t.statuses ? t.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="card">
      <div className="flex gap-1 overflow-x-auto border-b border-line/60 px-3 pt-2" role="tablist">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { setTab(t.id); setPage(1); }}
            className={clsx("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm", tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
            {!assetId && <span className="rounded bg-raised px-1.5 text-[11px] tabular-nums text-muted">{countFor(t)}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line/60 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input className="pl-9" placeholder="Search findings…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search findings" />
        </div>
        <Select className="w-auto" value={severity} onChange={(e) => { setSeverity(e.target.value as Severity | ""); setPage(1); }} aria-label="Severity">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{severityLabel[s]}</option>)}
        </Select>
        <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="severity">Sort: severity</option>
          <option value="lastSeen">Sort: last seen</option>
          <option value="firstSeen">Sort: newest</option>
        </Select>
      </div>
      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title={q || severity ? "No matching findings" : tab === "active" ? "No active findings" : "Nothing here"}
          description={tab === "active" && !q && !severity ? "Findings appear here after scans detect security issues." : "Try adjusting the filters."}
        />
      ) : (
        <>
          <Table head={["Severity", "Finding", ...(assetId ? [] : ["Asset"]), "Status", "Last seen"]}>
            {query.data.items.map((f) => (
              <tr key={f.id} className="group hover:bg-raised/40">
                <td className="px-5 py-3.5"><SeverityBadge severity={f.severity} /></td>
                <td className="px-5 py-3.5">
                  <Link href={`/findings/${f.id}`} className="block">
                    <span className="block text-ink group-hover:text-accent">{f.title}</span>
                    <span className="text-xs text-faint">{moduleLabel[f.moduleId] ?? f.moduleId}</span>
                  </Link>
                </td>
                {!assetId && (
                  <td className="px-5 py-3.5">
                    <Link href={`/assets/${f.asset.id}`} className="block max-w-[260px] truncate font-mono text-xs text-muted hover:text-accent">{f.asset.value}</Link>
                  </td>
                )}
                <td className="px-5 py-3.5"><StatusBadge status={f.status} /></td>
                <td className="whitespace-nowrap px-5 py-3.5 text-muted">{timeAgo(f.lastSeenAt)}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
