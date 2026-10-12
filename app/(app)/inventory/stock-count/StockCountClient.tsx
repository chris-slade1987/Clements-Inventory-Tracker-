"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, btn } from "@/components/ui";
import { uomLabel } from "@/lib/uom";

type Product = {
  id: string;
  name: string;
  unit: string;
  distributorSku: string | null;
  category: string | null;
  onHand: number;
  counted: boolean;
};

export default function StockCountClient({
  isAdmin,
  branchId,
  branchName,
  warehouses,
  products,
}: {
  isAdmin: boolean;
  branchId: string;
  branchName: string;
  warehouses: { id: string; name: string }[];
  products: Product[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ counted: number; adjusted: number } | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 60);
    return products.filter((p) => [p.name, p.distributorSku, p.category].filter(Boolean).some((x) => x!.toLowerCase().includes(s))).slice(0, 60);
  }, [products, q]);

  const pendingCount = Object.values(entries).filter((v) => v.trim() !== "" && Number.isFinite(Number(v))).length;

  async function submit() {
    const counts = Object.entries(entries)
      .map(([productId, v]) => ({ productId, counted: Math.trunc(Number(v)) }))
      .filter((c) => c.productId && v_ok(entries[c.productId]) && c.counted >= 0);
    if (counts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/stock-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId: branchId, counts }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Could not save counts.");
        return;
      }
      setDone({ counted: data.counted ?? counts.length, adjusted: data.adjusted ?? 0 });
      setEntries({});
      router.refresh();
    } catch {
      setBusy(false);
      setError("Network error.");
    }
  }

  function v_ok(v: string | undefined) {
    return v != null && v.trim() !== "" && Number.isFinite(Number(v));
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        {isAdmin ? (
          <div>
            <label className="block text-xs font-medium mb-1">Branch</label>
            <select value={branchId} onChange={(e) => router.push(`/inventory/stock-count?branch=${e.target.value}`)} className="rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium mb-1">Find product</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, SKU, category…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
      </Card>

      {done ? (
        <p className="text-sm font-medium text-brand-700">Saved {done.counted} count{done.counted === 1 ? "" : "s"} ({done.adjusted} with a change) at {branchName}.</p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {filtered.length === 0 ? (
        <EmptyState title="No products" hint="Search for the products you counted." />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Card key={p.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted">
                    Recorded {p.onHand} {uomLabel(p.unit)}
                    {p.counted ? "" : " · not yet counted"}
                  </div>
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="count"
                  value={entries[p.id] ?? ""}
                  onChange={(e) => setEntries((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  className="h-10 w-24 shrink-0 rounded-lg border border-line text-center text-sm"
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="sticky bottom-20 md:bottom-4">
        <button className={`${btn.primary} w-full`} onClick={submit} disabled={busy || pendingCount === 0 || !branchId}>
          {busy ? "Saving…" : `Save ${pendingCount || ""} count${pendingCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
