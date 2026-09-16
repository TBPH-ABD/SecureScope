"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface Notification { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }

export function Notifications() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: () => api.post("/notifications/read", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-muted hover:bg-raised hover:text-ink"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sev-critical px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-2rem))] animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-accent hover:underline" onClick={() => markRead.mutate()}>Mark all read</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {q.isError && <p className="px-4 py-6 text-center text-sm text-muted">Could not load notifications.</p>}
            {q.data?.items.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
                <BellOff className="h-5 w-5 text-faint" />
                You&apos;re all caught up.
              </div>
            )}
            {q.data?.items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "/monitoring"}
                onClick={() => setOpen(false)}
                className="flex gap-3 border-b border-line/40 px-4 py-3 last:border-0 hover:bg-raised"
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{n.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{n.body}</span>
                  <span className="mt-1 block text-[11px] text-faint">{timeAgo(n.createdAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
