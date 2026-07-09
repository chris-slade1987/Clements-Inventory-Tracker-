"use client";

import { useRef, useState } from "react";
import { Card, btn } from "@/components/ui";

type Warehouse = { id: string; name: string };
type Product = { id: string; name: string; unit: string };

type ReviewLine = {
  key: string;
  descriptionRaw: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  lineTotal: number | null;
  // productId, or "__new__" to create, or "" for unmatched (skipped)
  productId: string;
  newName: string;
  newUnit: string;
};

type Receipt = {
  warehouse: string;
  distributor: string;
  invoiceNumber: string;
  itemCount: number;
  lineCount: number;
};

let keySeq = 0;

export default function CheckInClient({
  mode,
  defaultWarehouseId,
  warehouses,
  products,
}: {
  mode: "mock" | "claude";
  defaultWarehouseId: string;
  warehouses: Warehouse[];
  products: Product[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [distributor, setDistributor] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [subtotal, setSubtotal] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [lines, setLines] = useState<ReviewLine[] | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  async function readInvoice() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/check-in/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not read the invoice.");
        setBusy(false);
        return;
      }
      const inv = data.invoice;
      setDistributor(inv.distributor ?? "");
      setInvoiceNumber(inv.invoiceNumber ?? "");
      setInvoiceDate(inv.invoiceDate ?? new Date().toISOString().slice(0, 10));
      setSubtotal(inv.subtotal ?? null);
      setTotal(inv.total ?? null);
      setFilePath(data.filePath ?? null);
      setLines(
        inv.lines.map((l: ReviewLine & { description: string }, i: number) => ({
          key: `l${keySeq++}`,
          descriptionRaw: l.description,
          quantity: l.quantity ?? 0,
          unit: l.unit ?? "ea",
          unitPrice: l.unitPrice ?? null,
          lineTotal: l.lineTotal ?? null,
          productId: data.matches[i] ?? "",
          newName: l.description,
          newUnit: l.unit ?? "ea",
        }))
      );
      setBusy(false);
    } catch {
      setError("Network error while reading the invoice.");
      setBusy(false);
    }
  }

  function updateLine(key: string, patch: Partial<ReviewLine>) {
    setLines((prev) =>
      prev ? prev.map((l) => (l.key === key ? { ...l, ...patch } : l)) : prev
    );
  }
  function removeLine(key: string) {
    setLines((prev) => (prev ? prev.filter((l) => l.key !== key) : prev));
  }

  async function confirm() {
    if (!lines) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        warehouseId,
        filePath,
        distributor,
        invoiceNumber,
        invoiceDate,
        subtotal,
        total,
        lines: lines.map((l) => ({
          productId: l.productId && l.productId !== "__new__" ? l.productId : null,
          newProduct:
            l.productId === "__new__"
              ? { name: l.newName, unitOfMeasure: l.newUnit }
              : null,
          descriptionRaw: l.descriptionRaw,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
      };
      const res = await fetch("/api/check-in/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Confirm failed.");
        setBusy(false);
        return;
      }
      setReceipt(data.receipt as Receipt);
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  function reset() {
    setReceipt(null);
    setLines(null);
    setFile(null);
    setFilePath(null);
    setDistributor("");
    setInvoiceNumber("");
    setInvoiceDate("");
    setSubtotal(null);
    setTotal(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---- Receipt --------------------------------------------------------
  if (receipt) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-lg font-semibold">Invoice checked in</h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Warehouse</dt>
          <dd className="text-right font-medium">{receipt.warehouse}</dd>
          <dt className="text-muted">Distributor</dt>
          <dd className="text-right font-medium">{receipt.distributor}</dd>
          <dt className="text-muted">Invoice #</dt>
          <dd className="text-right font-medium">{receipt.invoiceNumber}</dd>
          <dt className="text-muted">Lines</dt>
          <dd className="text-right font-medium">{receipt.lineCount}</dd>
          <dt className="text-muted">Items added</dt>
          <dd className="text-right font-medium">{receipt.itemCount}</dd>
        </dl>
        <button onClick={reset} className={`${btn.primary} w-full mt-5`}>
          Check in another
        </button>
      </Card>
    );
  }

  // ---- Review ---------------------------------------------------------
  if (lines) {
    return (
      <div className="space-y-4">
        <Card className="p-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Distributor</label>
            <input
              value={distributor}
              onChange={(e) => setDistributor(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice #</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-sm"
            />
          </div>
        </Card>

        <div className="space-y-2">
          {lines.map((l) => {
            const unmatched = l.productId === "";
            return (
              <Card key={l.key} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <input
                    value={l.descriptionRaw}
                    onChange={(e) =>
                      updateLine(l.key, { descriptionRaw: e.target.value })
                    }
                    className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm font-medium"
                  />
                  <button
                    onClick={() => removeLine(l.key)}
                    className="text-muted hover:text-red-600 p-1"
                    aria-label="Remove line"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="text-xs text-muted">
                    Qty
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(l.key, { quantity: Number(e.target.value) })
                      }
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Unit
                    <input
                      value={l.unit}
                      onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Unit price
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.unitPrice ?? ""}
                      onChange={(e) =>
                        updateLine(l.key, {
                          unitPrice: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>

                <div className="mt-2">
                  <label className="text-xs text-muted">Product</label>
                  <select
                    value={l.productId}
                    onChange={(e) => updateLine(l.key, { productId: e.target.value })}
                    className={`mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm bg-surface ${
                      unmatched ? "border-amber-400" : "border-line"
                    }`}
                  >
                    <option value="">— Unmatched (won&rsquo;t be added) —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    <option value="__new__">+ Create new product…</option>
                  </select>
                  {l.productId === "__new__" ? (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <input
                        value={l.newName}
                        onChange={(e) => updateLine(l.key, { newName: e.target.value })}
                        placeholder="New product name"
                        className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-sm"
                      />
                      <input
                        value={l.newUnit}
                        onChange={(e) => updateLine(l.key, { newUnit: e.target.value })}
                        placeholder="unit"
                        className="rounded-lg border border-line px-2 py-1.5 text-sm"
                      />
                    </div>
                  ) : null}
                  {unmatched ? (
                    <p className="mt-1 text-xs text-amber-600">
                      Match to a product or create one, or this line is skipped.
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button onClick={reset} className={btn.secondary}>
            Start over
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className={`${btn.primary} flex-1`}
          >
            {busy ? "Posting…" : "Confirm check-in"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Upload ---------------------------------------------------------
  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center bg-surface ${
          file ? "border-brand-400" : "border-line"
        }`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {file ? (
          <p className="text-sm font-medium">{file.name}</p>
        ) : (
          <p className="text-sm text-muted">
            Drag a PDF or photo here, or choose a file below.
          </p>
        )}
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={() => fileRef.current?.click()} className={btn.secondary}>
            Choose file
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-muted">
        Invoice reader:{" "}
        <span className="font-medium">
          {mode === "claude" ? "Claude vision (live)" : "Mock parser (no API key set)"}
        </span>
        . Nothing is posted until you review and confirm.
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        onClick={readInvoice}
        disabled={!file || busy}
        className={`${btn.primary} w-full`}
      >
        {busy ? "Reading invoice…" : "Read invoice"}
      </button>
    </div>
  );
}
