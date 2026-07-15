"use client";

import { useRouter, usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Card, btn } from "@/components/ui";

type Option = { id: string; name: string };

/** Date field whose calendar opens on click anywhere (or the calendar button),
 *  not just the tiny native icon. */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    try { el?.showPicker?.(); } catch { /* not supported / no gesture — ignore */ }
  };
  return (
    <label className="text-xs font-medium text-muted">
      {label}
      <div className="relative mt-1">
        <input
          ref={ref}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={open}
          className="date-clean w-full cursor-pointer rounded-lg border border-line px-2 py-2 pr-9 text-sm text-ink"
        />
        <button
          type="button"
          onClick={open}
          aria-label="Open calendar"
          className="absolute inset-y-0 right-0 flex items-center px-2 text-muted hover:text-brand-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </label>
  );
}

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
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
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
