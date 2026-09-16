import type { Severity } from "@prisma/client";

export const SEVERITY_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const WEIGHTS: Record<Severity, number> = { CRITICAL: 25, HIGH: 10, MEDIUM: 4, LOW: 1, INFO: 0 };
// Per-severity caps so that e.g. 40 low findings cannot outweigh one critical.
const CAPS: Record<Severity, number> = { CRITICAL: 60, HIGH: 40, MEDIUM: 25, LOW: 10, INFO: 0 };

export type SeverityCounts = Record<Severity, number>;

export const emptyCounts = (): SeverityCounts => ({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });

/**
 * 100 − Σ penalty. Within one severity each additional finding weighs less
 * (weight × n^0.75), and each severity's total is capped.
 */
export function computeScore(counts: SeverityCounts): number {
  let penalty = 0;
  for (const sev of SEVERITY_ORDER) {
    const n = counts[sev];
    if (n > 0) penalty += Math.min(CAPS[sev], WEIGHTS[sev] * Math.pow(n, 0.75));
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function gradeFor(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export const severityRank = (s: Severity) => SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(s);
export const atLeast = (s: Severity, min: Severity) => severityRank(s) >= severityRank(min);
