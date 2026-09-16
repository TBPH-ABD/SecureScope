"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button, CodeBlock, Field, fieldErrors, InlineError, Input, Modal, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";
import type { Asset, Verification } from "@/lib/types";

export function VerificationPanel({ asset, verification }: { asset: Asset; verification: Verification | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [attesting, setAttesting] = useState(false);
  const verify = useMutation({
    mutationFn: () => api.post<{ verified: boolean; message?: string }>(`/assets/${asset.id}/verify`),
    onSuccess: (r) => {
      if (r.verified) {
        toast.success("Ownership verified — scanning is now enabled");
        qc.invalidateQueries({ queryKey: ["asset", asset.id] });
        qc.invalidateQueries({ queryKey: ["assets"] });
      } else toast.info(r.message ?? "Not verified yet");
    },
    onError: toast.error,
  });

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Copied"));

  return (
    <div className="card overflow-hidden border-sev-medium/30">
      <div className="flex items-start gap-3 border-b border-sev-medium/20 bg-sev-medium/5 px-5 py-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-sev-medium" />
        <div>
          <h2 className="text-sm font-semibold">Authorization required before scanning</h2>
          <p className="mt-0.5 text-sm text-muted">
            SecureScope never probes an asset until your organization proves it owns it or records explicit permission to test it.
          </p>
        </div>
      </div>
      {!verification ? (
        <p className="px-5 py-4 text-sm text-muted">Ask a Security Administrator or Owner to complete verification.</p>
      ) : (
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">{asset.type === "IP_ADDRESS" ? "Option 1 · Verified hostname" : "Option 1 · DNS TXT record"}</h3>
            <p className="mt-1 text-xs text-muted">
              {asset.type === "IP_ADDRESS"
                ? "This IP is authorized automatically when a domain or subdomain verified in your organization resolves to it (A/AAAA record). Verify that host first, then check again."
                : asset.type === "DOMAIN"
                ? "Add this TXT record at your DNS provider, then click Verify."
                : verification.parentDomain
                  ? <>Verify the parent domain <span className="font-mono text-ink">{verification.parentDomain}</span>, or add this TXT record on the host itself.</>
                  : "Add this TXT record on a hostname you control."}
            </p>
            {verification.txtRecordName && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="label">Host</span>
                  <button className="text-faint hover:text-ink" onClick={() => copy(verification.txtRecordName!)} aria-label="Copy host"><Copy className="h-3.5 w-3.5" /></button>
                </div>
                <CodeBlock>{verification.txtRecordName}</CodeBlock>
                <div className="flex items-center justify-between gap-2">
                  <span className="label">TXT value</span>
                  <button className="text-faint hover:text-ink" onClick={() => copy(verification.txtRecordValue)} aria-label="Copy value"><Copy className="h-3.5 w-3.5" /></button>
                </div>
                <CodeBlock>{verification.txtRecordValue}</CodeBlock>
              </div>
            )}
            <Button className="mt-4" icon={<ShieldCheck className="h-4 w-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>
              Check verification
            </Button>
          </div>
          {verification.attestationAllowed && (
            <div className="rounded-xl border border-line bg-canvas/40 p-4">
              <h3 className="text-sm font-medium">Option 2 · Written authorization</h3>
              <p className="mt-1 text-xs text-muted">
                For hosted infrastructure you do not control through DNS (e.g. a provider-assigned IP), an organization Owner can
                record that the asset owner granted written permission to test it. The record is time-limited and audited.
              </p>
              <Can permission="assets:attest" fallback={<p className="mt-3 text-xs text-faint">Only the organization Owner can record an authorization.</p>}>
                <Button variant="secondary" className="mt-4" onClick={() => setAttesting(true)}>Record authorization</Button>
              </Can>
            </div>
          )}
        </div>
      )}
      <AttestationModal assetId={asset.id} open={attesting} onClose={() => setAttesting(false)} />
    </div>
  );
}

export function AttestationModal({ assetId, open, onClose }: { assetId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const defaultDate = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ authorizerName: "", scopeNote: "", validUntil: defaultDate, confirm: false });
  const m = useMutation({
    mutationFn: () => api.post(`/assets/${assetId}/attestations`, { ...form, validUntil: new Date(`${form.validUntil}T23:59:59Z`).toISOString() }),
    onSuccess: () => {
      toast.success("Authorization recorded");
      qc.invalidateQueries({ queryKey: ["asset", assetId] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record testing authorization"
      description="This creates an auditable record that your organization is legally permitted to perform security testing on this asset."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!form.confirm} loading={m.isPending} onClick={() => m.mutate()}>Record authorization</Button></>}
    >
      <div className="space-y-4">
        <Field label="Authorized by (person or entity that owns the asset)" error={errs.authorizerName}>
          {(id) => <Input id={id} placeholder="Jane Doe, IT Director — Example Hosting Ltd." value={form.authorizerName} onChange={(e) => setForm({ ...form, authorizerName: e.target.value })} />}
        </Field>
        <Field label="Scope and reference" hint="Describe what was authorized and where the written permission is stored (contract, ticket, email)." error={errs.scopeNote}>
          {(id) => <Textarea id={id} value={form.scopeNote} onChange={(e) => setForm({ ...form, scopeNote: e.target.value })} />}
        </Field>
        <Field label="Valid until" hint="Maximum 12 months. Scanning stops automatically after this date." error={errs.validUntil}>
          {(id) => <Input id={id} type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />}
        </Field>
        <label className="flex items-start gap-3 rounded-lg border border-line bg-canvas/40 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 accent-cyan-400" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} />
          <span className="text-muted">I confirm that my organization owns this asset or holds explicit written permission from its owner to perform external security scanning on it.</span>
        </label>
        {!Object.keys(errs).length && <InlineError error={m.error} />}
      </div>
    </Modal>
  );
}
