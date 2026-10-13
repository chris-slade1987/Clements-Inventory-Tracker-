"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

type Option = { id: string; name: string };

export default function FilterBar({
  products,
  warehouses,
  categories,
  distributors,
  technicians,
  initial,
  exportBase,
  view,
  showDateRange = true,
  showAsOf = false,
}: {
  products: Option[];
  warehouses?: Option[];
  categories?: readonly string[];
  /** Distributor options — rendered as a select on Purchases / Spend. */
  distributors?: readonly string[];
  /** Technician options — rendered as a select on Dispersals. */
  technicians?: Option[];
  initial: {
    from?: string;
    to?: string;
    productId?: string;
    warehouseId?: string;
    category?: string;
    distributor?: string;
    technicianId?: string;
    asOf?: string;
  };
  /** If set, renders an "Export CSV" link to `${exportBase}?<current filters>`. */
  exportBase?: string;
  /** Current report view — carried into the URL push and the Export CSV link. */
  view?: string;
  /** Show the date presets + from/to range (hidden on the On-hand snapshot). */
  showDateRange?: boolean;
  /** Show the "As of" date input (On-hand snapshot). */
  showAsOf?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [productId, setProductId] = useState(initial.productId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [distributor, setDistributor] = useState(initial.distributor ?? "");
  const [technicianId, setTechnicianId] = useState(initial.technicianId ?? "");
  const [asOf, setAsOf] = useState(initial.asOf ?? "");

  function params() {
    const p = new URLSearchParams();
    if (view) p.set("view", view);
    if (showDateRange && from) p.set("from", from);
    if (showDateRange && to) p.set("to", to);
    if (productId) p.set("productId", productId);
    if (warehouseId) p.set("warehouseId", warehouseId);
    if (category) p.set("category", category);
    if (distributors && distributor) p.set("distributor", distributor);
    if (technicians && technicianId) p.set("technicianId", technicianId);
    if (showAsOf && asOf) p.set("asOf", asOf);
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
    setDistributor("");
    setTechnicianId("");
    setAsOf("");
    // Preserve the active view when clearing filters.
    router.push(view ? `${pathname}?view=${view}` : pathname);
  }

  return (
    <Card className="p-3 mb-5">
      {showDateRange ? (
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
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showDateRange ? (
          <>
            <label className="text-xs font-medium text-muted">
              From
              <DateInput className="mt-1" value={from} onChange={setFrom} />
            </label>
            <label className="text-xs font-medium text-muted">
              To
              <DateInput className="mt-1" value={to} onChange={setTo} />
            </label>
          </>
        ) : null}
        {showAsOf ? (
          <label className="text-xs font-medium text-muted">
            As of
            <DateInput className="mt-1" value={asOf} onChange={setAsOf} />
          </label>
        ) : null}
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
        {distributors ? (
          <label className="text-xs font-medium text-muted">
            Distributor
            <select
              value={distributor}
              onChange={(e) => setDistributor(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink bg-surface"
            >
              <option value="">All distributors</option>
              {distributors.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {technicians ? (
          <label className="text-xs font-medium text-muted">
            Technician
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink bg-surface"
            >
              <option value="">All technicians</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
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
