"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Card, btn } from "@/components/ui";
import { qty, money } from "@/lib/format";

type Option = { id: string; name: string };
type Row = {
  id: string;
  createdAt: string;
  type: string;
  quantity: number;
  unitPrice: number | null;
  reason: string | null;
  productName: string;
  warehouseName: string;
  technicianName: string | null;
  userName: string | null;
  invoiceNumber: string | null;
  isReversal: boolean;
  isReversed: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  check_in: "Check-in",
  check_out: "Check-out",
  adjustment: "Adjustment",
};

export default function ReconcileClient({
  rows,
  page,
  pageSize,
  total,
  warehouses,
  products,
  technicians,
  initial,
}: {
  rows: Row[];
  page: number;
  pageSize: number;
  total: number;
  warehouses: Option[];
  products: Option[];
  technicians: Option[];
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [f, setF] = useState({
    q: initial.q ?? "",
    warehouseId: initial.warehouseId ?? "",
    productId: initial.productId ?? "",
    technicianId: initial.technicianId ?? "",
    type: initial.type ?? "",
    from: initial.from ?? "",
    to: initial.to ?? "",
  });

  const [modal, setModal] = useState<
    | { kind: "adjust" }
    | { kind: "reverse"; row: Row }
    | { kind: "correct"; row: Row }
    | null
  >(null);

  function applyFilters(extra?: Record<string, string>) {
    const p = new URLSearchParams();
    const merged = { ...f, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    router.push(`${pathname}?${p.toString()}`);
  }

  function goPage(n: number) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    p.set("page", String(n));
    router.push(`${pathname}?${p.toString()}`);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {/* Filters */}
      <Card className="p-3 mb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="Search product, reason, invoice…"
            className="rounded-lg border border-line px-3 py-2 text-sm lg:col-span-2"
          />
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm bg-surface">
            <option value="">All types</option>
            <option value="check_in">Check-in</option>
            <option value="check_out">Check-out</option>
            <option value="adjustment">Adjustment</option>
          </select>
          <select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm bg-surface">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm bg-surface">
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={f.technicianId} onChange={(e) => setF({ ...f, technicianId: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm bg-surface">
            <option value="">All technicians</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm" />
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm" />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => applyFilters()} className={btn.primary}>Apply</button>
          <button
            onClick={() => {
              setF({ q: "", warehouseId: "", productId: "", technicianId: "", type: "", from: "", to: "" });
              router.push(pathname);
            }}
            className={btn.secondary}
          >
            Clear
          </button>
          <button onClick={() => setModal({ kind: "adjust" })} className={`${btn.primary} ml-auto`}>
            + New adjustment
          </button>
        </div>
      </Card>

      <div className="text-xs text-muted mb-2">{total} movements</div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium">Detail</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted">No movements match these filters.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <TypeBadge type={r.type} isReversal={r.isReversal} />
                    </td>
                    <td className="px-3 py-2">{r.productName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.warehouseName}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.quantity < 0 ? "text-red-600" : "text-brand-700"}`}>
                      {r.quantity > 0 ? "+" : ""}{qty(r.quantity)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted max-w-[240px]">
                      {r.technicianName ? <div>Tech: {r.technicianName}</div> : null}
                      {r.invoiceNumber ? <div>Invoice: {r.invoiceNumber}</div> : null}
                      {r.unitPrice != null ? <div>@ {money(r.unitPrice)}</div> : null}
                      {r.reason ? <div className="text-mint">{r.reason}</div> : null}
                      {r.userName ? <div>by {r.userName}</div> : null}
                      {r.isReversed ? <div className="text-amber-600 font-medium">Reversed</div> : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.isReversal ? (
                        <span className="text-xs text-muted">—</span>
                      ) : r.isReversed ? (
                        <span className="text-xs text-muted">reversed</span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setModal({ kind: "correct", row: r })} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
                          <span className="text-line">·</span>
                          <button onClick={() => setModal({ kind: "reverse", row: r })} className="text-xs font-medium text-red-600 hover:underline">Reverse</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => goPage(page - 1)} className={btn.secondary}>Prev</button>
          <span className="text-muted">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => goPage(page + 1)} className={btn.secondary}>Next</button>
        </div>
      ) : null}

      {modal ? (
        <ReconcileModal
          modal={modal}
          products={products}
          warehouses={warehouses}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function TypeBadge({ type, isReversal }: { type: string; isReversal: boolean }) {
  const base = "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium";
  if (isReversal) return <span className={`${base} bg-amber-100 text-amber-700`}>Reversal</span>;
  const cls =
    type === "check_in" ? "bg-brand-100 text-brand-700"
      : type === "check_out" ? "bg-blue-100 text-blue-700"
        : "bg-white/10 text-mint";
  return <span className={`${base} ${cls}`}>{TYPE_LABEL[type] ?? type}</span>;
}

function ReconcileModal({
  modal,
  products,
  warehouses,
  onClose,
  onDone,
}: {
  modal:
    | { kind: "adjust" }
    | { kind: "reverse"; row: Row }
    | { kind: "correct"; row: Row };
  products: Option[];
  warehouses: Option[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [quantity, setQuantity] = useState(
    modal.kind === "correct" ? modal.row.quantity : 0
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    let payload: Record<string, unknown>;
    if (modal.kind === "adjust") {
      payload = { action: "adjust", productId, warehouseId, quantity, reason };
    } else if (modal.kind === "reverse") {
      payload = { action: "reverse", movementId: modal.row.id, reason };
    } else {
      payload = { action: "correct", movementId: modal.row.id, quantity, reason };
    }
    try {
      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  const title =
    modal.kind === "adjust" ? "New adjustment"
      : modal.kind === "reverse" ? "Reverse movement"
        : "Edit / correct movement";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="surface-light w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
        <h3 className="text-lg font-semibold">{title}</h3>

        {modal.kind !== "adjust" ? (
          <div className="rounded-lg bg-slate-100 p-3 text-sm">
            <div className="font-medium">{modal.row.productName}</div>
            <div className="text-xs text-muted">
              {modal.row.warehouseName} · current {modal.row.quantity > 0 ? "+" : ""}
              {qty(modal.row.quantity)}
              {modal.row.technicianName ? ` · ${modal.row.technicianName}` : ""}
            </div>
          </div>
        ) : null}

        {modal.kind === "adjust" ? (
          <>
            <label className="block text-sm font-medium">Product
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Warehouse
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          </>
        ) : null}

        {modal.kind !== "reverse" ? (
          <label className="block text-sm font-medium">
            {modal.kind === "correct" ? "Corrected quantity" : "Quantity (+ in / − out)"}
            <input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </label>
        ) : null}

        <label className="block text-sm font-medium">Reason (required)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. miscount, damaged, wrong tech"
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className={btn.secondary}>Cancel</button>
          <button onClick={submit} disabled={busy} className={`${modal.kind === "reverse" ? btn.danger : btn.primary} flex-1`}>
            {busy ? "Saving…" : title}
          </button>
        </div>
      </div>
    </div>
  );
}
