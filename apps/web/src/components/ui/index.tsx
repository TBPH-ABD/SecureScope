"use client";

import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ApiError } from "@/lib/api";
import { severityLabel } from "@/lib/format";
import type { AuthorizationStatus, FindingStatus, ScanStatus, Severity } from "@/lib/types";

// ─── Button ───────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-canvas hover:bg-accent/90 shadow-[0_0_0_1px_rgb(var(--accent)/0.4),0_8px_24px_-8px_rgb(var(--accent)/0.5)]",
  secondary: "border border-line bg-raised text-ink hover:border-faint/60 hover:bg-raised/70",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  danger: "border border-sev-critical/40 bg-sev-critical/10 text-sev-critical hover:bg-sev-critical/20",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ─── Card ─────────────────────────────────────────────────────────────

export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("card flex animate-fade-in flex-col", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line/60 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx("flex-1 p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────

const sevStyles: Record<Severity, string> = {
  CRITICAL: "bg-sev-critical/15 text-sev-critical ring-sev-critical/30",
  HIGH: "bg-sev-high/15 text-sev-high ring-sev-high/30",
  MEDIUM: "bg-sev-medium/15 text-sev-medium ring-sev-medium/30",
  LOW: "bg-sev-low/15 text-sev-low ring-sev-low/30",
  INFO: "bg-sev-info/10 text-sev-info ring-sev-info/25",
};
export const sevDot: Record<Severity, string> = {
  CRITICAL: "bg-sev-critical",
  HIGH: "bg-sev-high",
  MEDIUM: "bg-sev-medium",
  LOW: "bg-sev-low",
  INFO: "bg-sev-info",
};

const compactLabel: Record<Severity, string> = { CRITICAL: "Crit", HIGH: "High", MEDIUM: "Med", LOW: "Low", INFO: "Info" };

export function SeverityBadge({ severity, compact }: { severity: Severity; compact?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", sevStyles[severity])}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", sevDot[severity], severity === "CRITICAL" && "animate-pulse")} />
      {compact ? compactLabel[severity] : severityLabel[severity]}
    </span>
  );
}

const statusStyles: Record<FindingStatus, [string, string]> = {
  OPEN: ["Open", "text-sev-high bg-sev-high/10 ring-sev-high/25"],
  IN_PROGRESS: ["In Progress", "text-accent bg-accent/10 ring-accent/25"],
  RESOLVED: ["Resolved", "text-ok bg-ok/10 ring-ok/25"],
  ACCEPTED: ["Accepted", "text-muted bg-raised ring-line"],
};
export function StatusBadge({ status }: { status: FindingStatus }) {
  const [label, cls] = statusStyles[status];
  return <span className={clsx("inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", cls)}>{label}</span>;
}

const scanStyles: Record<ScanStatus, [string, string]> = {
  QUEUED: ["Queued", "text-muted bg-raised ring-line"],
  RUNNING: ["Running", "text-accent bg-accent/10 ring-accent/25"],
  COMPLETED: ["Completed", "text-ok bg-ok/10 ring-ok/25"],
  PARTIAL: ["Partial", "text-sev-medium bg-sev-medium/10 ring-sev-medium/25"],
  FAILED: ["Failed", "text-sev-critical bg-sev-critical/10 ring-sev-critical/25"],
  BLOCKED: ["Blocked", "text-sev-critical bg-sev-critical/10 ring-sev-critical/25"],
};
export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const [label, cls] = scanStyles[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", cls)}>
      {(status === "RUNNING" || status === "QUEUED") && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {label}
    </span>
  );
}

const authStyles: Record<AuthorizationStatus, [string, string]> = {
  VERIFIED: ["Verified", "text-ok bg-ok/10 ring-ok/25"],
  PENDING: ["Unverified", "text-sev-medium bg-sev-medium/10 ring-sev-medium/25"],
  REVOKED: ["Revoked", "text-sev-critical bg-sev-critical/10 ring-sev-critical/25"],
};
export function AuthBadge({ status }: { status: AuthorizationStatus }) {
  const [label, cls] = authStyles[status];
  return <span className={clsx("inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", cls)}>{label}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</span>;
}

// ─── Form controls ────────────────────────────────────────────────────

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted">{label}</label>
      {children(id)}
      {error ? <p className="text-xs text-sev-critical">{error}</p> : hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx("input", className)} {...p} />;
});

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("input min-h-[90px] resize-y", className)} {...p} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx("input appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' stroke='%2394a3b8' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...p}>
      {children}
    </select>
  );
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.path, d.message]));
}

// ─── Feedback states ──────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden rounded-md bg-raised", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line/50" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 px-5 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={clsx("h-3.5", c === 0 ? "w-1/3" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-raised text-accent">{icon}</div>
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const forbidden = e?.status === 403;
  return (
    <div role="alert" className={clsx("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-14")}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-sev-critical/30 bg-sev-critical/10 text-sev-critical">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-ink">{forbidden ? "Access restricted" : "Something went wrong"}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">
        {forbidden ? "Your role does not include access to this area. Ask an administrator if you need it." : e?.message ?? "The request could not be completed."}
      </p>
      {onRetry && !forbidden && (
        <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-sev-critical/30 bg-sev-critical/10 px-3 py-2 text-sm text-sev-critical">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-4 w-4 animate-spin text-muted", className)} aria-label="Loading" />;
}

// ─── Table ────────────────────────────────────────────────────────────

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line/60">
            {head.map((h, i) => (
              <th key={i} scope="col" className="label whitespace-nowrap px-5 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/40">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-line/60 px-5 py-3 text-xs text-muted">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, description, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm",
        wide ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="animate-fade-in">
          <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-faint hover:bg-raised hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line/60 px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ─── Misc ─────────────────────────────────────────────────────────────

export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; href?: string }) {
  const body = (
    <div className="card group h-full p-5 transition hover:border-faint/40">
      <div className="label">{label}</div>
      <div className={clsx("mt-2 text-3xl font-semibold tabular-nums tracking-tight", tone ?? "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xl">{body}</Link> : body;
}

export function Tabs<T extends string>({ value, onChange, tabs, bare }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: ReactNode }>; bare?: boolean }) {
  return (
    <div role="tablist" className={clsx("flex gap-1", bare ? "" : "overflow-x-auto border-b border-line/60")}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
            value === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed text-muted">{children}</pre>
  );
}
