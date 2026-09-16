"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api, setCsrfToken } from "./api";
import type { Me } from "./types";

const AuthContext = createContext<{ me: Me; can: (permission: string) => boolean } | null>(null);

export function useMeQuery() {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (query.data) setCsrfToken(query.data.csrfToken);
  }, [query.data]);
  return query;
}

export function AuthProvider({ me, children }: { me: Me; children: ReactNode }) {
  setCsrfToken(me.csrfToken);
  const can = (permission: string) => me.permissions.includes(permission);
  return <AuthContext.Provider value={{ me, can }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Render children only when the current user holds the permission (UI hint only; the API enforces). */
export function Can({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setCsrfToken(null);
      qc.clear();
      window.location.href = "/login";
    }
  };
}
