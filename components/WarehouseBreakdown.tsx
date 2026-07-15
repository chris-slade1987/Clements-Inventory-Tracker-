"use client";

import { useState } from "react";
import { money, qty } from "@/lib/format";

export type BreakdownRow = {
  productId: string;
  name: string;
  unit: string;
  purchasedQty: number;
  purchasedValue: number;
  dispersedQty: number;
  dispersedValue: number;
  onHandQty: number;
};
type Warehouse = { id: string; name: string };

function agg(rows: BreakdownRow[]) {
  return rows.reduce(
    (a, r) => {
      a.purchasedQty += r.purchasedQty;
      a.purchasedValue += r.purchasedValue;
      a.dispersedQty += r.dispersedQty;
      a.dispersedValue += r.dispersedValue;
      a.onHandQty += r.onHandQty;
      return a;
    },
    { purchasedQty: 0, purchasedValue: 0, dispersedQty: 0, dispersedValue: 0, onHandQty: 0 }
  );
}

export default function WarehouseBreakdown({
  warehouses,
  data,
}: {
  warehouses: Warehouse[];
  data: Record<string, BreakdownRow[]>;
}) {
  // Default: every branch expanded so the per-product detail is visible.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(warehouses.map((w) => [w.id, true]))
  );
  const toggle = (id: string) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  const grand = { purchasedQty: 0, purchasedValue: 0, dispersedQty: 0, dispersedValue: 0, onHandQty: 0 };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Warehouse / product</th>
            <th className="px-3 py-2 font-medium text-right">Purchased</th>
            <th className="px-3 py-2 font-medium text-right">Purchased $ (in)</th>
            <th className="px-3 py-2 font-medium text-right">Dispersed</th>
            <th className="px-3 py-2 font-medium text-right">Dispersed $ (out)</th>
            <th className="px-4 py-2 font-medium text-right">On-hand</th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((w) => {
            const rows = data[w.id] ?? [];
            const a = agg(rows);
            grand.purchasedQty += a.purchasedQty;
            grand.purchasedValue += a.purchasedValue;
            grand.dispersedQty += a.dispersedQty;
            grand.dispersedValue += a.dispersedValue;
            grand.onHandQty += a.onHandQty;
            const isOpen = open[w.id];
            return (
              <FragmentRow key={w.id} wid={w.id} name={w.name} rows={rows} a={a} isOpen={isOpen} toggle={toggle} />
            );
          })}
          <tr className="bg-slate-100 font-semibold border-t-2 border-line">
            <td className="px-4 py-2">All branches</td>
            <td className="px-3 py-2 text-right tabular-nums">{qty(grand.purchasedQty)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(grand.purchasedValue)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{qty(grand.dispersedQty)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(grand.dispersedValue)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{qty(grand.onHandQty)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  wid, name, rows, a, isOpen, toggle,
}: {
  wid: string; name: string; rows: BreakdownRow[];
  a: ReturnType<typeof agg>; isOpen: boolean; toggle: (id: string) => void;
}) {
  return (
    <>
      {/* Branch aggregate row (click to expand its products) */}
      <tr className="border-b border-line bg-black/[0.015] cursor-pointer hover:bg-black/[0.03]" onClick={() => toggle(wid)}>
        <td className="px-4 py-2 font-medium text-ink">
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {name}
            <span className="text-xs font-normal text-muted">· {rows.length} product{rows.length === 1 ? "" : "s"}</span>
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{qty(a.purchasedQty)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{money(a.purchasedValue)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{qty(a.dispersedQty)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{money(a.dispersedValue)}</td>
        <td className="px-4 py-2 text-right tabular-nums font-medium">{qty(a.onHandQty)}</td>
      </tr>

      {/* Per-product sublines */}
      {isOpen && rows.length === 0 ? (
        <tr className="border-b border-line">
          <td colSpan={6} className="px-4 py-2 pl-10 text-xs text-muted">No movement or stock for this branch in range.</td>
        </tr>
      ) : null}
      {isOpen
        ? rows.map((r) => (
            <tr key={r.productId} className="border-b border-line/60 text-[13px]">
              <td className="px-4 py-1.5 pl-10 text-muted">
                {r.name}
                {r.unit ? <span className="ml-1 text-[11px] text-muted/70">/ {r.unit}</span> : null}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.purchasedQty ? qty(r.purchasedQty) : "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.purchasedValue ? money(r.purchasedValue) : "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.dispersedQty ? qty(r.dispersedQty) : "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.dispersedValue ? money(r.dispersedValue) : "—"}</td>
              <td className="px-4 py-1.5 text-right tabular-nums font-medium">{qty(r.onHandQty)}</td>
            </tr>
          ))
        : null}
    </>
  );
}
