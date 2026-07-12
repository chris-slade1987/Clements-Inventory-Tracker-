"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Card, btn } from "@/components/ui";

type Option = { id: string; name: string };

export default function FilterBar({
  products,
  warehouses,
  categories,
  initial,
  exportBase,
}: {
  products: Option[];
  warehouses?: Option[];
  categories?: readonly string[];
  initial: {
    from?: string;
    to?: string;
    productId?: string;
    warehouseId?: string;
    category?: string;
  };
  /** If set, renders an "Export CSV" link to `${exportBase}?<current filters>`. */
  exportBase?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [productId, setProductId] = useState(initial.productId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? "");
  const [category, setCategory] = useState(initial.category ?? "");

  function params() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (productId) p.set("productId", productId);
    if (warehouseId) p.set("warehouseId", warehouseId);
    if (category) p.set("category", category);
    return p;
  }

  function apply() {
    const p = params();
    router.push(`${pathname}?${p.toString()}`);
  }

  // Quick date ranges — easier than typing. Applies immediately.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  function preset(range: "thisMonth" | "lastMonth" | "last3" | "ytd") {
    const now = new Date();
    let f: Date, t: Date;
    if (range === "thisMonth") { f = new Date(now.getFullYear(), now.getMonth(), 1); t = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
    else if (range === "lastMonth") { f = new Date(now.getFullYear(), now.getMonth() - 1, 1); t = new Date(now.getFullYear(), now.getMonth(), 0); }
    else if (range === "last3") { f = new Date(now.getFullYear(), now.getMonth() - 2, 1); t = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
    else { f = new Date(now.getFullYear(), 0, 1); t = now; }
    const fromV = iso(f), toV = iso(t);
    setFrom(fromV); setTo(toV);
    const p = params(); p.set("from", fromV); p.set("to", toV);
    router.push(`${pathname}?${p.toString()}`);
  }
  const PRESETS: { key: "thisMonth" | "lastMonth" | "last3" | "ytd"; label: string }[] = [
    { key: "thisMonth", label: "This month" },
    { key: "lastMonth", label: "Last month" },
    { key: "last3", label: "Last 3 months" },
    { key: "ytd", label: "Year to date" },
  ];
  function clear() {
    setFrom("");
    setTo("");
    setProductId("");
    setWarehouseId("");
    setCategory("");
    router.push(pathname);
  }

  return (
    <Card className="p-3 mb-5">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {PRESETS.map((r) => (
          <button
            key={r.key}
            onClick={() => preset(r.key)}
            className="rounded-full border border-line px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-muted">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs font-medium text-muted">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
          />
        </label>
        {categories ? (
          <label className="text-xs font-medium text-muted">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink bg-surface"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {warehouses ? (
          <label className="text-xs font-medium text-muted">
            Warehouse
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink bg-surface"
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-xs font-medium text-muted">
          Product
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink bg-surface"
          >
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={apply} className={btn.primary}>
          Apply
        </button>
        <button onClick={clear} className={btn.secondary}>
          Clear
        </button>
        {exportBase ? (
          <a
            href={`${exportBase}?${params().toString()}`}
            className={`${btn.secondary} ml-auto`}
          >
            Export CSV
          </a>
        ) : null}
      </div>
    </Card>
  );
}
