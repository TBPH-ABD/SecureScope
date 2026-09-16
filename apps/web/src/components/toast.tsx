"use client";

import clsx from "clsx";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "success" | "error" | "info";
interface ToastItem { id: number; tone: Tone; message: string }

const ToastContext = createContext<(tone: Tone, message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100%-2rem))] flex-col gap-2">
        {items.map((t) => {
          const I = Icon[t.tone];
          return (
            <div key={t.id} className={clsx(
              "pointer-events-auto flex animate-fade-in items-start gap-3 rounded-xl border bg-surface/95 px-4 py-3 text-sm shadow-xl backdrop-blur",
              t.tone === "success" && "border-ok/30", t.tone === "error" && "border-sev-critical/40", t.tone === "info" && "border-accent/30",
            )}>
              <I className={clsx("mt-0.5 h-4 w-4 shrink-0", t.tone === "success" && "text-ok", t.tone === "error" && "text-sev-critical", t.tone === "info" && "text-accent")} />
              <span className="text-ink">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (m: string) => push("success", m),
    error: (e: unknown) => push("error", e instanceof Error ? e.message : String(e)),
    info: (m: string) => push("info", m),
  };
}
