import { ShieldCheck, Radar, FileLock2 } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

const points = [
  { icon: Radar, title: "Continuous external monitoring", body: "DNS, TLS, headers and exposed services checked on a schedule." },
  { icon: ShieldCheck, title: "Authorization-first scanning", body: "Only assets you prove you own, or are permitted to test, are ever probed." },
  { icon: FileLock2, title: "Board-ready reporting", body: "Executive summaries and remediation plans exported to PDF." },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line/60 bg-surface lg:block">
        <div className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
        <div className="absolute -left-40 top-1/3 h-[480px] w-[480px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo />
          <div className="max-w-md">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              See your organization the way <span className="text-accent">attackers do.</span>
            </h1>
            <p className="mt-3 text-muted">External attack surface management built for small and mid-sized teams.</p>
            <ul className="mt-10 space-y-6">
              {points.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-accent">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-sm text-muted">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-faint">Scanning is limited to assets with verified ownership or written authorization.</p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  );
}
