"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { btn } from "@/components/ui";

export default function AuditActions({ id, branch, year, quarter, status, isAdmin }: {
  id: string; branch: string; year: number; quarter: number; status: string; isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reopen() {
    if (!confirm("Reopen this audit for editing? The branch manager's signature will be cleared and they'll need to re-sign.")) return;
    setBusy(true);
    const res = await fetch("/api/management/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", id }) });
    setBusy(false);
    if (res.ok) { router.push(`/management/audits/edit?branch=${branch}&year=${year}&quarter=${quarter}`); router.refresh(); }
  }

  return (
    <div className="flex items-center gap-2">
      {isAdmin && status !== "signed" ? (
        <Link href={`/management/audits/edit?branch=${branch}&year=${year}&quarter=${quarter}`} className={btn.secondary}>Edit</Link>
      ) : null}
      {isAdmin && status === "signed" ? (
        <button onClick={reopen} disabled={busy} className={btn.secondary}>{busy ? "Reopening…" : "Reopen to edit"}</button>
      ) : null}
      <button onClick={() => window.print()} className={btn.primary}>Print / save PDF</button>
    </div>
  );
}
