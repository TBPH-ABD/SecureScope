"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import {
  Button, Card, CodeBlock, EmptyState, ErrorState, Field, fieldErrors, InlineError, Input, Modal, PageHeader, Select, Table, TableSkeleton,
} from "@/components/ui";
import { api } from "@/lib/api";
import { Can, useAuth } from "@/lib/auth";
import { formatDate, roleLabel, timeAgo } from "@/lib/format";
import type { Role } from "@/lib/types";

interface TeamData {
  members: Array<{ id: string; role: Role; joinedAt: string; isSelf: boolean; user: { id: string; name: string; email: string; lastLoginAt: string | null } }>;
  invitations: Array<{ id: string; email: string; role: Role; expiresAt: string }>;
  emailDelivery: boolean;
}

const ROLES: Role[] = ["OWNER", "SECURITY_ADMIN", "ANALYST", "VIEWER"];
const RANK: Record<Role, number> = { OWNER: 4, SECURITY_ADMIN: 3, ANALYST: 2, VIEWER: 1 };
const ROLE_INFO: Record<Role, string> = {
  OWNER: "Full control, including authorizations, billing-level settings and ownership.",
  SECURITY_ADMIN: "Manage assets, verification, monitoring, team (below admin) and audit log.",
  ANALYST: "Run scans, triage findings and generate reports.",
  VIEWER: "Read-only access to dashboards, assets, findings and reports.",
};

export default function TeamPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState<{ email: string; role: Role }>({ email: "", role: "ANALYST" });
  const [link, setLink] = useState<{ link: string; emailed: boolean } | null>(null);
  const [removing, setRemoving] = useState<TeamData["members"][number] | null>(null);

  const q = useQuery({ queryKey: ["team"], queryFn: () => api.get<TeamData>("/team") });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["team"] });
  const invite = useMutation({
    mutationFn: () => api.post<{ link: string; emailed: boolean }>("/team/invitations", form),
    onSuccess: (r) => { invalidate(); setInviting(false); setLink(r); setForm({ email: "", role: "ANALYST" }); },
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch(`/team/members/${id}`, { role }),
    onSuccess: () => { invalidate(); toast.success("Role updated"); },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/team/members/${id}`),
    onSuccess: () => { invalidate(); setRemoving(null); toast.success("Member removed"); },
    onError: toast.error,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/team/invitations/${id}`), onSuccess: invalidate, onError: toast.error });

  const canManage = me.permissions.includes("team:manage");
  const assignable = ROLES.filter((r) => me.role === "OWNER" || RANK[me.role] > RANK[r]);
  const canEdit = (r: Role, self: boolean) => canManage && !self && (me.role === "OWNER" || RANK[me.role] > RANK[r]);

  return (
    <>
      <PageHeader title="Team & permissions" description="Manage who can access SecureScope and what they can do."
        actions={<Can permission="team:manage"><Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>Invite member</Button></Can>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="card">
            {q.isPending ? <TableSkeleton rows={4} cols={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
              <Table head={["Member", "Role", "Last sign-in", "Joined", ""]}>
                {q.data.members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold">{m.user.name.slice(0, 2).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block truncate">{m.user.name} {m.isSelf && <span className="text-xs text-faint">(you)</span>}</span>
                          <span className="block truncate text-xs text-muted">{m.user.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {canEdit(m.role, m.isSelf) ? (
                        <Select className="w-auto" value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value as Role })} aria-label={`Role of ${m.user.name}`}>
                          {assignable.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                        </Select>
                      ) : <span className="text-muted">{roleLabel[m.role]}</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-muted">{timeAgo(m.user.lastLoginAt)}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-muted">{formatDate(m.joinedAt)}</td>
                    <td className="px-5 py-3.5 text-right">
                      {canEdit(m.role, m.isSelf) && <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>Remove</Button>}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
          {canManage && q.data && (
            <Card title="Pending invitations" bodyClassName="p-0">
              {q.data.invitations.length === 0 ? (
                <EmptyState icon={<Users className="h-5 w-5" />} title="No pending invitations" />
              ) : (
                <ul className="divide-y divide-line/40">
                  {q.data.invitations.map((i) => (
                    <li key={i.id} className="flex items-center gap-4 px-5 py-3">
                      <span className="flex-1 truncate text-sm">{i.email}</span>
                      <span className="text-xs text-muted">{roleLabel[i.role]}</span>
                      <span className="text-xs text-faint">expires {formatDate(i.expiresAt)}</span>
                      <Button size="sm" variant="ghost" aria-label="Revoke invitation" onClick={() => revoke.mutate(i.id)}><X className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <Card title="Roles">
          <ul className="space-y-4">
            {ROLES.map((r) => (
              <li key={r}>
                <div className="text-sm font-medium">{roleLabel[r]} {r === me.role && <span className="text-xs text-accent">· your role</span>}</div>
                <p className="mt-0.5 text-xs text-muted">{ROLE_INFO[r]}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite a team member" description="Invitations expire after 7 days."
        footer={<><Button variant="secondary" onClick={() => setInviting(false)}>Cancel</Button><Button loading={invite.isPending} onClick={() => invite.mutate()}>Send invitation</Button></>}>
        <div className="space-y-4">
          <Field label="Email" error={fieldErrors(invite.error).email}>{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Role" hint={ROLE_INFO[form.role]}>
            {(id) => <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{assignable.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</Select>}
          </Field>
          {!fieldErrors(invite.error).email && <InlineError error={invite.error} />}
        </div>
      </Modal>

      <Modal open={Boolean(link)} onClose={() => setLink(null)} title="Invitation created"
        description={link?.emailed ? "An email with this link was sent." : "Email delivery is not configured. Share this one-time link securely with the invitee — it will not be shown again."}
        footer={<Button onClick={() => setLink(null)}>Done</Button>}>
        {link && (
          <div className="space-y-2">
            <CodeBlock>{link.link}</CodeBlock>
            <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard.writeText(link.link).then(() => toast.success("Copied"))}>Copy link</Button>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} title="Remove member?" description="Their sessions are ended immediately and they lose access to this organization."
        footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>Remove</Button></>}>
        <p className="text-sm">{removing?.user.name} · {removing?.user.email}</p>
      </Modal>
    </>
  );
}
