"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Card, btn, UnitSelect } from "@/components/ui";
import { uomCode, uomLabel } from "@/lib/uom";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), {
  ssr: false,
});

type Warehouse = { id: string; name: string };
type Technician = { id: string; name: string; homeWarehouseId: string };
type Product = {
  id: string;
  name: string;
  unit: string;
  approved: boolean;
  confirmed: boolean;
  barcode: string | null;
  category: string | null;
  manufacturer: string | null;
};
type Unconfirmed = { productId: string; name: string };
type CartLine = { productId: string; quantity: number; unit: string };
type Offending = {
  productId?: string;
  name: string;
  onHand: number;
  requested: number;
  after: number;
};
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
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [technicianId, setTechnicianId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // Insufficient-stock hard stop: when the server (or our own pre-check) finds a
  // line that exceeds on-hand, we surface a blocking modal — no manager override.
  const [blocked, setBlocked] = useState<Offending[] | null>(null);
  // Unconfirmed-product hard stop: auto-added products must be confirmed by an
  // admin before they can be dispersed. A data-quality gate — no override.
  const [blockedUnconfirmed, setBlockedUnconfirmed] = useState<Unconfirmed[] | null>(null);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [escalateError, setEscalateError] = useState<string | null>(null);

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
      // Default the line's unit to the product's canonical unit code.
      const prod = productById.get(productId);
      const unit = uomCode(prod?.unit) ?? "EA";
      return [...prev, { productId, quantity: qty, unit }];
    });
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: qty } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function setUnit(productId: string, unit: string) {
    setCart((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, unit } : l))
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

  // Offending lines computed locally from the cart vs. on-hand. Used to block
  // submit proactively; the server 409 remains the authoritative trigger.
  function localOffending(): Offending[] {
    return cart
      .map((l) => {
        const oh = onHandFor(l.productId);
        return {
          productId: l.productId,
          name: productById.get(l.productId)?.name ?? "Unknown",
          onHand: oh,
          requested: l.quantity,
          after: oh - l.quantity,
        };
      })
      .filter((o) => o.after < 0);
  }

  async function submit() {
    // Block unconfirmed products up front (the server 409 is authoritative).
    const unconfirmed: Unconfirmed[] = cart
      .map((l) => productById.get(l.productId))
      .filter((p): p is Product => !!p && p.confirmed === false)
      .map((p) => ({ productId: p.id, name: p.name }));
    if (unconfirmed.length > 0) {
      setBlockedUnconfirmed(unconfirmed);
      return;
    }
    // Don't even hit the server when the cart already exceeds on-hand.
    const offending = localOffending();
    if (offending.length > 0) {
      setBlocked(offending);
      setEscalateNote("");
      setEscalateError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, technicianId, lines: cart }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "unconfirmed_product") {
        setBlockedUnconfirmed((data.offending as Unconfirmed[]) ?? []);
        setBusy(false);
        return;
      }
      if (res.status === 409 && data.error === "negative_stock") {
        // Hard stop — surface the blocking modal. No override for managers.
        setBlocked((data.offending as Offending[]) ?? []);
        setEscalateNote("");
        setEscalateError(null);
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

  async function escalate() {
    if (!blocked) return;
    setEscalating(true);
    setEscalateError(null);
    try {
      const res = await fetch("/api/check-out/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          offending: blocked.map((o) => ({
            name: o.name,
            onHand: o.onHand,
            requested: o.requested,
            after: o.after,
          })),
          note: escalateNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.threadId) {
        setEscalateError(data.error ?? "Could not start the discussion. Try again.");
        setEscalating(false);
        return;
      }
      router.push(`/inbox/${data.threadId}`);
    } catch {
      setEscalateError("Network error. Try again.");
      setEscalating(false);
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
                {l.quantity} {uomLabel(l.unit)}
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
                        {p.manufacturer ?? "—"} · {uomLabel(p.unit)}
                        {p.approved ? "" : " · off-catalog"}
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
                      {uomLabel(line.unit)}
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
                  <label className="ml-2 flex items-center gap-1 text-xs text-muted">
                    <span className="sr-only">Unit</span>
                    <UnitSelect
                      value={line.unit}
                      onChange={(code) => setUnit(line.productId, code)}
                      className="h-10 rounded-lg border border-line px-2 text-sm bg-surface"
                    />
                  </label>
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
            onClick={() => submit()}
            className={`${btn.primary} ml-auto`}
          >
            {busy ? "Posting…" : "Confirm check-out"}
          </button>
        </Card>
      </div>

      {blocked ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-red-700">Not enough in stock</h3>
              <button
                onClick={() => setBlocked(null)}
                className="text-muted hover:text-ink text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="divide-y divide-line rounded-lg border border-line overflow-hidden">
              {blocked.map((o, i) => {
                const shortfall = Math.max(0, o.requested - o.onHand);
                return (
                  <div key={o.productId ?? i} className="px-3 py-2.5 text-sm">
                    <div className="font-medium">{o.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                      <span>On hand {o.onHand}</span>
                      <span>Requested {o.requested}</span>
                      <span className="font-semibold text-red-600">Short {shortfall}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-sm text-muted">
              There isn&apos;t enough on hand to check this out. Verify the
              warehouse&apos;s physical count, re-log the correct received amount
              into the warehouse (Check-In or Reconcile), or ask an administrator
              to reconcile on-hand — then try again.
            </p>

            <label className="block text-sm font-medium">
              Add a note for senior management (optional)
              <textarea
                value={escalateNote}
                onChange={(e) => setEscalateNote(e.target.value)}
                rows={3}
                placeholder="Anything that helps them reconcile…"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>

            {escalateError ? (
              <p className="text-sm text-red-600" role="alert">
                {escalateError}
              </p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setBlocked(null)}
                className={btn.secondary}
                disabled={escalating}
              >
                Back
              </button>
              <button
                onClick={escalate}
                disabled={escalating}
                className={`${btn.primary} flex-1`}
              >
                {escalating ? "Starting…" : "Message senior management for help"}
              </button>
            </div>
          </Card>
        </div>
      ) : null}

      {blockedUnconfirmed ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-red-700">Product not confirmed</h3>
              <button
                onClick={() => setBlockedUnconfirmed(null)}
                className="text-muted hover:text-ink text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="divide-y divide-line rounded-lg border border-line overflow-hidden">
              {blockedUnconfirmed.map((o, i) => (
                <div key={o.productId ?? i} className="px-3 py-2.5 text-sm">
                  <div className="font-medium">{o.name}</div>
                  <div className="mt-0.5 text-xs text-muted">Awaiting admin confirmation</div>
                </div>
              ))}
            </div>

            <p className="text-sm text-muted">
              {blockedUnconfirmed.length === 1 ? "This product was" : "These products were"} auto-added
              from an invoice or transfer history and {blockedUnconfirmed.length === 1 ? "hasn't" : "haven't"}{" "}
              been confirmed yet. They can&apos;t be dispersed until an administrator reviews and confirms
              {blockedUnconfirmed.length === 1 ? " it" : " them"} in Manage → Confirm queue. This is a
              data-quality gate and cannot be overridden here — remove{" "}
              {blockedUnconfirmed.length === 1 ? "it" : "them"} from this check-out or ask an admin to
              confirm first.
            </p>

            <div className="flex justify-end pt-1">
              <button onClick={() => setBlockedUnconfirmed(null)} className={btn.primary}>
                Got it
              </button>
            </div>
          </Card>
        </div>
      ) : null}

      {scanning ? (
        <BarcodeScanner
          onDetected={handleScan}
          onClose={() => setScanning(false)}
        />
      ) : null}
    </div>
  );
}
