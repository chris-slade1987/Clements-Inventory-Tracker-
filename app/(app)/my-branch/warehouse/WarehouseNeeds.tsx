"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

type Need = { id: string; branch: string; year: number; month: number; label: string | null; request: string; raisedByName: string | null; createdAt: string };
const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Open warehouse escalations — resource/repair items an inspector flagged for
// leadership. Admins / the Director of Field Ops can mark them resolved.
export default function WarehouseNeeds({ needs, canResolve }: { needs: Need[]; canResolve: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (needs.length === 0) return null;

  async function resolve(id: string) {
    setBusy(id);
    const res = await fetch("/api/fleet/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolveNeed", id }) });
    setBusy(null);
    if (res.ok) router.refresh();
  }

  return (
    <Card className="p-4 mb-5 ring-1 ring-amber-300">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Open escalations — leadership action needed</div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{needs.length}</span>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {needs.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted">{MONTH_ABBR[n.month]} {n.year}</span>
            {n.label ? <span className="text-xs text-muted">{n.label}:</span> : null}
            <span className="font-medium text-ink">{n.request}</span>
            {n.raisedByName ? <span className="text-[11px] text-muted">— {n.raisedByName}</span> : null}
            {canResolve ? (
              <button onClick={() => resolve(n.id)} disabled={busy === n.id} className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-black/5 disabled:opacity-50">
                {busy === n.id ? "…" : "Mark resolved"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
