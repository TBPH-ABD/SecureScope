import type { AssetType, Role, Severity } from "./types";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "Never";
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(value);
}

export const formatDate = (value: string | Date | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "—";

export const formatDateTime = (value: string | Date | null | undefined) =>
  value
    ? new Date(value).toLocaleString("en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

export function duration(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export const severityLabel: Record<Severity, string> = {
  CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", INFO: "Informational",
};

export const assetTypeLabel: Record<AssetType, string> = {
  DOMAIN: "Domain", SUBDOMAIN: "Subdomain", IP_ADDRESS: "IP Address", APPLICATION: "Application", OTHER: "Other",
};

export const roleLabel: Record<Role, string> = {
  OWNER: "Owner", SECURITY_ADMIN: "Security Administrator", ANALYST: "Analyst", VIEWER: "Viewer",
};

export const moduleLabel: Record<string, string> = {
  dns: "DNS Records",
  "email-security": "Domain Configuration",
  tls: "SSL/TLS",
  headers: "Security Headers",
  ports: "Exposed Services",
  tech: "Technologies",
};

export const verificationLabel: Record<string, string> = {
  DNS_TXT: "DNS TXT record",
  PARENT_DOMAIN: "Verified parent domain",
  RESOLVES_FROM_VERIFIED: "Resolves from verified host",
  ATTESTATION: "Written authorization",
};
