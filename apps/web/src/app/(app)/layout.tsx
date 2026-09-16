"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Logo } from "@/components/logo";
import { ErrorState, Spinner } from "@/components/ui";
import { AuthProvider, useMeQuery } from "@/lib/auth";

export default function AppLayout({ children }: { children: ReactNode }) {
  const me = useMeQuery();

  if (me.isPending) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Logo />
        <Spinner />
      </div>
    );
  }
  if (me.isError) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return <ErrorState error={me.error} />;
  }
  return (
    <AuthProvider me={me.data}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
