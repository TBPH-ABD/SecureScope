"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Boxes, Plus, Search, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AddAssetModal } from "@/components/assets/add-asset-modal";
import {
  AuthBadge, Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SeverityBadge, Table, TableSkeleton, Tag,
} from "@/components/ui";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";
import { assetTypeLabel, SEVERITIES, timeAgo } from "@/lib/format";
import type { Asset, AssetType, Paged } from "@/lib/types";

function AssetsView() {
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<AssetType | "">("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setQ(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (params.get("onboarding")) setAdding(true);
  }, [params]);

  const query = useQuery({
    queryKey: ["assets", { page, type, status, q }],
    queryFn: () => api.get<Paged<Asset>>("/assets", { page, type, status, q, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(type || status || q);

  return (
    <>
      <PageHeader
        title="Assets"
        description="Your external attack surface. Only verified assets can be scanned."
        actions={
          <Can permission="assets:write">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add asset</Button>
          </Can>
        }
      />

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/60 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input className="pl-9" placeholder="Search assets…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search assets" />
          </div>
          <Select className="w-auto" value={type} onChange={(e) => { setType(e.target.value as AssetType | ""); setPage(1); }} aria-label="Filter by type">
            <option value="">All types</option>
            {(Object.keys(assetTypeLabel) as AssetType[]).map((t) => <option key={t} value={t}>{assetTypeLabel[t]}</option>)}
          </Select>
          <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by authorization">
            <option value="">Any authorization</option>
            <option value="VERIFIED">Verified</option>
            <option value="PENDING">Unverified</option>
            <option value="REVOKED">Revoked</option>
          </Select>
        </div>

        {query.isPending ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Search className="h-5 w-5" />} title="No matching assets" description="Try a different search or clear the filters." />
          ) : (
            <EmptyState
              icon={<Boxes className="h-5 w-5" />}
              title="No assets yet"
              description="Add a domain you own to start mapping your attack surface. Subdomains and IPs can follow once the domain is verified."
              action={<Can permission="assets:write"><Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add your first domain</Button></Can>}
            />
          )
        ) : (
          <>
            <Table head={["Asset", "Type", "Authorization", "Open findings", "Last scan"]}>
              {query.data.items.map((a) => {
                const worst = SEVERITIES.find((s) => (a.severityCounts?.[s] ?? 0) > 0);
                return (
                  <tr key={a.id} className="group hover:bg-raised/40">
                    <td className="px-5 py-3.5">
                      <Link href={`/assets/${a.id}`} className="block">
                        <span className="block max-w-[360px] truncate font-mono text-[13px] text-ink group-hover:text-accent">{a.value}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {a.label && <span className="text-xs text-muted">{a.label}</span>}
                          {a.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                        </span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-muted">{assetTypeLabel[a.type]}</td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2">
                        <AuthBadge status={a.authorizationStatus} />
                        {a.authorizationStatus !== "VERIFIED" && <ShieldQuestion className="h-4 w-4 text-faint" aria-label="Scanning disabled until verified" />}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {a.openFindings ? (
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{a.openFindings}</span>
                          {worst && <SeverityBadge severity={worst} compact />}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-muted">{timeAgo(a.lastScannedAt)}</td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
          </>
        )}
      </div>
      <AddAssetModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

export default function AssetsPage() {
  return <Suspense><AssetsView /></Suspense>;
}
