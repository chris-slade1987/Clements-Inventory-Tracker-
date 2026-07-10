"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, btn } from "@/components/ui";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), {
  ssr: false,
});

type Warehouse = { id: string; name: string };
type Technician = { id: string; name: string; homeWarehouseId: string };
type Product = {
  id: string;
  name: string;
  unit: string;
  barcode: string | null;
  category: string | null;
  manufacturer: string | null;
};
type CartLine = { productId: string; quantity: number };
type Receipt = {
  warehouse: string;
  technician: string;
  manager: string;
  at: string;
  totalItems: number;
  lines: { name: string; unit: string; quantity: number }[];
};

export default function CheckOutClient({
  defaultWarehouseId,
  warehouses,
  technicians,
  products,
  onHand,
}: {
  defaultWarehouseId: string;
  warehouses: Warehouse[];
  technicians: Technician[];
  products: Product[];
  onHand: Record<string, Record<string, number>>;
}) {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [technicianId, setTechnicianId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const onHandFor = (productId: string) =>
    onHand[warehouseId]?.[productId] ?? 0;

  const inCart = (productId: string) =>
    cart.find((l) => l.productId === productId)?.quantity ?? 0;

  // Product search results (excludes items already in cart list position but
  // still allows re-adding to increment).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) =>
        [p.name, p.manufacturer, p.category]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [query, products]);

  function addProduct(productId: string, qty = 1) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + qty } : l
        );
      }
      return [...prev, { productId, quantity: qty }];
    });
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: qty } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  function handleScan(code: string) {
    setScanning(false);
    const match = products.find((p) => p.barcode && p.barcode === code.trim());
    if (match) {
      addProduct(match.id);
      setScanNote(`Added ${match.name}`);
    } else {
      setScanNote(`No product matches barcode ${code}`);
    }
    setTimeout(() => setScanNote(null), 3000);
  }

  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);
  const hasNegative = cart.some(
    (l) => onHandFor(l.productId) - l.quantity < 0
  );

  async function submit(allowNegative: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, technicianId, lines: cart, allowNegative }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "negative_stock") {
        // Ask for override.
        const names = (data.offending as { name: string; after: number }[])
          .map((o) => `${o.name} (would be ${o.after})`)
          .join(", ");
        if (
          confirm(
            `This check-out drives stock negative for: ${names}.\n\nPost it anyway?`
          )
        ) {
          setBusy(false);
          return submit(true);
        }
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Check-out failed.");
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
    setCart([]);
    setTechnicianId("");
    setQuery("");
    setError(null);
  }

  // ---- Receipt view ----------------------------------------------------
  if (receipt) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-lg font-semibold">Check-out posted</h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Warehouse</dt>
          <dd className="text-right font-medium">{receipt.warehouse}</dd>
          <dt className="text-muted">Technician</dt>
          <dd className="text-right font-medium">{receipt.technician}</dd>
          <dt className="text-muted">By</dt>
          <dd className="text-right font-medium">{receipt.manager}</dd>
          <dt className="text-muted">When</dt>
          <dd className="text-right font-medium">
            {new Date(receipt.at).toLocaleString()}
          </dd>
        </dl>
        <div className="mt-4 divide-y divide-line border-t border-line">
          {receipt.lines.map((l, i) => (
            <div key={i} className="flex justify-between py-2 text-sm">
              <span>{l.name}</span>
              <span className="font-medium">
                {l.quantity} {l.unit}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-sm font-semibold">
          <span>Total items</span>
          <span>{receipt.totalItems}</span>
        </div>
        <button onClick={reset} className={`${btn.primary} w-full mt-5`}>
          New check-out
        </button>
      </Card>
    );
  }

  // ---- Entry view ------------------------------------------------------
  const canSubmit = warehouseId && technicianId && cart.length > 0 && !busy;

  return (
    <div className="space-y-4 pb-4">
      {/* Warehouse + technician */}
      <Card className="p-4 space-y-3">
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
          <label className="block text-sm font-medium mb-1">Technician</label>
          <select
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
          >
            <option value="">Select technician…</option>
            <optgroup label="This warehouse">
              {technicians
                .filter((t) => t.homeWarehouseId === warehouseId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Other warehouses">
              {technicians
                .filter((t) => t.homeWarehouseId !== warehouseId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
      </Card>

      {/* Add products */}
      <Card className="p-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products…"
            className="flex-1 rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="button"
            onClick={() => setScanning(true)}
            className={btn.secondary}
            aria-label="Scan barcode"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14" strokeLinecap="round" />
            </svg>
            Scan
          </button>
        </div>
        {scanNote ? (
          <p className="mt-2 text-xs font-medium text-brand-700">{scanNote}</p>
        ) : null}

        {results.length > 0 ? (
          <ul className="surface-light mt-2 divide-y divide-line rounded-lg border border-line overflow-hidden">
            {results.map((p) => {
              const oh = onHandFor(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      addProduct(p.id);
                      setQuery("");
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {p.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {p.manufacturer ?? "—"} · {p.unit}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {oh} on-hand
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      {/* Cart */}
      {cart.length === 0 ? (
        <p className="text-sm text-muted px-1">
          No products added yet. Search or scan to build the check-out.
        </p>
      ) : (
        <div className="space-y-2">
          {cart.map((line) => {
            const p = productById.get(line.productId)!;
            const oh = onHandFor(line.productId);
            const after = oh - line.quantity;
            return (
              <Card key={line.productId} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{p.name}</div>
                    <div className="text-xs text-muted">
                      On-hand {oh} · after{" "}
                      <span className={after < 0 ? "text-red-600 font-semibold" : ""}>
                        {after}
                      </span>{" "}
                      {p.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.productId)}
                    className="text-muted hover:text-red-600 p-1"
                    aria-label="Remove"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQty(line.productId, line.quantity - 1)}
                    className="h-10 w-10 rounded-lg border border-line text-lg font-semibold active:bg-slate-100"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={line.quantity}
                    onChange={(e) =>
                      setQty(line.productId, Math.max(0, Number(e.target.value)))
                    }
                    className="h-10 w-16 rounded-lg border border-line text-center text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setQty(line.productId, line.quantity + 1)}
                    className="h-10 w-10 rounded-lg border border-line text-lg font-semibold active:bg-slate-100"
                  >
                    +
                  </button>
                  {after < 0 ? (
                    <span className="ml-auto text-xs font-medium text-red-600">
                      Over by {Math.abs(after)}
                    </span>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {/* Sticky confirm bar */}
      <div className="sticky bottom-20 md:bottom-4 z-10">
        <Card className="p-3 flex items-center gap-3 shadow-lg">
          <div className="text-sm">
            <div className="font-semibold">{totalItems} items</div>
            {hasNegative ? (
              <div className="text-xs text-red-600">Some lines exceed on-hand</div>
            ) : (
              <div className="text-xs text-muted">{cart.length} products</div>
            )}
          </div>
          <button
            disabled={!canSubmit}
            onClick={() => submit(false)}
            className={`${btn.primary} ml-auto`}
          >
            {busy ? "Posting…" : "Confirm check-out"}
          </button>
        </Card>
      </div>

      {scanning ? (
        <BarcodeScanner
          onDetected={handleScan}
          onClose={() => setScanning(false)}
        />
      ) : null}
    </div>
  );
}
