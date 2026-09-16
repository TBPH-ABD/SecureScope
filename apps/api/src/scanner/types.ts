import type { AssetType, Severity } from "@prisma/client";
import type { HttpResult } from "./http.js";

export interface ScanTarget {
  assetId: string;
  type: AssetType;
  /** Hostname or IP to probe. For APPLICATION assets, the URL's host. */
  host: string;
  /** Base URL for HTTP checks (APPLICATION assets keep their path). */
  url: string;
  isIp: boolean;
}

export interface ScanContext {
  target: ScanTarget;
  timeoutMs: number;
  ports: number[];
  /** Addresses already validated as public by the engine. */
  addresses: string[];
  /** Memoized SSRF-safe GET of the target's web root (https first, then http). */
  homepage(): Promise<HomepageResult>;
}

export interface HomepageResult {
  https: HttpResult | null;
  httpsError?: string;
  http: HttpResult | null;
  httpError?: string;
}

export interface FindingDraft {
  checkId: string;
  /** Optional discriminator when one check can yield several findings (e.g. port number). */
  detail?: string;
  title: string;
  severity: Severity;
  description: string;
  remediation: string;
  evidence: Record<string, unknown>;
  references?: string[];
}

export interface ModuleResult {
  observations: Record<string, unknown>;
  findings: FindingDraft[];
}

export interface ScannerModule {
  id: string;
  name: string;
  description: string;
  appliesTo: AssetType[];
  run(ctx: ScanContext): Promise<ModuleResult>;
}
