"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PasswordHint } from "@/components/password-hint";
import { Button, Field, fieldErrors, InlineError, Input } from "@/components/ui";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", organizationName: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const errs = fieldErrors(error);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/register", form);
      router.replace("/assets?onboarding=1");
      router.refresh();
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">Create your organization</h2>
      <p className="mt-1 text-sm text-muted">You will be the organization owner.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field label="Full name" error={errs.name}>
          {(id) => <Input id={id} autoComplete="name" required value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Organization" error={errs.organizationName}>
          {(id) => <Input id={id} autoComplete="organization" required value={form.organizationName} onChange={set("organizationName")} />}
        </Field>
        <Field label="Work email" error={errs.email}>
          {(id) => <Input id={id} type="email" autoComplete="email" required value={form.email} onChange={set("email")} />}
        </Field>
        <Field label="Password" error={errs.password}>
          {(id) => (
            <>
              <Input id={id} type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} />
              <PasswordHint value={form.password} />
            </>
          )}
        </Field>
        {!Object.keys(errs).length && <InlineError error={error} />}
        <Button type="submit" className="w-full" loading={loading}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
      </p>
    </>
  );
}
