import Link from "next/link";
import { sevDot } from "@/components/ui";
import { SEVERITIES, severityLabel } from "@/lib/format";
import type { SeverityCounts } from "@/lib/types";

/** Labeled horizontal bars — each row carries its name and count, so color is never the only cue. */
export function SeverityBars({ counts }: { counts: SeverityCounts }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <ul className="space-y-3">
      {SEVERITIES.map((s) => (
        <li key={s}>
          <Link
            href={`/findings?severity=${s}&status=OPEN,IN_PROGRESS`}
            className="group grid grid-cols-[112px_1fr_36px] items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            title={`${counts[s]} open ${severityLabel[s].toLowerCase()} finding(s)`}
          >
            <span className="flex items-center gap-2 text-sm text-muted group-hover:text-ink">
              <span className={`h-2 w-2 shrink-0 rounded-full ${sevDot[s]}`} />
              {severityLabel[s]}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-raised">
              <span
                className={`block h-full rounded-full ${sevDot[s]} transition-[width] duration-700`}
                style={{ width: `${counts[s] ? Math.max(4, (counts[s] / max) * 100) : 0}%` }}
              />
            </span>
            <span className="text-right text-sm font-medium tabular-nums text-ink">{counts[s]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
