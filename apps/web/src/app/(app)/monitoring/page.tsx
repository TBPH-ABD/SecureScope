"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, KeyRound, Mail, Plug, RefreshCw, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import {
  Button, Card, EmptyState, ErrorState, Field, fieldErrors, InlineError, Input, PageHeader, Pagination, Select, SeverityBadge, Skeleton, Table, TableSkeleton, Tabs, Tag,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { Can, useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, SEVERITIES, severityLabel, timeAgo } from "@/lib/format";
import type { ChangeEvent, Paged, Severity } from "@/lib/types";

interface MonitoringState {
  schedule: { enabled: boolean; intervalHours: number; lastRunAt: string | null; nextRunAt: string } | null;
  monitoredAssets: number;
  settings: { alertEmails: string[]; webhookUrl: string | null; minAlertSeverity: Severity } | null;
  integrations: { email: boolean; breachProvider: string | null };
}

function EventsTab() {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("");
  const q = useQuery({
    queryKey: ["events", page, severity],
    queryFn: () => api.get<Paged<ChangeEvent>>("/monitoring/events", { page, severity }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="card">
      <div className="flex justify-end border-b border-line/60 p-4">
        <Select className="w-auto" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label="Severity">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{severityLabel[s]}</option>)}
        </Select>
      </div>
      {q.isPending ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
        <EmptyState icon={<Activity className="h-5 w-5" />} title="No changes detected" description="SecureScope compares every scan with the previous one and records DNS, certificate, port and policy changes here." />
      ) : (
        <>
          <Table head={["Severity", "Change", "Type", "Detected"]}>
            {q.data.items.map((e) => (
              <tr key={e.id}>
                <td className="px-5 py-3"><SeverityBadge severity={e.severity} /></td>
                <td className="px-5 py-3">
                  <div>{e.summary}</div>
                  {Array.isArray(e.details.added) && (e.details.added as string[]).length > 0 && <div className="mt-1 font-mono text-[11px] text-ok">+ {(e.details.added as string[]).join(", ")}</div>}
                  {Array.isArray(e.details.removed) && (e.details.removed as string[]).length > 0 && <div className="font-mono text-[11px] text-sev-critical">− {(e.details.removed as string[]).join(", ")}</div>}
                </td>
                <td className="px-5 py-3"><Tag>{e.kind}</Tag></td>
                <td className="whitespace-nowrap px-5 py-3 text-muted" title={formatDateTime(e.createdAt)}>{timeAgo(e.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

interface BreachMonitors {
  configured: boolean;
  provider: string;
  monitors: Array<{ id: string; domain: string; lastCheckedAt: string | null; lastError: string | null; _count: { exposures: number } }>;
}
interface Exposure { id: string; emailMasked: string; breachName: string; breachDate: string | null; dataClasses: string[]; firstSeenAt: string }

function Exposures({ monitorId }: { monitorId: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["exposures", monitorId, page], queryFn: () => api.get<Paged<Exposure>>(`/monitoring/breach-monitors/${monitorId}/exposures`, { page }), placeholderData: keepPreviousData });
  if (q.isPending) return <TableSkeleton rows={3} cols={4} />;
  if (q.isError) return <ErrorState compact error={q.error} />;
  if (!q.data.items.length) return <p className="px-5 py-6 text-sm text-muted">No exposures found for this domain.</p>;
  return (
    <>
      <Table head={["Account", "Breach", "Breach date", "Exposed data types"]}>
        {q.data.items.map((x) => (
          <tr key={x.id}>
            <td className="px-5 py-3 font-mono text-xs">{x.emailMasked}</td>
            <td className="px-5 py-3">{x.breachName}</td>
            <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDate(x.breachDate)}</td>
            <td className="px-5 py-3"><span className="flex flex-wrap gap-1">{x.dataClasses.slice(0, 6).map((d) => <Tag key={d}>{d}</Tag>)}</span></td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
    </>
  );
}

function BreachTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [domain, setDomain] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["breach-monitors"], queryFn: () => api.get<BreachMonitors>("/monitoring/breach-monitors"), enabled: can("breach:read") });
  const add = useMutation({
    mutationFn: () => api.post("/monitoring/breach-monitors", { domain }),
    onSuccess: () => { setDomain(""); qc.invalidateQueries({ queryKey: ["breach-monitors"] }); toast.success("Domain added to breach monitoring"); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/monitoring/breach-monitors/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["breach-monitors"] }), onError: toast.error });
  const check = useMutation({ mutationFn: (id: string) => api.post(`/monitoring/breach-monitors/${id}/check`), onSuccess: () => toast.info("Breach check queued"), onError: toast.error });

  if (!can("breach:read")) return <div className="card"><ErrorState error={new ApiError(403, "FORBIDDEN", "Forbidden")} /></div>;
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p className="text-muted">
          Breach monitoring reports which company mailboxes appear in publicly known data breaches. Addresses are masked, and
          <span className="text-ink"> passwords or other credentials are never retrieved, stored or displayed.</span> Only verified domains can be monitored.
        </p>
      </div>
      {!q.data.configured && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-sev-medium/30 bg-sev-medium/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sev-medium" />
          <div>
            <div className="font-medium">Breach intelligence provider not configured</div>
            <p className="mt-0.5 text-muted">
              Set <code className="font-mono text-ink">HIBP_API_KEY</code> on the server to enable checks (Have I Been Pwned domain search — the domain must also be verified in your HIBP dashboard).
              Domains can be added now and will be checked once the provider is configured.
            </p>
          </div>
        </div>
      )}
      <Can permission="breach:manage">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Input className="max-w-xs font-mono" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain" />
          <Button type="submit" loading={add.isPending} disabled={!domain}>Monitor domain</Button>
          <div className="w-full"><InlineError error={add.error} /></div>
        </form>
      </Can>
      <div className="card">
        {q.data.monitors.length === 0 ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} title="No monitored email domains" description="Add a verified domain to watch for exposed company accounts." />
        ) : (
          <ul className="divide-y divide-line/50">
            {q.data.monitors.map((m) => (
              <li key={m.id}>
                <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                    <div className="font-mono text-sm">@{m.domain}</div>
                    <div className="text-xs text-faint">
                      {m.lastCheckedAt ? `Checked ${timeAgo(m.lastCheckedAt)}` : "Not checked yet"}
                      {m.lastError && <span className="text-sev-critical"> · {m.lastError}</span>}
                    </div>
                  </button>
                  <span className={`text-sm tabular-nums ${m._count.exposures ? "text-sev-high" : "text-muted"}`}>{m._count.exposures} exposure(s)</span>
                  <Can permission="breach:manage">
                    <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={!q.data.configured} onClick={() => check.mutate(m.id)}>Check now</Button>
                    <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => remove.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button>
                  </Can>
                </div>
                {open === m.id && <div className="border-t border-line/50 bg-canvas/30"><Exposures monitorId={m.id} /></div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SettingsTab({ state }: { state: MonitoringState }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [schedule, setSchedule] = useState({ enabled: state.schedule?.enabled ?? true, intervalHours: state.schedule?.intervalHours ?? 24 });
  const [settings, setSettings] = useState({
    alertEmails: state.settings?.alertEmails.join(", ") ?? "",
    webhookUrl: state.settings?.webhookUrl ?? "",
    minAlertSeverity: state.settings?.minAlertSeverity ?? "HIGH",
  });
  const saveSchedule = useMutation({
    mutationFn: () => api.put("/monitoring/schedule", schedule),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monitoring"] }); toast.success("Schedule saved"); },
    onError: toast.error,
  });
  const saveSettings = useMutation({
    mutationFn: () => api.put("/monitoring/settings", {
      alertEmails: settings.alertEmails.split(",").map((s) => s.trim()).filter(Boolean),
      webhookUrl: settings.webhookUrl.trim() || null,
      minAlertSeverity: settings.minAlertSeverity,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monitoring"] }); toast.success("Alert settings saved"); },
  });
  const errs = fieldErrors(saveSettings.error);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Scan schedule" description="Verified assets with monitoring enabled are re-scanned automatically.">
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="accent-cyan-400" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
            Continuous monitoring enabled
          </label>
          <Field label="Frequency">
            {(id) => (
              <Select id={id} value={schedule.intervalHours} onChange={(e) => setSchedule({ ...schedule, intervalHours: Number(e.target.value) })}>
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Daily</option>
                <option value={72}>Every 3 days</option>
                <option value={168}>Weekly</option>
              </Select>
            )}
          </Field>
          <Button loading={saveSchedule.isPending} onClick={() => saveSchedule.mutate()}>Save schedule</Button>
        </div>
      </Card>
      <Card title="Alerting" description="Administrators always receive in-app notifications.">
        <div className="space-y-4">
          <Field label="Minimum severity to alert">
            {(id) => (
              <Select id={id} value={settings.minAlertSeverity} onChange={(e) => setSettings({ ...settings, minAlertSeverity: e.target.value as Severity })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{severityLabel[s]} and above</option>)}
              </Select>
            )}
          </Field>
          <Field label="Alert emails (comma separated)" error={Object.entries(errs).find(([k]) => k.startsWith("alertEmails"))?.[1]}
            hint={state.integrations.email ? "Email delivery is configured." : "SMTP is not configured on the server; emails will not be sent until it is."}>
            {(id) => <Input id={id} placeholder="secops@example.com" value={settings.alertEmails} onChange={(e) => setSettings({ ...settings, alertEmails: e.target.value })} />}
          </Field>
          <Field label="Webhook URL (Slack, Teams, SIEM)" error={errs.webhookUrl} hint="HTTPS only. Receives a JSON payload with the alerts.">
            {(id) => <Input id={id} placeholder="https://hooks.slack.com/services/…" value={settings.webhookUrl} onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })} />}
          </Field>
          {!Object.keys(errs).length && <InlineError error={saveSettings.error} />}
          <Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Save alert settings</Button>
        </div>
      </Card>
    </div>
  );
}

type Tab = "events" | "breaches" | "settings";

function View() {
  const params = useSearchParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "events");
  useEffect(() => { const t = params.get("tab"); if (t) setTab(t as Tab); }, [params]);
  const q = useQuery({ queryKey: ["monitoring"], queryFn: () => api.get<MonitoringState>("/monitoring") });

  const tabs: Array<{ id: Tab; label: string }> = [{ id: "events", label: "Change events" }];
  if (can("breach:read")) tabs.push({ id: "breaches", label: "Email breach monitoring" });
  if (can("monitoring:manage")) tabs.push({ id: "settings", label: "Schedule & alerts" });

  return (
    <>
      <PageHeader title="Monitoring" description="Continuous monitoring of verified assets, change detection and alerting." />
      {q.isPending ? <Skeleton className="mb-6 h-24" /> : q.isError ? <div className="card mb-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="label">Status</div>
            <div className="mt-1.5 flex items-center gap-2 text-sm font-medium">
              <span className={`h-2 w-2 rounded-full ${q.data.schedule?.enabled ? "animate-pulse bg-ok" : "bg-faint"}`} />
              {q.data.schedule?.enabled ? `Active · every ${q.data.schedule.intervalHours}h` : "Paused"}
            </div>
          </div>
          <div className="card p-4"><div className="label">Monitored assets</div><div className="mt-1.5 text-sm font-medium">{q.data.monitoredAssets}</div></div>
          <div className="card p-4"><div className="label">Next run</div><div className="mt-1.5 text-sm font-medium">{q.data.schedule?.enabled ? formatDateTime(q.data.schedule.nextRunAt) : "—"}</div></div>
          <div className="card p-4">
            <div className="label">Integrations</div>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              <span className={`flex items-center gap-1 ${q.data.integrations.email ? "text-ok" : "text-faint"}`}><Mail className="h-3.5 w-3.5" />Email {q.data.integrations.email ? "on" : "off"}</span>
              <span className={`flex items-center gap-1 ${q.data.integrations.breachProvider ? "text-ok" : "text-faint"}`}><Plug className="h-3.5 w-3.5" />Breach intel {q.data.integrations.breachProvider ? "on" : "off"}</span>
            </div>
          </div>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <div className="mt-5">
        {tab === "events" && <EventsTab />}
        {tab === "breaches" && <BreachTab />}
        {tab === "settings" && q.data && <SettingsTab state={q.data} />}
      </div>
    </>
  );
}

export default function MonitoringPage() {
  return <Suspense><View /></Suspense>;
}
