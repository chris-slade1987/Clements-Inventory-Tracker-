"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type ReviewProduct = {
  id: string; name: string; approved: boolean; confirmed: boolean;
  unitLabel: string; divisionLabel: string; distributorSku: string | null;
  manufacturer: string | null; onHand: number; allCaps: boolean;
};

// Off-catalog products that are confirmed but NOT on the approved catalog. Each
// needs a decision: Approve onto the catalog, Merge into an existing approved
// product, or Discard (deactivate; history kept).
export default function OffCatalogList({
  products,
  confirmedProducts,
}: {
  products: ReviewProduct[];
  confirmedProducts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  async function post(body: Record<string, unknown>, id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/products/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Action failed."); setBusyId(null); return; }
      router.refresh();
    } catch {
      setError("Network error. Try again."); setBusyId(null);
    }
  }

  if (products.length === 0) {
    return <p className="text-sm text-muted">Nothing off-catalog awaiting a decision. Everything active is on the approved catalog.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        These are active products that aren&apos;t on the approved catalog yet. <strong>Approve</strong> the ones that belong,
        <strong> merge</strong> a duplicate into its approved product, or <strong>discard</strong> the rest (kept in history, hidden from check-out).
      </p>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {products.map((p) => {
        const busy = busyId === p.id;
        return (
          <Card key={p.id} className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{p.name}</span>
              {p.allCaps ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">ALL-CAPS</span> : null}
            </div>
            <div className="text-[11px] text-muted">
              {p.unitLabel}{p.divisionLabel && p.divisionLabel !== "—" ? ` · ${p.divisionLabel}` : ""}{p.manufacturer ? ` · ${p.manufacturer}` : ""}{p.distributorSku ? ` · SKU ${p.distributorSku}` : ""} · {p.onHand} on hand
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <button onClick={() => post({ action: "approve", id: p.id }, p.id)} disabled={busy} className={btn.primary}>
                {busy ? "…" : "Approve onto catalog"}
              </button>
              <button onClick={() => post({ action: "discard", id: p.id }, p.id)} disabled={busy} className={btn.danger}>Discard</button>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={mergeTarget[p.id] ?? ""}
                  onChange={(e) => setMergeTarget((m) => ({ ...m, [p.id]: e.target.value }))}
                  className="max-w-[12rem] rounded-lg border border-line px-2 py-2 text-sm bg-surface"
                >
                  <option value="">Merge into…</option>
                  {confirmedProducts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={() => mergeTarget[p.id] && post({ action: "merge", id: p.id, targetId: mergeTarget[p.id] }, p.id)} disabled={busy || !mergeTarget[p.id]} className={btn.secondary}>
                  Merge
                </button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
