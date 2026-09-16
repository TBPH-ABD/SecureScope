"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellOff, BellRing, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AttestationModal, VerificationPanel } from "@/components/assets/verification-panel";
import { Observations } from "@/components/assets/observations";
import { FindingsTable } from "@/components/findings-table";
import { ScanButton } from "@/components/scan-button";
import { useToast } from "@/components/toast";
import {
  AuthBadge, Button, Card, EmptyState, ErrorState, Modal, ScanStatusBadge, SeverityBadge, Skeleton, Table, Tabs, Tag,
} from "@/components/ui";
import { api } from "@/lib/api";
import { Can, useAuth } from "@/lib/auth";
import { assetTypeLabel, duration, formatDate, formatDateTime, SEVERITIES, severityLabel, timeAgo, verificationLabel } from "@/lib/format";
import type { Asset, ChangeEvent, Scan, Severity, Verification } from "@/lib/types";

interface AssetDetail extends Asset {
  observations: Record<string, { data: any; updatedAt: string }>;
  severityCounts: Partial<Record<Severity, number>>;
  applicableModules: Array<{ id: string; name: string; description: string }>;
  verification: Verification | null;
  scans: Scan[];
  changeEvents: ChangeEvent[];
  authorizations: Array<{ id: string; authorizerName: string; scopeNote: string; validUntil: string; revokedAt: string | null; createdAt: string }>;
}

