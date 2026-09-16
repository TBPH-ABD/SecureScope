"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ScrollText } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Table, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Paged } from "@/lib/types";

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  outcome: string;
  ipAddress: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [actor, setActor] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setActor(actorInput); setPage(1); }, 300); return () => clearTimeout(t); }, [actorInput]);

  const q = useQuery({
    queryKey: ["audit", page, action, outcome, actor],
    queryFn: () => api.get<Paged<AuditRow> & { actions: string[] }>("/audit-logs", { page, action, outcome, actor, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Audit log" description="Tamper-evident record of security-relevant activity in your organization." />
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b border-line/60 p-4">
          <Input className="max-w-xs" placeholder="Filter by user email" value={actorInput} onChange={(e) => setActorInput(e.target.value)} aria-label="User" />
          <Select className="w-auto" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action">
            <option value="">All actions</option>
            {q.data?.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select className="w-auto" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} aria-label="Outcome">
            <option value="">Any outcome</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </Select>
        </div>
        {q.isPending ? <TableSkeleton rows={10} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No matching events" />
        ) : (
          <>
            <Table head={["Time", "User", "Action", "Resource", "Outcome", "IP address"]}>
              {q.data.items.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-raised/40" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-muted">{formatDateTime(r.createdAt)}</td>
                    <td className="max-w-[200px] truncate px-5 py-3 text-sm">{r.actorEmail ?? <span className="text-faint">system</span>}</td>
                    <td className="px-5 py-3 font-mono text-xs">{r.action}</td>
                    <td className="px-5 py-3 text-xs text-muted">{r.resourceType ? `${r.resourceType}${r.resourceId ? ` · ${r.resourceId.slice(0, 8)}` : ""}` : "—"}</td>
                    <td className="px-5 py-3">
                      <span className={clsx("rounded px-1.5 py-0.5 text-[11px] font-medium",
                        r.outcome === "success" ? "bg-ok/10 text-ok" : r.outcome === "denied" ? "bg-sev-high/10 text-sev-high" : "bg-sev-critical/10 text-sev-critical")}>
                        {r.outcome}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-muted">{r.ipAddress ?? "—"}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={6} className="bg-canvas/50 px-5 py-3">
                        <pre className="overflow-x-auto font-mono text-xs text-muted">{JSON.stringify({ resourceId: r.resourceId, ...r.metadata }, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
