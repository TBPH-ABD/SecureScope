"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FindingsTable } from "@/components/findings-table";
import { PageHeader } from "@/components/ui";
import type { Severity } from "@/lib/types";

function View() {
  const params = useSearchParams();
  const severity = params.get("severity")?.split(",").filter(Boolean) as Severity[] | undefined;
  return (
    <>
      <PageHeader title="Findings" description="Security issues detected across your verified assets. Findings that are no longer detected are resolved automatically." />
      <FindingsTable key={params.toString()} initialSeverity={severity} initialStatus={params.get("status") ?? undefined} />
    </>
  );
}

export default function FindingsPage() {
  return <Suspense><View /></Suspense>;
}
