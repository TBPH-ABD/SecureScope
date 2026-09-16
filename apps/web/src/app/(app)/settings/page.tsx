"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { PasswordHint } from "@/components/password-hint";
import { useToast } from "@/components/toast";
import { Button, Card, Field, fieldErrors, InlineError, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { roleLabel } from "@/lib/format";

export default function SettingsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const m = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword }),
    onSuccess: () => { toast.success("Password changed. Other sessions were signed out."); setForm({ currentPassword: "", newPassword: "", confirm: "" }); },
  });
  const errs = fieldErrors(m.error);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.newPassword;

  return (
    <>
      <PageHeader title="Account security" />
      <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="space-y-3 text-sm">
            <div><dt className="label">Name</dt><dd className="mt-1">{me.user.name}</dd></div>
            <div><dt className="label">Email</dt><dd className="mt-1">{me.user.email}</dd></div>
            <div><dt className="label">Organization</dt><dd className="mt-1">{me.organization.name}</dd></div>
            <div><dt className="label">Role</dt><dd className="mt-1">{roleLabel[me.role]}</dd></div>
          </dl>
        </Card>
        <Card title="Change password" description="Changing your password signs out all other sessions.">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!mismatch) m.mutate(); }}>
            <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" error={errs.newPassword}>
              {(id) => <><Input id={id} type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /><PasswordHint value={form.newPassword} /></>}
            </Field>
            <Field label="Confirm new password" error={mismatch ? "Passwords do not match" : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />}
            </Field>
            {!errs.newPassword && <InlineError error={m.error} />}
            <Button type="submit" loading={m.isPending} disabled={!form.currentPassword || !form.newPassword || mismatch}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
