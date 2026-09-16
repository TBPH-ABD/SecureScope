import clsx from "clsx";

const gradeTone = (score: number) =>
  score >= 90 ? "rgb(var(--ok))" : score >= 70 ? "rgb(var(--sev-medium))" : score >= 50 ? "rgb(var(--sev-high))" : "rgb(var(--sev-critical))";

export const gradeText = (score: number) =>
  score >= 90 ? "Strong" : score >= 80 ? "Good" : score >= 70 ? "Fair" : score >= 60 ? "Weak" : "At risk";

/** 270° arc gauge. The number and grade are always printed, so color is never the only signal. */
export function ScoreGauge({ score, grade, size = 200 }: { score: number; grade: string; size?: number }) {
  const r = 80;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const filled = arc * (score / 100);
  const color = gradeTone(score);
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Security score ${score} out of 100, grade ${grade}`}>
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-[225deg]">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="12" strokeDasharray={`${arc} ${c}`} strokeLinecap="round" />
        <circle
          cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          style={{ transition: "stroke-dasharray 900ms cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 10px ${color.replace(")", " / 0.45)")})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-semibold tabular-nums tracking-tight">{score}</span>
        <span className="mt-1 text-xs text-muted">out of 100</span>
        <span className={clsx("mt-2 rounded-md border border-line bg-raised px-2 py-0.5 text-xs font-semibold")}>
          Grade {grade} · {gradeText(score)}
        </span>
      </div>
    </div>
  );
}
