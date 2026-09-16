export type Role = "OWNER" | "SECURITY_ADMIN" | "ANALYST" | "VIEWER";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type FindingStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ACCEPTED";
export type AssetType = "DOMAIN" | "SUBDOMAIN" | "IP_ADDRESS" | "APPLICATION" | "OTHER";
export type AuthorizationStatus = "PENDING" | "VERIFIED" | "REVOKED";
export type ScanStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "BLOCKED";

export interface Me {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string };
  role: Role;
  permissions: string[];
  csrfToken: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssetRef {
  id: string;
  value: string;
  type: AssetType;
}

export interface Asset {
  id: string;
  type: AssetType;
  value: string;
  label: string | null;
  description: string | null;
  tags: string[];
  criticality: Severity;
  authorizationStatus: AuthorizationStatus;
  verificationMethod: string | null;
  verifiedAt: string | null;
  monitoringEnabled: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  openFindings?: number;
  severityCounts?: Partial<Record<Severity, number>>;
}

export interface Verification {
  txtRecordName: string | null;
  txtRecordValue: string;
  parentDomain: string | null;
  attestationAllowed: boolean;
}

export interface ModuleRun {
  id: string;
  moduleId: string;
  status: ScanStatus;
  durationMs: number | null;
  error: string | null;
  observations: Record<string, unknown> | null;
}

export interface Scan {
  id: string;
  status: ScanStatus;
  trigger: "MANUAL" | "SCHEDULED";
  modules: string[];
  error: string | null;
  findingsNew: number;
  findingsTotal: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  asset: AssetRef;
  moduleRuns?: ModuleRun[];
}

export interface FindingSummary {
  id: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  moduleId: string;
  checkId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  asset: AssetRef;
}

export interface ChangeEvent {
  id: string;
  kind: string;
  severity: Severity;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
  asset?: { id: string; value: string } | null;
}

export type SeverityCounts = Record<Severity, number>;
