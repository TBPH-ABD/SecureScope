"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button, InlineError, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { Scan } from "@/lib/types";

export function ScanButton({ assetId, assetValue, modules, disabled, busy }: {
  assetId: string;
  assetValue: string;
  modules: Array<{ id: string; name: string; description: string }>;
  disabled?: boolean;
  busy?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(modules.map((m) => m.id));
  const [confirmed, setConfirmed] = useState(false);

  const start = useMutation({
    mutationFn: () =>
      api.post<Scan>("/scans", { assetId, modules: selected.length === modules.length ? [] : selected }),
    onSuccess: (scan) => {
      toast.success("Scan queued");
      qc.invalidateQueries({ queryKey: ["asset", assetId] });
      qc.invalidateQueries({ queryKey: ["scans"] });
      setOpen(false);
      router.push(`/scans/${scan.id}`);
    },
  });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <Button icon={<Radar className="h-4 w-4" />} disabled={disabled || busy} loading={busy} onClick={() => { setConfirmed(false); setOpen(true); }}
        title={disabled ? "Verify this asset before scanning" : undefined}>
        {busy ? "Scan in progress" : "Run scan"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Run security scan"
        description={<>Target: <span className="font-mono text-ink">{assetValue}</span></>}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!selected.length || !confirmed} loading={start.isPending} onClick={() => start.mutate()}>Start scan</Button>
          </>
        }
      >
        <fieldset className="space-y-2">
          <legend className="label mb-2">Checks</legend>
          {modules.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:border-faint/50">
              <input type="checkbox" className="mt-0.5 accent-cyan-400" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              <span>
                <span className="block text-sm">{m.name}</span>
                <span className="block text-xs text-muted">{m.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-accent/20 bg-accent/5 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 accent-cyan-400" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span className="text-muted">I confirm this scan is within my organization&apos;s authorized scope. Checks are non-intrusive but do send network traffic to the target.</span>
        </label>
        <div className="mt-3"><InlineError error={start.error} /></div>
      </Modal>
    </>
  );
}
