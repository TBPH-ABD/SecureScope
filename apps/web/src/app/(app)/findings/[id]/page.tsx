"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import {
  Button, Card, CodeBlock, ErrorState, Field, fieldErrors, InlineError, Modal, Select, SeverityBadge, Skeleton, StatusBadge, Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { Can, useAuth } from "@/lib/auth";
import { assetTypeLabel, formatDateTime, moduleLabel, timeAgo } from "@/lib/format";
import type { AssetType, FindingStatus, Severity } from "@/lib/types";

interface FindingDetail {
  id: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  moduleId: string;
  checkId: string;
  description: string;
  remediation: string;
  evidence: Record<string, unknown>;
  references: string[];
  acceptedReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  asset: { id: string; value: string; type: AssetType; criticality: Severity };
  assignee: { id: string; name: string; email: string } | null;
  comments: Array<{ id: string; body: string; createdAt: string; author: { name: string; email: string } | null }>;
  history: Array<{ id: string; action: string; actorEmail: string | null; metadata: Record<string, unknown> | null; createdAt: string }>;
}

const STATUSES: Array<{ id: FindingStatus; label: string }> = [
  { id: "OPEN", label: "Open" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "RESOLVED", label: "Resolved" },
  { id: "ACCEPTED", label: "Accepted risk" },
];

export default function FindingPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [comment, setComment] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState("");

  const q = useQuery({ queryKey: ["finding", id], queryFn: () => api.get<FindingDetail>(`/findings/${id}`) });
  const team = useQuery({
    queryKey: ["team"],
    queryFn: () => api.get<{ members: Array<{ user: { id: string; name: string } }> }>("/team"),
    enabled: can("findings:update"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["finding", id] });
    qc.invalidateQueries({ queryKey: ["findings"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const update = useMutation({
    mutationFn: (body: { status?: FindingStatus; acceptedReason?: string; assigneeId?: string | null }) => api.patch(`/findings/${id}`, body),
    onSuccess: () => { invalidate(); toast.success("Finding updated"); setAccepting(false); setReason(""); },
  });
  const addComment = useMutation({
    mutationFn: () => api.post(`/findings/${id}/comments`, { body: comment }),
    onSuccess: () => { setComment(""); invalidate(); },
    onError: toast.error,
  });

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (q.isError) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const f = q.data;

  const changeStatus = (s: FindingStatus) => {
    if (s === f.status) return;
    if (s === "ACCEPTED") setAccepting(true);
    else update.mutate({ status: s }, { onError: toast.error });
  };
  const statusOptions = STATUSES.filter((s) => can("findings:accept") || (s.id !== "ACCEPTED" && f.status !== "ACCEPTED") || s.id === f.status);

  return (
    <>
      <Link href="/findings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Findings
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <StatusBadge status={f.status} />
            <span className="text-xs text-faint">{moduleLabel[f.moduleId] ?? f.moduleId} · <span className="font-mono">{f.checkId}</span></span>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{f.title}</h1>
          <p className="mt-1 text-sm text-muted">
            on <Link href={`/assets/${f.asset.id}`} className="font-mono text-ink hover:text-accent">{f.asset.value}</Link> · first seen {timeAgo(f.firstSeenAt)} · last seen {timeAgo(f.lastSeenAt)}
          </p>
        </div>
        <Can permission="findings:update">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-auto" value={f.status} onChange={(e) => changeStatus(e.target.value as FindingStatus)} disabled={update.isPending} aria-label="Status">
              {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
        </Can>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Description"><p className="whitespace-pre-line text-sm leading-relaxed text-ink/90">{f.description}</p></Card>
          <Card title="Recommended remediation" className="border-accent/20">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink/90">{f.remediation}</p>
            {f.references.length > 0 && (
              <ul className="mt-4 space-y-1">
                {f.references.map((r) => (
                  <li key={r}>
                    <a href={r} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      {r.replace(/^https?:\/\//, "").slice(0, 80)} <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Evidence" description="Raw observation captured by the scanner at last detection">
            <CodeBlock>{JSON.stringify(f.evidence, null, 2)}</CodeBlock>
          </Card>
          <Card title={<span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-accent" />Discussion</span>}>
            {f.comments.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
            <ul className="space-y-4">
              {f.comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-line/60 bg-canvas/40 p-3">
                  <div className="text-xs text-faint"><span className="text-muted">{c.author?.name ?? "Former member"}</span> · {timeAgo(c.createdAt)}</div>
                  <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
            <Can permission="findings:update">
              <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(); }}>
                <Textarea placeholder="Add a note, remediation progress, ticket link…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
                <div className="flex justify-end"><Button size="sm" type="submit" loading={addComment.isPending} disabled={!comment.trim()}>Comment</Button></div>
              </form>
            </Can>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <dl className="space-y-3 text-sm">
              <div><dt className="label">Asset</dt><dd className="mt-1 break-all font-mono text-xs">{f.asset.value}</dd><dd className="text-xs text-faint">{assetTypeLabel[f.asset.type]}</dd></div>
              <div>
                <dt className="label">Assignee</dt>
                <dd className="mt-1">
                  {can("findings:update") && team.data ? (
                    <Select value={f.assignee?.id ?? ""} onChange={(e) => update.mutate({ assigneeId: e.target.value || null }, { onError: toast.error })} aria-label="Assignee">
                      <option value="">Unassigned</option>
                      {team.data.members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
                    </Select>
                  ) : (
                    f.assignee?.name ?? <span className="text-muted">Unassigned</span>
                  )}
                </dd>
              </div>
              <div><dt className="label">First detected</dt><dd className="mt-1">{formatDateTime(f.firstSeenAt)}</dd></div>
              <div><dt className="label">Last detected</dt><dd className="mt-1">{formatDateTime(f.lastSeenAt)}</dd></div>
              {f.resolvedAt && <div><dt className="label">Resolved</dt><dd className="mt-1">{formatDateTime(f.resolvedAt)}</dd></div>}
              {f.acceptedReason && <div><dt className="label">Risk acceptance</dt><dd className="mt-1 text-muted">{f.acceptedReason}</dd></div>}
            </dl>
          </Card>
          <Card title="Activity">
            {f.history.length === 0 ? (
              <p className="text-sm text-muted">No manual changes yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-4">
                {f.history.map((h) => (
                  <li key={h.id} className="text-xs">
                    <span className="absolute -left-[4.5px] mt-1 h-2 w-2 rounded-full bg-line" />
                    <div className="text-ink">
                      {h.action === "finding.comment" ? "Commented" : h.metadata?.to ? `Status → ${String(h.metadata.to).replace("_", " ").toLowerCase()}` : "Updated"}
                    </div>
                    <div className="text-faint">{h.actorEmail ?? "system"} · {timeAgo(h.createdAt)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={accepting}
        onClose={() => setAccepting(false)}
        title="Accept this risk?"
        description="Accepted findings are excluded from the security score. Record why the organization accepts this risk."
        footer={<><Button variant="secondary" onClick={() => setAccepting(false)}>Cancel</Button><Button loading={update.isPending} onClick={() => update.mutate({ status: "ACCEPTED", acceptedReason: reason })}>Accept risk</Button></>}
      >
        <Field label="Justification" error={fieldErrors(update.error).acceptedReason}>
          {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Legacy system scheduled for decommission on 2026-12-01; compensating control: IP allow-list." />}
        </Field>
        {!fieldErrors(update.error).acceptedReason && <div className="mt-3"><InlineError error={update.error} /></div>}
      </Modal>
    </>
  );
}
