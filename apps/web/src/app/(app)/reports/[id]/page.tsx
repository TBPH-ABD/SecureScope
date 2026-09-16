"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ScoreGauge } from "@/components/dashboard/score-gauge";
import { SeverityBars } from "@/components/dashboard/severity-bars";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorState, Modal, SeverityBadge, Skeleton, Table } from "@/components/ui";
import { api, download } from "@/lib/api";
import { Can } from "@/lib/auth";
import { assetTypeLabel, formatDate, formatDateTime } from "@/lib/format";
import type { AssetType, Severity, SeverityCounts } from "@/lib/types";

interface Report {
  id: string;
  title: string;
  createdAt: string;
  content: {
    organization: string;
    generatedBy: string;
    summary: { score: number; grade: string; riskLevel: string; openFindings: number; severityCounts: SeverityCounts; resolvedLast30Days: number; verifiedAssets: number; lastScanAt: string | null; narrative: string };
    assets: Array<{ id: string; value: string; type: AssetType; open: number; worst: Severity | null }>;
    findings: Array<{ id: string; title: string; severity: Severity; asset: string; remediation: string; firstSeenAt: string }>;
    recommendations: Array<{ priority: number; title: string; detail: string; affected: number }>;
  };
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["report", id], queryFn: () => api.get<Report>(`/reports/${id}`) });
  const del = useMutation({
    mutationFn: () => api.delete(`/reports/${id}`),
    onSuccess: () => { toast.success("Report deleted"); router.replace("/reports"); },
    onError: toast.error,
  });

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (q.isError) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const { content: c } = q.data;
  const s = c.summary;

  const pdf = async () => {
    setBusy(true);
    try { await download(`/reports/${id}/pdf`, "report.pdf"); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <>
      <Link href="/reports" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Reports</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{q.data.title}</h1>
          <p className="mt-1 text-sm text-muted">{c.organization} · generated {formatDateTime(q.data.createdAt)} by {c.generatedBy}</p>
        </div>
        <div className="flex gap-2">
          <Can permission="reports:delete"><Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm(true)} aria-label="Delete report" /></Can>
          <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={pdf}>Export PDF</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Security score" bodyClassName="flex justify-center py-6"><ScoreGauge score={s.score} grade={s.grade} size={180} /></Card>
        <Card title="Executive summary" className="lg:col-span-2">
          <p className="text-sm leading-relaxed">{s.narrative}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[["Risk level", s.riskLevel], ["Open issues", s.openFindings], ["Verified assets", s.verifiedAssets], ["Resolved (30d)", s.resolvedLast30Days]].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border border-line bg-canvas/40 p-3"><dt className="label">{k}</dt><dd className="mt-1 text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Severity distribution"><SeverityBars counts={s.severityCounts} /></Card>
        <Card title="Priority recommendations" className="lg:col-span-2">
          {c.recommendations.length === 0 ? <p className="text-sm text-muted">No outstanding actions.</p> : (
            <ol className="space-y-4">
              {c.recommendations.map((r) => (
                <li key={r.priority} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{r.priority}</span>
                  <div>
                    <div className="text-sm font-medium">{r.title} <span className="font-normal text-faint">· {r.affected} asset(s)</span></div>
                    <p className="mt-0.5 text-sm text-muted">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Affected assets" className="lg:col-span-3" bodyClassName="p-0">
          <Table head={["Asset", "Type", "Open issues", "Highest severity"]}>
            {c.assets.map((a) => (
              <tr key={a.id}>
                <td className="px-5 py-3 font-mono text-xs">{a.value}</td>
                <td className="px-5 py-3 text-muted">{assetTypeLabel[a.type]}</td>
                <td className="px-5 py-3 tabular-nums">{a.open}</td>
                <td className="px-5 py-3">{a.worst ? <SeverityBadge severity={a.worst} /> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Findings (${c.findings.length})`} className="lg:col-span-3" bodyClassName="p-0">
          <Table head={["Severity", "Finding", "Asset", "First seen"]}>
            {c.findings.map((f) => (
              <tr key={f.id}>
                <td className="px-5 py-3"><SeverityBadge severity={f.severity} /></td>
                <td className="px-5 py-3">{f.title}</td>
                <td className="px-5 py-3 font-mono text-xs text-muted">{f.asset}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDate(f.firstSeenAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete report?" description="The report snapshot will be permanently removed."
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete</Button></>}>
        <p className="text-sm">{q.data.title}</p>
      </Modal>
    </>
  );
}
