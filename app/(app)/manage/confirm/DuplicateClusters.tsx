"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type ReviewProduct = {
  id: string; name: string; approved: boolean; confirmed: boolean;
  unitLabel: string; divisionLabel: string; distributorSku: string | null;
  manufacturer: string | null; onHand: number; allCaps: boolean;
};
type Cluster = { key: string; products: ReviewProduct[] };

// Look-alike groups. Each product has its OWN action — there is NO "pick one
// winner". Confirm every product that is genuinely its own thing (e.g. the three
// different Cross-Checks, each distinct-NPK fertilizer), and only Merge the ones
// that are true duplicates into whichever product they belong to. "Keep all"
// dismisses a group you've finished (or that was never duplicated).
export default function DuplicateClusters({
  clusters,
  confirmedProducts,
}: {
  clusters: Cluster[];
  confirmedProducts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  const visible = clusters.filter((c) => !dismissed.has(c.key));

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

  // Approve every not-yet-cataloged product in a group at once (they're all distinct).
  async function approveAll(c: Cluster) {
    const todo = c.products.filter((p) => !(p.approved && p.confirmed));
    if (todo.length === 0) { setDismissed((s) => new Set(s).add(c.key)); return; }
    setBusyId(c.key);
    setError(null);
    try {
      for (const p of todo) {
        const res = await fetch("/api/products/confirm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", id: p.id }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Approve failed."); }
      }
      setBusyId(null);
      router.refresh();
    } catch (e) { setError((e as Error).message); setBusyId(null); }
  }

  if (visible.length === 0) {
    return <p className="text-sm text-muted">No look-alike groups left to review. Nicely consolidated.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Products whose names look alike are grouped below. These are <strong>not</strong> assumed to be the same thing —
        <strong> Approve</strong> each one that is its own real product (different size, NPK, or formula), and only
        <strong> Merge</strong> the ones that are true duplicates into the product they belong to. Use <em>Keep all</em>
        once a group is sorted.
      </p>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {visible.map((c) => (
        <Card key={c.key} className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted">{c.products.length} look-alikes — confirm each real one, merge duplicates</div>
            <div className="flex items-center gap-3">
              <button onClick={() => approveAll(c)} disabled={busyId === c.key} className="text-xs font-semibold text-brand-700 hover:underline">
                {busyId === c.key ? "Approving…" : "Approve all as distinct"}
              </button>
              <button onClick={() => setDismissed((s) => new Set(s).add(c.key))} className="text-xs font-medium text-muted hover:text-ink">Keep all / done</button>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {c.products.map((p) => {
              const busy = busyId === p.id;
              const cataloged = p.approved && p.confirmed;
              // Merge targets: the OTHER members of this group + the approved catalog.
              const others = c.products.filter((x) => x.id !== p.id);
              return (
                <li key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{p.name}</span>
                    {cataloged ? (
                      <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">Approved</span>
                    ) : p.approved ? (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Unconfirmed</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Off-catalog</span>
                    )}
                    {p.allCaps ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">ALL-CAPS</span> : null}
                  </div>
                  <div className="text-[11px] text-muted">
                    {p.unitLabel}{p.divisionLabel && p.divisionLabel !== "—" ? ` · ${p.divisionLabel}` : ""}{p.distributorSku ? ` · SKU ${p.distributorSku}` : ""} · {p.onHand} on hand
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!cataloged ? (
                      <button onClick={() => post({ action: "approve", id: p.id }, p.id)} disabled={busy} className={btn.primary}>
                        {busy ? "…" : "Approve (it's its own product)"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-brand-700">✓ on the approved catalog</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <select
                        value={mergeTarget[p.id] ?? ""}
                        onChange={(e) => setMergeTarget((m) => ({ ...m, [p.id]: e.target.value }))}
                        className="max-w-[12rem] rounded-lg border border-line px-2 py-1.5 text-sm bg-surface"
                      >
                        <option value="">Merge into…</option>
                        {others.length > 0 ? (
                          <optgroup label="In this group">
                            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </optgroup>
                        ) : null}
                        <optgroup label="Approved catalog">
                          {confirmedProducts.filter((cp) => cp.id !== p.id).map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
                        </optgroup>
                      </select>
                      <button onClick={() => mergeTarget[p.id] && post({ action: "merge", id: p.id, targetId: mergeTarget[p.id] }, p.id)} disabled={busy || !mergeTarget[p.id]} className={btn.secondary}>
                        Merge
                      </button>
                      <button onClick={() => post({ action: "discard", id: p.id }, p.id)} disabled={busy} className="text-xs font-medium text-muted hover:text-red-600">Discard</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
