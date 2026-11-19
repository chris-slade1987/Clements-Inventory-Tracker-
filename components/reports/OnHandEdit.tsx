"use client";

// On-Hand report — update on-hand in place (COO 2026-11-19: "allow the on-hand to
// be updated directly from this screen rather than having to go through Reconcile
// every time"). You enter what's physically on the shelf; the portal posts a
// physical-count adjustment (counted − recorded) through POST /api/inventory/
// stock-count, so it's attributed, marks the product as counted at that branch,
// and nothing is edited or deleted. Today's on-hand only (past dates are history).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

async function saveCount(warehouseId: string, productId: string, counted: number, note: string): Promise<string | null> {
  try {
    const r = await fetch("/api/inventory/stock-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouseId, counts: [{ productId, counted }], note, source: "onhand-report" }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? null : j.error ?? "Couldn't save.";
  } catch {
    return "Network error — try again.";
  }
}

function Editor({
  title, current, unit, onCancel, onSave,
}: {
  title: string; current: number; unit: string;
  onCancel: () => void; onSave: (counted: number, note: string) => Promise<string | null>;
}) {
  const [val, setVal] = useState(String(Math.max(0, current)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(val);
  const ok = val.trim() !== "" && Number.isFinite(n) && n >= 0 && Number.isInteger(n);
  const delta = ok ? n - current : 0;
  return (
    <div className="space-y-2 text-left">
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="text-xs text-muted">Recorded now: <span className="font-medium text-ink tabular-nums">{fmt(current)}</span>{unit ? ` ${unit}` : ""}</div>
      <label className="block text-xs text-muted">
        Actual on hand (count the shelf)
        <input autoFocus type="number" inputMode="numeric" min={0} step={1} value={val} onChange={(e) => setVal(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink tabular-nums" />
      </label>
      <label className="block text-xs text-muted">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. shelf count, found a case in back"
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink" />
      </label>
      {ok && delta !== 0 ? (
        <p className="text-xs text-muted">Posts a count adjustment of <span className="font-medium text-ink tabular-nums">{delta > 0 ? "+" : ""}{fmt(delta)}</span>. It shows in Reconcile with your name.</p>
      ) : ok ? (
        <p className="text-xs text-muted">No change — saving records that it was counted.</p>
      ) : (
        <p className="text-xs text-red-700">Enter a whole number, 0 or more.</p>
      )}
      {err ? <p role="alert" className="text-xs text-red-700">{err}</p> : null}
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${btn.secondary} flex-1 !py-2`} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={`${btn.primary} flex-1 !py-2`} disabled={!ok || busy}
          onClick={async () => { setBusy(true); setErr(null); const e = await onSave(n, note); if (e) { setErr(e); setBusy(false); } }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** One branch's on-hand figure; tap to update it. */
export function EditableOnHand({
  productId, productName, warehouseId, warehouseName, current, unit,
}: {
  productId: string; productName: string; warehouseId: string; warehouseName: string; current: number; unit: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen(true)} title={`Update ${warehouseName} on-hand`}
        className="rounded-md px-1.5 py-0.5 tabular-nums underline decoration-dotted decoration-brand-400 underline-offset-4 hover:bg-brand-50 hover:text-brand-800">
        {current ? fmt(current) : "—"}
      </button>
      {open ? (
        <>
          <span className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <span role="dialog" aria-modal="true" aria-label={`Update ${productName} at ${warehouseName}`}
            className="fixed left-1/2 top-1/2 z-50 block w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-4 text-left shadow-2xl">
            <Editor title={`${productName} · ${warehouseName.replace(" (HQ)", "")}`} current={current} unit={unit}
              onCancel={() => setOpen(false)}
              onSave={async (counted, note) => {
                const e = await saveCount(warehouseId, productId, counted, note);
                if (!e) { setOpen(false); router.refresh(); }
                return e;
              }} />
          </span>
        </>
      ) : null}
    </span>
  );
}

/** For a product that isn't on the list (nothing on hand anywhere yet). */
export function UpdateOtherProduct({
  products, warehouses, onHand,
}: {
  products: { id: string; name: string; unit: string }[];
  warehouses: { id: string; name: string }[];
  onHand: Record<string, Record<string, number>>; // productId → warehouseId → qty
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const needle = q.trim().toLowerCase();
  const matches = needle ? products.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 8) : [];
  const product = products.find((p) => p.id === productId);
  if (!warehouses.length) return null;
  return (
    <div className="relative">
      <button type="button" className={btn.secondary} onClick={() => setOpen((o) => !o)}>Update on-hand for another product</button>
      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-xl border border-line bg-white p-3 shadow-xl">
          {!product ? (
            <div className="space-y-2">
              <label className="block text-xs text-muted">Product
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog"
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
              </label>
              <ul className="max-h-56 overflow-y-auto">
                {matches.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => setProductId(p.id)} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-brand-50">{p.name}</button></li>
                ))}
              </ul>
              <button type="button" className={`${btn.secondary} w-full !py-2`} onClick={() => setOpen(false)}>Close</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs text-muted">Warehouse
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink">
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <Editor key={`${productId}|${warehouseId}`} title={product.name} current={onHand[productId]?.[warehouseId] ?? 0} unit={product.unit}
                onCancel={() => { setProductId(""); setQ(""); setOpen(false); }}
                onSave={async (counted, note) => {
                  const e = await saveCount(warehouseId, productId, counted, note);
                  if (!e) { setProductId(""); setQ(""); setOpen(false); router.refresh(); }
                  return e;
                }} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
