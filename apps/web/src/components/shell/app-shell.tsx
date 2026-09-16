"use client";

import clsx from "clsx";
import {
  Boxes, ChevronDown, FileText, Gauge, KeyRound, LogOut, Menu, Radar, ScanSearch, ScrollText, ShieldAlert, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { roleLabel } from "@/lib/format";
import { useAuth, useLogout } from "@/lib/auth";
import { Notifications } from "./notifications";

const NAV = [
  { section: "Overview", items: [{ href: "/", label: "Dashboard", icon: Gauge, perm: "dashboard:read" }] },
  {
    section: "Attack surface",
    items: [
      { href: "/assets", label: "Assets", icon: Boxes, perm: "assets:read" },
      { href: "/scans", label: "Scans", icon: ScanSearch, perm: "scans:read" },
      { href: "/findings", label: "Findings", icon: ShieldAlert, perm: "findings:read" },
      { href: "/monitoring", label: "Monitoring", icon: Radar, perm: "monitoring:read" },
    ],
  },
  { section: "Governance", items: [
    { href: "/reports", label: "Reports", icon: FileText, perm: "reports:read" },
    { href: "/team", label: "Team", icon: Users, perm: "team:read" },
    { href: "/audit", label: "Audit log", icon: ScrollText, perm: "audit:read" },
  ] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, me } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5"><Logo /></div>
      <div className="mx-3 mb-3 rounded-lg border border-line/70 bg-raised/60 px-3 py-2.5">
        <div className="label">Organization</div>
        <div className="mt-0.5 truncate text-sm font-medium">{me.organization.name}</div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(i.perm));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <div className="label px-3 pb-1.5">{group.section}</div>
              <ul className="space-y-0.5">
                {items.map(({ href, label, icon: Icon }) => {
                  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                          active ? "bg-accent/10 text-ink" : "text-muted hover:bg-raised hover:text-ink",
                        )}
                      >
                        {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                        <Icon className={clsx("h-4 w-4", active ? "text-accent" : "text-faint group-hover:text-muted")} />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line/60 px-5 py-3 text-[11px] text-faint">
        Authorized-scope scanning only
      </div>
    </div>
  );
}

function UserMenu() {
  const { me } = useAuth();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const initials = me.user.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-raised">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent/40 to-sev-low/30 text-xs font-semibold">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight">{me.user.name}</span>
          <span className="block text-[11px] text-faint">{roleLabel[me.role]}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-60 animate-fade-in rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium">{me.user.email}</div>
            <div className="text-xs text-faint">{roleLabel[me.role]} · {me.organization.name}</div>
          </div>
          <div className="my-1 h-px bg-line/60" />
          <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink">
            <KeyRound className="h-4 w-4" /> Account security
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-raised hover:text-sev-critical">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line/60 bg-surface/80 backdrop-blur lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-fade-in border-r border-line bg-surface">
            <button className="absolute right-3 top-4 rounded-md p-1.5 text-muted hover:bg-raised" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line/60 bg-canvas/80 px-4 backdrop-blur-md sm:px-6">
          <button className="rounded-md p-2 text-muted hover:bg-raised lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

