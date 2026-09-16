export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <path d="M16 3.5l10 3.9v7.6c0 6.2-4.2 11.1-10 13-5.8-1.9-10-6.8-10-13V7.4L16 3.5z" fill="rgb(34 211 238 / 0.08)" stroke="rgb(34 211 238)" strokeWidth="1.6" />
        <circle cx="16" cy="15" r="5.5" fill="none" stroke="rgb(34 211 238 / 0.5)" strokeWidth="1" />
        <circle cx="16" cy="15" r="2.4" fill="rgb(34 211 238)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        Secure<span className="text-accent">Scope</span>
      </span>
    </span>
  );
}
