"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/toast";
import { Button, Field, fieldErrors, InlineError, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { assetTypeLabel, SEVERITIES, severityLabel } from "@/lib/format";
import type { Asset, AssetType, Severity } from "@/lib/types";

const placeholders: Record<AssetType, string> = {
  DOMAIN: "example.com",
  SUBDOMAIN: "app.example.com",
  IP_ADDRESS: "203.0.114.10",
  APPLICATION: "https://portal.example.com",
  OTHER: "e.g. Office VPN gateway",
};

const hints: Record<AssetType, string> = {
  DOMAIN: "Registrable domain you own. You will verify it with a DNS TXT record.",
  SUBDOMAIN: "Authorized automatically when its parent domain is verified.",
  IP_ADDRESS: "Authorized when a verified hostname resolves to it, or by an owner's written authorization.",
  APPLICATION: "Full URL. Authorized when its hostname belongs to a verified domain.",
  OTHER: "Tracked for inventory; network scanning is not available for this type.",
};

export function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ type: "DOMAIN" as AssetType, value: "", label: "", description: "", tags: "", criticality: "MEDIUM" as Severity });
  const create = useMutation({
    mutationFn: () =>
      api.post<Asset>("/assets", {
        type: form.type,
        value: form.value,
        label: form.label || undefined,
        description: form.description || undefined,
        criticality: form.criticality,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: (asset) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success(asset.authorizationStatus === "VERIFIED" ? "Asset added and authorized" : "Asset added — verify ownership to enable scanning");
      onClose();
      setForm({ ...form, value: "", label: "", description: "", tags: "" });
      router.push(`/assets/${asset.id}`);
    },
  });
  const errs = fieldErrors(create.error);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add asset"
      description="Only add assets your organization owns or has explicit permission to test."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-asset" loading={create.isPending}>Add asset</Button>
        </>
      }
    >
      <form id="add-asset" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(Object.keys(assetTypeLabel) as AssetType[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setForm({ ...form, type: t })}
              aria-pressed={form.type === t}
              className={`rounded-lg border px-2 py-2 text-xs transition ${form.type === t ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-muted hover:border-faint/50"}`}
            >
              {assetTypeLabel[t]}
            </button>
          ))}
        </div>
        <Field label={assetTypeLabel[form.type]} hint={hints[form.type]} error={errs.value}>
          {(id) => <Input id={id} className="font-mono" placeholder={placeholders[form.type]} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} autoFocus />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label (optional)" error={errs.label}>
            {(id) => <Input id={id} placeholder="Customer portal" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />}
          </Field>
          <Field label="Business criticality">
            {(id) => (
              <Select id={id} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value as Severity })}>
                {SEVERITIES.filter((s) => s !== "INFO").map((s) => <option key={s} value={s}>{severityLabel[s]}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Tags (comma separated)" error={errs["tags.0"]}>
          {(id) => <Input id={id} placeholder="production, eu" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />}
        </Field>
        <Field label="Description (optional)" error={errs.description}>
          {(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
        {!Object.keys(errs).length && <InlineError error={create.error} />}
      </form>
    </Modal>
  );
}
