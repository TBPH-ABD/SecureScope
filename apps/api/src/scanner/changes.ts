import type { Severity } from "@prisma/client";

export interface ChangeDraft {
  kind: string;
  severity: Severity;
  summary: string;
  details: Record<string, unknown>;
}

type Obs = Record<string, any>;

const asSet = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : []);

function listDiff(before: unknown, after: unknown) {
  const b = new Set(asSet(before));
  const a = new Set(asSet(after));
  return { added: [...a].filter((x) => !b.has(x)), removed: [...b].filter((x) => !a.has(x)) };
}

/** Compare the previous and current observations of one module and describe significant changes. */
export function detectChanges(moduleId: string, host: string, before: Obs | null, after: Obs): ChangeDraft[] {
  if (!before) return [];
  const out: ChangeDraft[] = [];

  if (moduleId === "dns") {
    for (const type of ["A", "AAAA", "CNAME", "MX", "NS"]) {
      const d = listDiff(before[type], after[type]);
      if (d.added.length || d.removed.length) {
        out.push({
          kind: "dns.record_changed",
          severity: type === "NS" || type === "MX" ? "HIGH" : "MEDIUM",
          summary: `${type} records changed for ${host}`,
          details: { recordType: type, ...d },
        });
      }
    }
  }

  if (moduleId === "tls" && before.certificate && after.certificate) {
    if (before.certificate.fingerprint256 !== after.certificate.fingerprint256) {
      out.push({
        kind: "tls.certificate_changed",
        severity: before.certificate.issuer !== after.certificate.issuer ? "MEDIUM" : "INFO",
        summary: `TLS certificate replaced on ${host}`,
        details: {
          previous: { issuer: before.certificate.issuer, validTo: before.certificate.validTo },
          current: { issuer: after.certificate.issuer, validTo: after.certificate.validTo },
        },
      });
    }
    if (before.trusted === true && after.trusted === false) {
      out.push({
        kind: "tls.trust_lost",
        severity: "HIGH",
        summary: `TLS certificate on ${host} is no longer trusted`,
        details: { error: after.authorizationError },
      });
    }
  }
  if (moduleId === "tls" && before.reachable === true && after.reachable === false) {
    out.push({ kind: "tls.unreachable", severity: "MEDIUM", summary: `HTTPS stopped responding on ${host}`, details: { error: after.error } });
  }

  if (moduleId === "ports") {
    const ports = (o: Obs) => (Array.isArray(o.open) ? o.open.map((p: { port: number }) => String(p.port)) : []);
    const d = listDiff(ports(before), ports(after));
    if (d.added.length) {
      out.push({ kind: "ports.new_open", severity: "HIGH", summary: `New open port(s) on ${host}: ${d.added.join(", ")}`, details: d });
    }
    if (d.removed.length) {
      out.push({ kind: "ports.closed", severity: "INFO", summary: `Port(s) no longer open on ${host}: ${d.removed.join(", ")}`, details: d });
    }
  }

  if (moduleId === "email-security") {
    for (const key of ["spf", "dmarc"]) {
      const d = listDiff(before[key], after[key]);
      if (d.added.length || d.removed.length) {
        out.push({ kind: `email.${key}_changed`, severity: "MEDIUM", summary: `${key.toUpperCase()} policy changed for ${host}`, details: d });
      }
    }
  }

  if (moduleId === "tech") {
    const names = (o: Obs) => (Array.isArray(o.technologies) ? o.technologies.map((t: { name: string }) => t.name) : []);
    const d = listDiff(names(before), names(after));
    if (d.added.length || d.removed.length) {
      out.push({ kind: "tech.stack_changed", severity: "INFO", summary: `Technology stack changed on ${host}`, details: d });
    }
  }
  return out;
}