type Tab = "overview" | "findings" | "scans" | "changes" | "authorization";

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attesting, setAttesting] = useState(false);

  const q = useQuery({
    queryKey: ["asset", id],
    queryFn: () => api.get<AssetDetail>(`/assets/${id}`),
    refetchInterval: (query) => (query.state.data?.scans.some((s) => s.status === "QUEUED" || s.status === "RUNNING") ? 3000 : false),
  });

  const update = useMutation({
    mutationFn: (body: Partial<Asset>) => api.patch(`/assets/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asset", id] }); toast.success("Asset updated"); },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/assets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); toast.success("Asset deleted"); router.replace("/assets"); },
    onError: toast.error,
  });
  const revoke = useMutation({
    mutationFn: (attestationId: string) => api.delete(`/assets/${id}/attestations/${attestationId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asset", id] }); toast.success("Authorization revoked"); },
    onError: toast.error,
  });

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-10 w-1/2" /><Skeleton className="h-96" /></div>;
  if (q.isError) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const a = q.data;
  const verified = a.authorizationStatus === "VERIFIED";
  const busy = a.scans.some((s) => s.status === "QUEUED" || s.status === "RUNNING");
  const openCount = Object.values(a.severityCounts).reduce((x, y) => x + (y ?? 0), 0);

  return (
    <>
      <Link href="/assets" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Assets
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{assetTypeLabel[a.type]}</span>
            <span>·</span>
            <span>Criticality {severityLabel[a.criticality]}</span>
            {a.tags.map((t) => <Tag key={t}>{t}</Tag>)}
          </div>
          <h1 className="mt-1 break-all font-mono text-xl font-semibold tracking-tight">{a.value}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <AuthBadge status={a.authorizationStatus} />
            {a.verificationMethod && <span className="text-xs text-muted">via {verificationLabel[a.verificationMethod]}</span>}
            {a.label && <span className="text-muted">{a.label}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Can permission="assets:write">
            <Button
              variant="secondary"
              icon={a.monitoringEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              onClick={() => update.mutate({ monitoringEnabled: !a.monitoringEnabled })}
              loading={update.isPending}
            >
              {a.monitoringEnabled ? "Monitoring on" : "Monitoring off"}
            </Button>
          </Can>
          <Can permission="assets:delete">
            <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)} aria-label="Delete asset" />
          </Can>
          {can("scans:run") && a.type !== "OTHER" && (
            <ScanButton assetId={a.id} assetValue={a.value} modules={a.applicableModules} disabled={!verified} busy={busy} />
          )}
        </div>
      </div>

      {!verified && <div className="mb-6"><VerificationPanel asset={a} verification={a.verification} /></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {SEVERITIES.map((s) => (
          <div key={s} className="card px-4 py-3">
            <SeverityBadge severity={s} />
            <div className="mt-2 text-2xl font-semibold tabular-nums">{a.severityCounts[s] ?? 0}</div>
          </div>
        ))}
        <div className="card px-4 py-3">
          <div className="label">Last scan</div>
          <div className="mt-2 text-sm">{timeAgo(a.lastScannedAt)}</div>
        </div>
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "findings", label: `Findings (${openCount})` },
          { id: "scans", label: "Scans" },
          { id: "changes", label: "Changes" },
          { id: "authorization", label: "Authorization" },
        ]}
      />
      <div className="mt-5">
        {tab === "overview" && (
          <>
            {a.description && <p className="mb-4 text-sm text-muted">{a.description}</p>}
            <Observations obs={a.observations} />
          </>
        )}
        {tab === "findings" && <FindingsTable assetId={a.id} />}
        {tab === "scans" && (
          <div className="card">
            {a.scans.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No scans yet" description={verified ? "Run a scan to collect data about this asset." : "Verify the asset to enable scanning."} />
            ) : (
              <Table head={["Status", "Trigger", "Queued", "Duration", "Findings"]}>
                {a.scans.map((s) => (
                  <tr key={s.id} className="hover:bg-raised/40">
                    <td className="px-5 py-3"><Link href={`/scans/${s.id}`}><ScanStatusBadge status={s.status} /></Link></td>
                    <td className="px-5 py-3 text-muted">{s.trigger === "SCHEDULED" ? "Scheduled" : "Manual"}</td>
                    <td className="px-5 py-3 text-muted"><Link href={`/scans/${s.id}`} className="hover:text-accent">{formatDateTime(s.queuedAt)}</Link></td>
                    <td className="px-5 py-3 text-muted">{duration(s.startedAt, s.finishedAt)}</td>
                    <td className="px-5 py-3 tabular-nums">{s.findingsTotal} {s.findingsNew > 0 && <span className="text-sev-high">(+{s.findingsNew})</span>}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
        {tab === "changes" && (
          <div className="card">
            {a.changeEvents.length === 0 ? (
              <EmptyState icon={<BellRing className="h-5 w-5" />} title="No changes recorded" description="Changes are detected by comparing consecutive scans." />
            ) : (
              <ul className="divide-y divide-line/40">
                {a.changeEvents.map((c) => (
                  <li key={c.id} className="flex items-center gap-4 px-5 py-3">
                    <SeverityBadge severity={c.severity} compact />
                    <span className="flex-1 text-sm">{c.summary}</span>
                    <span className="text-xs text-faint">{timeAgo(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === "authorization" && (
          <Card
            title="Authorization record"
            description={verified ? `Verified ${formatDateTime(a.verifiedAt)} via ${verificationLabel[a.verificationMethod ?? ""] ?? "—"}. Re-checked before every scan.` : "Not currently authorized for scanning."}
            action={a.type !== "DOMAIN" && <Can permission="assets:attest"><Button size="sm" variant="secondary" onClick={() => setAttesting(true)}>Add authorization</Button></Can>}
            bodyClassName="p-0"
          >
            {a.authorizations.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No written authorizations recorded for this asset.</p>
            ) : (
              <Table head={["Authorized by", "Scope", "Valid until", "Status", ""]}>
                {a.authorizations.map((z) => {
                  const expired = new Date(z.validUntil) < new Date();
                  return (
                    <tr key={z.id}>
                      <td className="px-5 py-3">{z.authorizerName}</td>
                      <td className="max-w-sm px-5 py-3 text-muted">{z.scopeNote}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDate(z.validUntil)}</td>
                      <td className="px-5 py-3 text-xs">{z.revokedAt ? <span className="text-sev-critical">Revoked</span> : expired ? <span className="text-sev-medium">Expired</span> : <span className="text-ok">Active</span>}</td>
                      <td className="px-5 py-3 text-right">
                        {!z.revokedAt && !expired && (
                          <Can permission="assets:attest">
                            <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate(z.id)}>Revoke</Button>
                          </Can>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        )}
      </div>

      <AttestationModal assetId={a.id} open={attesting} onClose={() => setAttesting(false)} />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete asset?"
        description="This permanently removes the asset with all of its findings, scans and observations."
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete asset</Button></>}
      >
        <p className="font-mono text-sm">{a.value}</p>
      </Modal>
    </>
  );
}
