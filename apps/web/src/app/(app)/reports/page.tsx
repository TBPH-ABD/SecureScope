"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FilePlus2, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import {
  Button, EmptyState, ErrorState, Field, fieldErrors, InlineError, Input, Modal, PageHeader, Pagination, SeverityBadge, Table, TableSkeleton,
} from "@/components/ui";
import { api, download } from "@/lib/api";
import { Can } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Asset, Paged, SeverityCounts } from "@/lib/types";

interface ReportRow {
  id: string;
  title: string;
  createdAt: string;
  generatedBy: string;
  scope: { assetCount: number; assetIds: string[] | null };
  summary: { score: number; grade: string; riskLevel: string; openFindings: number; severityCounts: SeverityCounts };
}

function NewReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [title, setTitle] = useState(`Security Assessment — ${new Date().toLocaleDateString("en", { month: "long", year: "numeric" })}`);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const assets = useQuery({ queryKey: ["assets", "all"], queryFn: () => api.get<Paged<Asset>>("/assets", { pageSize: 100 }), enabled: open && scope === "selected" });
  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>("/reports", { title, assetIds: scope === "selected" ? selected : undefined }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["reports"] }); onClose(); router.push(`/reports/${r.id}`); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Generate report" description="Reports are frozen snapshots of the current findings and score." wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={scope === "selected" && !selected.length} onClick={() => m.mutate()}>Generate</Button></>}>
      <div className="space-y-4">
        <Field label="Title" error={fieldErrors(m.error).title}>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="flex gap-2">
          {(["all", "selected"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${scope === s ? "border-accent/60 bg-accent/10" : "border-line text-muted"}`}>
              {s === "all" ? "All assets" : "Selected assets"}
            </button>
          ))}
        </div>
        {scope === "selected" && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {assets.isPending && <p className="p-2 text-sm text-muted">Loading assets…</p>}
            {assets.data?.items.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-raised">
                <input type="checkbox" className="accent-cyan-400" checked={selected.includes(a.id)}
                  onChange={() => setSelected((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))} />
                <span className="font-mono text-xs">{a.value}</span>
              </label>
            ))}
          </div>
        )}
        <InlineError error={m.error} />
      </div>
    </Modal>
  );
}

export default function ReportsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["reports", page], queryFn: () => api.get<Paged<ReportRow>>("/reports", { page }), placeholderData: keepPreviousData });

  const pdf = async (r: ReportRow) => {
    setDownloading(r.id);
    try { await download(`/reports/${r.id}/pdf`, "report.pdf"); } catch (e) { toast.error(e); } finally { setDownloading(null); }
  };

  return (
    <>
      <PageHeader title="Reports" description="Executive security reports with findings, risk level and recommendations."
        actions={<Can permission="reports:create"><Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating(true)}>New report</Button></Can>} />
      <div className="card">
        {q.isPending ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No reports yet" description="Generate a report to share your security posture with leadership or auditors."
            action={<Can permission="reports:create"><Button onClick={() => setCreating(true)}>Generate first report</Button></Can>} />
        ) : (
          <>
            <Table head={["Report", "Score", "Risk", "Open issues", "Generated", ""]}>
              {q.data.items.map((r) => (
                <tr key={r.id} className="group hover:bg-raised/40">
                  <td className="px-5 py-3.5">
                    <Link href={`/reports/${r.id}`} className="block">
                      <span className="block group-hover:text-accent">{r.title}</span>
                      <span className="text-xs text-faint">{r.scope.assetIds ? `${r.scope.assetCount} selected assets` : "All assets"} · by {r.generatedBy}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 tabular-nums">{r.summary.score} <span className="text-faint">({r.summary.grade})</span></td>
                  <td className="px-5 py-3.5">{r.summary.riskLevel}</td>
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-2 tabular-nums">{r.summary.openFindings}
                      {r.summary.severityCounts.CRITICAL > 0 && <SeverityBadge severity="CRITICAL" compact />}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-muted">{formatDateTime(r.createdAt)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} loading={downloading === r.id} onClick={() => pdf(r)}>PDF</Button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </div>
      <NewReportModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
