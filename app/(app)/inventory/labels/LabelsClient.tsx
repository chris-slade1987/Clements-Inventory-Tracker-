"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, btn } from "@/components/ui";
import { uomLabel } from "@/lib/uom";

type Product = { id: string; name: string; distributorSku: string | null; unit: string; category: string | null };

export default function LabelsClient({ products }: { products: Product[] }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [size, setSize] = useState<"2x1" | "2x2">("2x1");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 80);
    return products.filter((p) => [p.name, p.distributorSku, p.category].filter(Boolean).some((x) => x!.toLowerCase().includes(s))).slice(0, 80);
  }, [products, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPrint() {
    if (selected.size === 0) return;
    const ids = [...selected].join(",");
    const url = `/inventory/labels/print?size=${size}&ids=${encodeURIComponent(ids)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium mb-1">Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, SKU, category…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Label size</label>
          <select value={size} onChange={(e) => setSize(e.target.value as "2x1" | "2x2")} className="rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="2x1">Avery 2&quot; × 1&quot;</option>
            <option value="2x2">Avery 2&quot; × 2&quot;</option>
          </select>
        </div>
        <button className={btn.primary} onClick={openPrint} disabled={selected.size === 0}>
          Open print sheet ({selected.size})
        </button>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No products" hint="Search for the products you want labels for." />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const on = selected.has(p.id);
            return (
              <Card key={p.id} className="p-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-5 w-5 rounded border-line accent-[#1f7a52]" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">{p.distributorSku ? `SKU ${p.distributorSku} · ` : ""}{uomLabel(p.unit)}</span>
                  </span>
                </label>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
