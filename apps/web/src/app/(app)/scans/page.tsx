"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader, Pagination, ScanStatusBadge, Table, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { assetTypeLabel, duration, formatDateTime } from "@/lib/format";
import type { Paged, Scan } from "@/lib/types";

export default function ScansPage() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["scans", page],
    queryFn: () => api.get<Paged<Scan>>("/scans", { page, pageSize: 25 }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((s) => s.status === "QUEUED" || s.status === "RUNNING") ? 4000 : 30_000),
  });
  return (
    <>
      <PageHeader title="Scans" description="History of manual and scheduled scans. Start a scan from an asset's page." />
      <div className="card">
        {q.isPending ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
          <EmptyState icon={<ScanSearch className="h-5 w-5" />} title="No scans yet" description="Verify an asset and run your first scan." action={<Link href="/assets" className="text-sm text-accent hover:underline">Go to assets</Link>} />
        ) : (
          <>
            <Table head={["Asset", "Status", "Trigger", "Started", "Duration", "Findings"]}>
              {q.data.items.map((s) => (
                <tr key={s.id} className="group hover:bg-raised/40">
                  <td className="px-5 py-3.5">
                    <Link href={`/scans/${s.id}`} className="block">
                      <span className="block max-w-[320px] truncate font-mono text-[13px] group-hover:text-accent">{s.asset.value}</span>
                      <span className="text-xs text-faint">{assetTypeLabel[s.asset.type]}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5"><ScanStatusBadge status={s.status} /></td>
                  <td className="px-5 py-3.5 text-muted">{s.trigger === "SCHEDULED" ? "Scheduled" : "Manual"}</td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-muted">{formatDateTime(s.startedAt ?? s.queuedAt)}</td>
                  <td className="px-5 py-3.5 text-muted">{duration(s.startedAt, s.finishedAt)}</td>
                  <td className="px-5 py-3.5 tabular-nums">{s.findingsTotal}{s.findingsNew > 0 && <span className="ml-1 text-sev-high">+{s.findingsNew} new</span>}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
