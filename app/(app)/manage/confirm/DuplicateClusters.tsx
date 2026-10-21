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

// Likely-duplicate clusters (same base name ignoring brand/size/case). The human
// picks the survivor and merges the rest in — or dismisses a cluster whose members
// are genuinely different products (e.g. the three distinct Cross-Checks).
export default function DuplicateClusters({ clusters }: { clusters: Cluster[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [survivor, setSurvivor] = useState<Record<string, string>>(() =>
    Object.fromEntries(clusters.map((c) => [c.key, c.products[0]?.id ?? ""])),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = clusters.filter((c) => !dismissed.has(c.key));

  async function mergeCluster(c: Cluster) {
    const keepId = survivor[c.key];
    if (!keepId) { setError("Pick which one to keep."); return; }
    const losers = c.products.filter((p) => p.id !== keepId);
    if (losers.length === 0) { setDismissed((s) => new Set(s).add(c.key)); return; }
    if (!window.confirm(`Merge ${losers.length} product(s) into "${c.products.find((p) => p.id === keepId)?.name}"? On-hand and history move to the kept product; the others are deactivated.`)) return;
    setBusyKey(c.key);
    setError(null);
    try {
      for (const l of losers) {
        const res = await fetch("/api/products/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "merge", id: l.id, targetId: keepId }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Merge failed."); }
      }
      setBusyKey(null);
      router.refresh();
    } catch (e) {
      setBusyKey(null);
      setError((e as Error).message);
    }
  }

  if (visible.length === 0) {
    return <p className="text-sm text-muted">No duplicate clusters detected. Nicely consolidated.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Products whose names look alike are grouped below. Pick the one to <strong>keep</strong> (the clean, approved,
        mixed-case name is pre-selected), then merge the rest in — their on-hand and history move onto the kept product.
        If a group is actually different products (e.g. a liquid vs. a granular), hit <em>Keep all</em>.
      </p>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {visible.map((c) => {
        const busy = busyKey === c.key;
        return (
          <Card key={c.key} className="p-4">
            <div className="mb-2 text-xs font-medium text-muted">{c.products.length} look-alikes</div>
            <ul className="divide-y divide-line">
              {c.products.map((p) => (
                <li key={p.id} className="flex items-start gap-3 py-2">
                  <input
                    type="radio"
                    name={`survivor-${c.key}`}
                    checked={survivor[c.key] === p.id}
                    onChange={() => setSurvivor((m) => ({ ...m, [c.key]: p.id }))}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{p.name}</span>
                      {p.approved ? (
                        <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">Approved</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Off-catalog</span>
                      )}
                      {!p.confirmed ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Unconfirmed</span> : null}
                      {p.allCaps ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">ALL-CAPS</span> : null}
                    </div>
                    <div className="text-[11px] text-muted">
                      {p.unitLabel}{p.divisionLabel && p.divisionLabel !== "—" ? ` · ${p.divisionLabel}` : ""}{p.distributorSku ? ` · SKU ${p.distributorSku}` : ""} · {p.onHand} on hand
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <button onClick={() => mergeCluster(c)} disabled={busy} className={btn.primary}>
                {busy ? "Merging…" : "Merge into the kept product"}
              </button>
              <button onClick={() => setDismissed((s) => new Set(s).add(c.key))} disabled={busy} className="ml-auto text-sm font-medium text-muted hover:text-ink">
                Keep all (different products)
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
