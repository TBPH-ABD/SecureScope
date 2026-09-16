"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PasswordHint } from "@/components/password-hint";
import { Button, ErrorState, Field, fieldErrors, InlineError, Input, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { roleLabel } from "@/lib/format";
import type { Role } from "@/lib/types";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<{ email: string; role: Role; organization: string }>(`/auth/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const errs = fieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/invitations/accept", { token, name, password });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  if (invite.isPending) return <div className="space-y-3"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (invite.isError) return <ErrorState error={invite.error} />;

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">Join {invite.data.organization}</h2>
      <p className="mt-1 text-sm text-muted">
        You were invited as <span className="text-ink">{roleLabel[invite.data.role]}</span>.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field label="Email">{(id) => <Input id={id} value={invite.data.email} disabled />}</Field>
        <Field label="Full name" error={errs.name}>
          {(id) => <Input id={id} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Password" error={errs.password}>
          {(id) => (
            <>
              <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <PasswordHint value={password} />
            </>
          )}
        </Field>
        {!Object.keys(errs).length && <InlineError error={error} />}
        <Button type="submit" className="w-full" loading={loading}>Accept invitation</Button>
      </form>
    </>
  );
}
