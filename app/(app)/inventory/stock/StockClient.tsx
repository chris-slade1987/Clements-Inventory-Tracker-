"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, btn } from "@/components/ui";
import { uomLabel } from "@/lib/uom";

type Row = {
  productId: string;
  name: string;
  unit: string;
  distributorSku: string | null;
  category: string | null;
  onHand: number;
  counted: boolean;
  lastMovement: string | null;
};

export default function StockClient({
  isAdmin,
  branchId,
  branchName,
  warehouses,
  rows,
}: {
  isAdmin: boolean;
  branchId: string;
  branchName: string;
  warehouses: { id: string; name: string }[];
  rows: Row[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.name, r.distributorSku, r.category].filter(Boolean).some((x) => x!.toLowerCase().includes(s)));
  }, [rows, q]);

  function exportCsv() {
    const out: string[][] = [["Product", "SKU", "Category", "On hand", "Unit", "Counted", "Last movement"]];
    for (const r of filtered) {
      out.push([r.name, r.distributorSku ?? "", r.category ?? "", String(r.onHand), r.unit, r.counted ? "yes" : "no", r.lastMovement ?? ""]);
    }
    const csv = out.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-${branchName || "branch"}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        {isAdmin ? (
          <div>
            <label className="block text-xs font-medium mb-1">Branch</label>
            <select value={branchId} onChange={(e) => router.push(`/inventory/stock?branch=${e.target.value}`)} className="rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium mb-1">Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, SKU, category…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <button className={btn.secondary} onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No stock" hint="No products with movements at this branch yet." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#eef5f0] text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-right font-medium">On hand</th>
                  <th className="px-3 py-2 text-left font-medium">Last movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => (
                  <tr key={r.productId}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted">
                        {r.distributorSku ? `SKU ${r.distributorSku} · ` : ""}{uomLabel(r.unit)}
                        {r.counted ? "" : " · not yet counted"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.onHand}</td>
                    <td className="px-3 py-2 text-xs text-muted">{r.lastMovement ? new Date(r.lastMovement).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
