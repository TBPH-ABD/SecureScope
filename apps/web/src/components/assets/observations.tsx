import { CheckCircle2, Globe, Lock, Mail, Network, ServerCog, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Card, Tag } from "@/components/ui";
import { formatDate, timeAgo } from "@/lib/format";

type Obs = Record<string, { data: any; updatedAt: string }>;

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-faint">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[12px]">{children}</span>;

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {ok ? <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Pass" /> : <XCircle className="h-4 w-4 text-sev-high" aria-label="Fail" />}
      {children}
    </span>
  );
}

function Section({ icon, title, updatedAt, children }: { icon: ReactNode; title: string; updatedAt: string; children: ReactNode }) {
  return (
    <Card title={<span className="flex items-center gap-2"><span className="text-accent">{icon}</span>{title}</span>} description={`Observed ${timeAgo(updatedAt)}`}>
      {children}
    </Card>
  );
}

const SEC_HEADERS: Array<[string, string]> = [
  ["strict-transport-security", "HSTS"],
  ["content-security-policy", "CSP"],
  ["x-frame-options", "X-Frame-Options"],
  ["x-content-type-options", "X-Content-Type"],
  ["referrer-policy", "Referrer-Policy"],
  ["permissions-policy", "Permissions-Policy"],
];

export function Observations({ obs }: { obs: Obs }) {
  const dns = obs.dns;
  const email = obs["email-security"];
  const tls = obs.tls;
  const headers = obs.headers;
  const ports = obs.ports;
  const tech = obs.tech;

  if (!Object.keys(obs).length) {
    return <p className="py-10 text-center text-sm text-muted">No data yet. Results appear here after the first successful scan.</p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {tls && (
        <Section icon={<Lock className="h-4 w-4" />} title="SSL/TLS" updatedAt={tls.updatedAt}>
          {tls.data.reachable === false ? (
            <p className="text-sm text-muted">No TLS service on port 443 ({tls.data.error}).</p>
          ) : tls.data.certificate ? (
            <dl className="divide-y divide-line/40">
              <KV k="Trust"><Check ok={tls.data.trusted}>{tls.data.trusted ? "Publicly trusted" : tls.data.authorizationError}</Check></KV>
              <KV k="Subject"><Mono>{tls.data.certificate.subject}</Mono></KV>
              <KV k="Issuer"><Mono>{tls.data.certificate.issuer}</Mono></KV>
              <KV k="Expires">
                {formatDate(tls.data.certificate.validTo)}{" "}
                <span className={tls.data.certificate.daysRemaining < 30 ? "text-sev-high" : "text-muted"}>({tls.data.certificate.daysRemaining} days)</span>
              </KV>
              <KV k="Protocol">{tls.data.protocol} · <Mono>{tls.data.cipher}</Mono></KV>
              <KV k="Key">{tls.data.certificate.keyType ?? "—"} {tls.data.certificate.keyBits ? `${tls.data.certificate.keyBits} bit` : ""}</KV>
              <KV k="Legacy TLS"><Check ok={!tls.data.legacyProtocols?.length}>{tls.data.legacyProtocols?.length ? tls.data.legacyProtocols.join(", ") : "Disabled"}</Check></KV>
              <KV k="SANs">
                <span className="flex flex-wrap gap-1">{tls.data.certificate.subjectAltNames.slice(0, 12).map((s: string) => <Tag key={s}>{s.replace(/^DNS:/, "")}</Tag>)}</span>
              </KV>
            </dl>
          ) : (
            <p className="text-sm text-muted">{tls.data.error ?? "No certificate data."}</p>
          )}
        </Section>
      )}

      {headers && (
        <Section icon={<ServerCog className="h-4 w-4" />} title="Security headers" updatedAt={headers.updatedAt}>
          {!headers.data.reachable ? (
            <p className="text-sm text-muted">The web service did not respond.</p>
          ) : (
            (() => {
              const r = headers.data.https ?? headers.data.http;
              return (
                <dl className="divide-y divide-line/40">
                  <KV k="Final URL"><Mono>{r.finalUrl}</Mono> <span className="text-muted">({r.status})</span></KV>
                  {SEC_HEADERS.map(([h, label]) => (
                    <KV key={h} k={label}>
                      <Check ok={Boolean(r.headers[h])}>
                        {r.headers[h] ? <Mono>{String(r.headers[h]).slice(0, 140)}</Mono> : <span className="text-muted">Missing</span>}
                      </Check>
                    </KV>
                  ))}
                  {r.headers.server && <KV k="Server"><Mono>{r.headers.server}</Mono></KV>}
                </dl>
              );
            })()
          )}
        </Section>
      )}

      {ports && (
        <Section icon={<Network className="h-4 w-4" />} title="Exposed services" updatedAt={ports.updatedAt}>
          <p className="mb-3 text-xs text-muted">
            {ports.data.scannedPorts.length} common ports checked on <Mono>{ports.data.address}</Mono> · {ports.data.filteredCount} filtered
          </p>
          {ports.data.open.length === 0 ? (
            <p className="text-sm text-muted">No open ports in the checked range.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {ports.data.open.map((p: { port: number; service: string }) => (
                <li key={p.port} className="flex items-center justify-between rounded-lg border border-line bg-canvas/50 px-3 py-2">
                  <span className="font-mono text-sm">{p.port}/tcp</span>
                  <span className="text-xs text-muted">{p.service}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {tech && (
        <Section icon={<Globe className="h-4 w-4" />} title="Technologies" updatedAt={tech.updatedAt}>
          {tech.data.title && <p className="mb-3 truncate text-sm text-muted">Page title: <span className="text-ink">{tech.data.title}</span></p>}
          {tech.data.technologies?.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {tech.data.technologies.map((t: { name: string; category: string; version?: string; evidence: string }) => (
                <li key={t.name} className="rounded-lg border border-line bg-canvas/50 px-3 py-2" title={t.evidence}>
                  <div className="text-sm">{t.name} {t.version && <span className="font-mono text-xs text-muted">{t.version}</span>}</div>
                  <div className="text-[11px] text-faint">{t.category}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No technologies identified.</p>
          )}
        </Section>
      )}

      {dns && (
        <Section icon={<Network className="h-4 w-4" />} title="DNS records" updatedAt={dns.updatedAt}>
          <dl className="divide-y divide-line/40">
            {(["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA"] as const).map((t) =>
              dns.data[t]?.length ? (
                <KV key={t} k={t}>
                  <ul className="space-y-0.5">{dns.data[t].map((v: string) => <li key={v}><Mono>{v}</Mono></li>)}</ul>
                </KV>
              ) : null,
            )}
          </dl>
        </Section>
      )}

      {email && (
        <Section icon={<Mail className="h-4 w-4" />} title="Domain configuration" updatedAt={email.updatedAt}>
          <dl className="divide-y divide-line/40">
            <KV k="SPF"><Check ok={email.data.spf.length === 1}>{email.data.spf[0] ? <Mono>{email.data.spf[0]}</Mono> : "Not published"}</Check></KV>
            <KV k="DMARC"><Check ok={email.data.dmarc.length > 0}>{email.data.dmarc[0] ? <Mono>{email.data.dmarc[0]}</Mono> : "Not published"}</Check></KV>
            <KV k="MTA-STS"><Check ok={email.data.mtaSts}>{email.data.mtaSts ? "Published" : "Not published"}</Check></KV>
            <KV k="Mail servers">{email.data.mx.length ? email.data.mx.map((m: string) => <div key={m}><Mono>{m}</Mono></div>) : "None"}</KV>
          </dl>
        </Section>
      )}
    </div>
  );
}
