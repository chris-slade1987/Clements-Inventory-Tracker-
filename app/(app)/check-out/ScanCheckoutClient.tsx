"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { uomLabel } from "@/lib/uom";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

const NOT_COUNTED_CAP = 40;

type Warehouse = { id: string; name: string };
type Technician = { id: string; name: string; homeWarehouseId: string };
type Product = {
  id: string;
  name: string;
  unit: string;
  distributorSku: string | null;
  manufacturer: string | null;
  category: string | null;
  approved: boolean;
  confirmed: boolean;
};
type IdentifiedBy = "BARCODE" | "AI_PHOTO" | "MANUAL_SEARCH" | "SHELF_QR";
type CartLine = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  identifiedBy: IdentifiedBy;
  photoUrl?: string | null;
  aiConfidence?: number | null;
};
type Pending = {
  productId: string;
  name: string;
  unit: string;
  onHand: number;
  counted: boolean;
  identifiedBy: IdentifiedBy;
  photoUrl?: string | null;
  aiConfidence?: number | null;
  quantity: number;
};
type Candidate = {
  productId: string;
  confidence: number;
  reason: string;
  name: string;
  unit: string;
  distributorSku: string | null;
  onHand: number;
  counted: boolean;
};
type Receipt = {
  checkoutId: string;
  warehouse: string;
  technician: string;
  manager: string;
  at: string;
  totalItems: number;
  lines: { name: string; unit: string; quantity: number; identifiedBy: string }[];
};

export default function ScanCheckoutClient({
  branchLocked,
  defaultWarehouseId,
  warehouses,
  technicians,
  products,
  onHand,
  countedByWarehouse,
}: {
  branchLocked: boolean;
  defaultWarehouseId: string;
  warehouses: Warehouse[];
  technicians: Technician[];
  products: Product[];
  onHand: Record<string, Record<string, number>>;
  countedByWarehouse: Record<string, string[]>;
}) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [technicianId, setTechnicianId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<"build" | "review">("build");

  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Overlays.
  const [pending, setPending] = useState<Pending | null>(null);
  const [candidates, setCandidates] = useState<{ list: Candidate[]; photoUrl: string | null; message?: string } | null>(null);
  const [linkFlow, setLinkFlow] = useState<{ code: string } | null>(null);
  const [search, setSearch] = useState(""); // manual search / link search query

  // Submit / receipt.
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [blocked, setBlocked] = useState<{ productId?: string; name: string; onHand: number; requested: number; after?: number }[] | null>(null);
  const [blockedUnconfirmed, setBlockedUnconfirmed] = useState<{ name: string }[] | null>(null);

  // Over-on-hand escalation (carried from the legacy Check-Out flow): the manager
  // can't override the hard stop, but they can one-click message senior management
  // to reconcile on-hand. Opens an internal thread via /api/check-out/escalate.
  const [escalateNote, setEscalateNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [escalateError, setEscalateError] = useState<string | null>(null);

  const onHandFor = (pid: string) => onHand[warehouseId]?.[pid] ?? 0;
  const countedSet = useMemo(() => new Set(countedByWarehouse[warehouseId] ?? []), [countedByWarehouse, warehouseId]);
  const countedFor = (pid: string) => countedSet.has(pid);
  const capFor = (onHandVal: number, counted: boolean) => (counted ? onHandVal : NOT_COUNTED_CAP);
  const branchName = warehouses.find((w) => w.id === warehouseId)?.name ?? "this branch";

  function flash(msg: string) {
    setNote(msg);
    setTimeout(() => setNote(null), 3500);
  }

  // ---- Identification entry points -------------------------------------
  async function handleDetected(code: string) {
    setScanning(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/barcode/${encodeURIComponent(code)}?branch=${encodeURIComponent(warehouseId)}`);
      if (res.status === 404) {
        setLinkFlow({ code });
        setSearch("");
        setBusy(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.product) {
        setError(data.error ?? "Lookup failed.");
        setBusy(false);
        return;
      }
      openConfirm({
        productId: data.product.id,
        name: data.product.name,
        unit: data.product.unit,
        onHand: data.product.onHand,
        counted: data.product.counted,
        identifiedBy: data.identifiedBy === "SHELF_QR" ? "SHELF_QR" : "BARCODE",
      });
      setBusy(false);
    } catch {
      setError("Network error during lookup.");
      setBusy(false);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handlePhoto(file: File) {
    setScanning(false);
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToBase64(file);
      const res = await fetch("/api/inventory/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, mime: "image/jpeg", warehouseId }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Identification failed — search the catalog.");
        return;
      }
      const list: Candidate[] = Array.isArray(data.candidates) ? data.candidates : [];
      const photoUrl: string | null = data.photoUrl ?? null;
      // High-confidence preselect → straight to the confirm card.
      if (data.preselectProductId) {
        const top = list.find((c) => c.productId === data.preselectProductId) ?? list[0];
        if (top) {
          openConfirm({
            productId: top.productId,
            name: top.name,
            unit: top.unit,
            onHand: top.onHand,
            counted: top.counted,
            identifiedBy: "AI_PHOTO",
            aiConfidence: top.confidence,
            photoUrl,
          });
          return;
        }
      }
      setCandidates({ list, photoUrl, message: data.message });
    } catch {
      setBusy(false);
      setError("Network error during identification.");
    }
  }

  function pickCandidate(c: Candidate, photoUrl: string | null) {
    setCandidates(null);
    openConfirm({
      productId: c.productId,
      name: c.name,
      unit: c.unit,
      onHand: c.onHand,
      counted: c.counted,
      identifiedBy: "AI_PHOTO",
      aiConfidence: c.confidence,
      photoUrl,
    });
  }

  function pickManual(p: Product) {
    setSearch("");
    openConfirm({
      productId: p.id,
      name: p.name,
      unit: p.unit,
      onHand: onHandFor(p.id),
      counted: countedFor(p.id),
      identifiedBy: "MANUAL_SEARCH",
    });
  }

  async function linkAndContinue(p: Product) {
    if (!linkFlow) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/barcode/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: linkFlow.code, productId: p.id }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok && !data.alreadyLinked) {
        setError(data.error ?? "Could not link the barcode.");
        return;
      }
      if (data.alreadyLinked && !data.sameProduct) {
        setError(`That barcode is already linked to ${data.linkedTo?.name ?? "another product"}.`);
        return;
      }
      flash(`Linked ${linkFlow.code} → ${p.name}`);
      setLinkFlow(null);
      openConfirm({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        onHand: onHandFor(p.id),
        counted: countedFor(p.id),
        identifiedBy: "BARCODE",
      });
    } catch {
      setBusy(false);
      setError("Network error while linking.");
    }
  }

  // ---- Confirmation card ----------------------------------------------
  function openConfirm(p: Omit<Pending, "quantity">) {
    const cap = capFor(p.onHand, p.counted);
    setPending({ ...p, quantity: cap > 0 ? 1 : 0 });
  }

  function addPendingToCart() {
    if (!pending || pending.quantity < 1) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === pending.productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === pending.productId ? { ...l, quantity: l.quantity + pending.quantity } : l,
        );
      }
      return [
        ...prev,
        {
          productId: pending.productId,
          name: pending.name,
          unit: pending.unit,
          quantity: pending.quantity,
          identifiedBy: pending.identifiedBy,
          photoUrl: pending.photoUrl ?? null,
          aiConfidence: pending.aiConfidence ?? null,
        },
      ];
    });
    flash(`Added ${pending.name}`);
    setPending(null);
  }

  function setQty(pid: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.productId === pid ? { ...l, quantity: Math.max(0, qty) } : l)).filter((l) => l.quantity > 0));
  }
  function removeLine(pid: string) {
    setCart((prev) => prev.filter((l) => l.productId !== pid));
  }

  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);

  // ---- Submit ----------------------------------------------------------
  async function submit(signatureImage: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, technicianId, lines: cart, signatureImage }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "unconfirmed_product") {
        setBlockedUnconfirmed(data.offending ?? []);
        setBusy(false);
        return;
      }
      if (res.status === 409 && data.error === "negative_stock") {
        setBlocked(data.offending ?? []);
        setEscalateNote("");
        setEscalateError(null);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Checkout failed.");
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

  async function undo() {
    if (!receipt) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/checkout/${receipt.checkoutId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Could not undo.");
        return;
      }
      flash("Checkout undone.");
      reset();
      router.refresh();
    } catch {
      setBusy(false);
      setError("Network error during undo.");
    }
  }

  // Over-on-hand escalation: open an internal discussion for senior management to
  // reconcile on-hand. Reuses the legacy /api/check-out/escalate endpoint.
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
            after: o.after ?? o.onHand - o.requested,
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
    setStep("build");
    setTechnicianId("");
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
          <h2 className="text-lg font-semibold">Checkout submitted</h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Warehouse</dt>
          <dd className="text-right font-medium">{receipt.warehouse}</dd>
          <dt className="text-muted">Technician</dt>
          <dd className="text-right font-medium">{receipt.technician}</dd>
          <dt className="text-muted">By</dt>
          <dd className="text-right font-medium">{receipt.manager}</dd>
          <dt className="text-muted">When</dt>
          <dd className="text-right font-medium">{new Date(receipt.at).toLocaleString()}</dd>
        </dl>
        <div className="mt-4 divide-y divide-line border-t border-line">
          {receipt.lines.map((l, i) => (
            <div key={i} className="flex justify-between py-2 text-sm">
              <span>{l.name}</span>
              <span className="font-medium">{l.quantity} {uomLabel(l.unit)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-sm font-semibold">
          <span>Total items</span>
          <span>{receipt.totalItems}</span>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={reset} className={btn.primary} disabled={busy}>New checkout</button>
          <button onClick={undo} className={btn.secondary} disabled={busy}>Undo (15 min)</button>
        </div>
        <Link href="/inventory/history" className="mt-3 block text-center text-sm font-medium text-brand-700 hover:underline">
          View checkout history
        </Link>
      </Card>
    );
  }

  // ---- Review & signature view -----------------------------------------
  if (step === "review") {
    return (
      <ReviewStep
        cart={cart}
        branchName={branchName}
        technicianName={technicians.find((t) => t.id === technicianId)?.name ?? ""}
        busy={busy}
        error={error}
        onBack={() => setStep("build")}
        onSubmit={submit}
      />
    );
  }

  // ---- Build view ------------------------------------------------------
  const canReview = warehouseId && technicianId && cart.length > 0;

  return (
    <div className="space-y-4 pb-4">
      {/* Branch + technician */}
      <Card className="p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Warehouse</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={branchLocked}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface disabled:opacity-70"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          {branchLocked ? <p className="mt-1 text-xs text-muted">Pinned to your branch.</p> : null}
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
              {technicians.filter((t) => t.homeWarehouseId === warehouseId).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Other warehouses">
              {technicians.filter((t) => t.homeWarehouseId !== warehouseId).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
      </Card>

      {/* Scan / search */}
      <Card className="p-4">
        <button type="button" onClick={() => setScanning(true)} className={`${btn.primary} w-full`} disabled={busy}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M3 12h18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Scan a product
        </button>
        <div className="mt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="…or search the catalog by name or SKU"
            className="w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          {search.trim() && !linkFlow ? (
            <ManualResults products={products} query={search} onPick={pickManual} onHandFor={onHandFor} countedFor={countedFor} />
          ) : null}
        </div>
        {note ? <p className="mt-2 text-xs font-medium text-brand-700">{note}</p> : null}
        {busy ? <p className="mt-2 text-xs text-muted">Working…</p> : null}
      </Card>

      {/* Cart */}
      {cart.length === 0 ? (
        <p className="text-sm text-muted px-1">No products added yet. Scan or search to build the checkout.</p>
      ) : (
        <div className="space-y-2">
          {cart.map((line) => (
            <Card key={line.productId} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex items-start gap-2">
                  {line.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.photoUrl} alt="" className="h-10 w-10 rounded-md object-cover border border-line" />
                  ) : null}
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{line.name}</div>
                    <div className="text-xs text-muted">
                      {line.quantity} {uomLabel(line.unit)} · <IdentifiedBadge kind={line.identifiedBy} />
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => removeLine(line.productId)} className="text-muted hover:text-red-600 p-1" aria-label="Remove">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setQty(line.productId, line.quantity - 1)} className="h-10 w-10 rounded-lg border border-line text-lg font-semibold active:bg-slate-100">−</button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => setQty(line.productId, Math.trunc(Number(e.target.value)))}
                  className="h-10 w-16 rounded-lg border border-line text-center text-sm"
                />
                <button type="button" onClick={() => setQty(line.productId, line.quantity + 1)} className="h-10 w-10 rounded-lg border border-line text-lg font-semibold active:bg-slate-100">+</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <button
        type="button"
        onClick={() => { setError(null); setStep("review"); }}
        disabled={!canReview}
        className={`${btn.primary} w-full`}
      >
        Review &amp; submit{totalItems ? ` · ${totalItems} item${totalItems === 1 ? "" : "s"}` : ""}
      </button>

      {/* Scanner overlay */}
      {scanning ? (
        <BarcodeScanner
          onDetected={handleDetected}
          onClose={() => setScanning(false)}
          onPhoto={handlePhoto}
          onSearchInstead={() => setScanning(false)}
          onPermissionDenied={() => { setScanning(false); flash("Camera unavailable — search the catalog instead."); }}
        />
      ) : null}

      {/* Confirmation card overlay */}
      {pending ? (
        <ConfirmCard
          pending={pending}
          branchName={branchName}
          onCancel={() => setPending(null)}
          onQty={(q) => setPending({ ...pending, quantity: q })}
          onAdd={addPendingToCart}
        />
      ) : null}

      {/* AI candidates overlay */}
      {candidates ? (
        <Overlay onClose={() => setCandidates(null)} title="Which product is this?">
          {candidates.message ? <p className="text-sm text-muted mb-2">{candidates.message}</p> : null}
          {candidates.list.length === 0 ? (
            <p className="text-sm text-muted">No confident match. Close this and search the catalog by name.</p>
          ) : (
            <ul className="divide-y divide-line">
              {candidates.list.map((c) => (
                <li key={c.productId}>
                  <button className="flex w-full items-center justify-between gap-2 py-3 text-left" onClick={() => pickCandidate(c, candidates.photoUrl)}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">{Math.round(c.confidence * 100)}% · {c.reason || "match"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{c.counted ? `${c.onHand} on hand` : "not counted"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Overlay>
      ) : null}

      {/* Unknown barcode → link flow overlay */}
      {linkFlow ? (
        <Overlay onClose={() => setLinkFlow(null)} title="New barcode — which product is this?">
          <p className="text-sm text-muted mb-2">Barcode <span className="font-mono">{linkFlow.code}</span> isn&apos;t linked yet. Pick the product it belongs to, or identify it with a photo.</p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or SKU…"
            className="w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            autoFocus
          />
          <ManualResults products={products} query={search} onPick={linkAndContinue} onHandFor={onHandFor} countedFor={countedFor} />
          <label className={`${btn.secondary} mt-3 w-full cursor-pointer`}>
            Identify with photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLinkFlow(null); handlePhoto(f); } }}
            />
          </label>
        </Overlay>
      ) : null}

      {/* Hard-stop overlays */}
      {blocked ? (
        <Overlay onClose={() => (escalating ? undefined : setBlocked(null))} title="Over-dispense blocked">
          <p className="text-sm text-muted mb-2">These lines exceed on-hand at {branchName}. Recount the shelf or reconcile before dispensing — no override.</p>
          <ul className="divide-y divide-line text-sm">
            {blocked.map((o, i) => (
              <li key={o.productId ?? i} className="flex justify-between py-2">
                <span>{o.name}</span>
                <span className="text-red-600 font-medium">need {o.requested}, have {o.onHand}</span>
              </li>
            ))}
          </ul>

          <label className="mt-3 block text-sm font-medium">
            Add a note for senior management (optional)
            <textarea
              value={escalateNote}
              onChange={(e) => setEscalateNote(e.target.value)}
              rows={3}
              placeholder="Anything that helps them reconcile…"
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </label>

          {escalateError ? <p className="mt-2 text-sm text-red-600" role="alert">{escalateError}</p> : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className={btn.secondary} onClick={() => setBlocked(null)} disabled={escalating}>Back to cart</button>
            <button className={btn.primary} onClick={escalate} disabled={escalating}>
              {escalating ? "Starting…" : "Message senior management"}
            </button>
          </div>
        </Overlay>
      ) : null}
      {blockedUnconfirmed ? (
        <Overlay onClose={() => setBlockedUnconfirmed(null)} title="Unconfirmed product">
          <p className="text-sm text-muted mb-2">These products must be confirmed by an admin before they can be dispensed:</p>
          <ul className="divide-y divide-line text-sm">
            {blockedUnconfirmed.map((o, i) => <li key={i} className="py-2">{o.name}</li>)}
          </ul>
          <button className={`${btn.secondary} mt-3 w-full`} onClick={() => setBlockedUnconfirmed(null)}>Back to cart</button>
        </Overlay>
      ) : null}
    </div>
  );
}

function IdentifiedBadge({ kind }: { kind: string }) {
  const label = kind === "BARCODE" ? "scanned" : kind === "AI_PHOTO" ? "AI photo" : kind === "SHELF_QR" ? "shelf QR" : "manual";
  return <span className="text-muted">{label}</span>;
}

function ManualResults({
  products,
  query,
  onPick,
  onHandFor,
  countedFor,
}: {
  products: Product[];
  query: string;
  onPick: (p: Product) => void;
  onHandFor: (id: string) => number;
  countedFor: (id: string) => boolean;
}) {
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return products
      .filter((p) => [p.name, p.distributorSku, p.manufacturer, p.category].filter(Boolean).some((s) => s!.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [products, q]);
  if (!q || results.length === 0) return null;
  return (
    <ul className="surface-light mt-2 divide-y divide-line rounded-lg border border-line overflow-hidden">
      {results.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onPick(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#eef5f0]">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted">{p.distributorSku ?? p.manufacturer ?? uomLabel(p.unit)}{p.approved ? "" : " · off-catalog"}</span>
            </span>
            <span className="shrink-0 text-xs text-muted">{countedFor(p.id) ? `${onHandFor(p.id)} on hand` : "not counted"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConfirmCard({
  pending,
  branchName,
  onCancel,
  onQty,
  onAdd,
}: {
  pending: Pending;
  branchName: string;
  onCancel: () => void;
  onQty: (q: number) => void;
  onAdd: () => void;
}) {
  const cap = pending.counted ? pending.onHand : NOT_COUNTED_CAP;
  const options = Array.from({ length: Math.min(cap, 500) }, (_, i) => i + 1);
  return (
    <Overlay onClose={onCancel} title="Confirm product">
      <div className="flex items-start gap-3">
        {pending.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pending.photoUrl} alt="" className="h-16 w-16 rounded-lg object-cover border border-line" />
        ) : null}
        <div className="min-w-0">
          <div className="font-medium">{pending.name}</div>
          <div className="text-sm text-muted">{uomLabel(pending.unit)}</div>
          {pending.counted ? (
            <div className="text-sm mt-1">On hand at {branchName}: <span className="font-semibold">{pending.onHand}</span></div>
          ) : (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not yet counted</div>
          )}
        </div>
      </div>
      <div className="mt-4">
        <label className="block text-sm font-medium mb-1">Quantity</label>
        {cap <= 0 ? (
          <p className="text-sm text-red-600">Nothing on hand to dispense.</p>
        ) : cap <= 500 ? (
          <select
            value={pending.quantity}
            onChange={(e) => onQty(Number(e.target.value))}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
          >
            {options.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <input
            type="number"
            min={1}
            max={cap}
            value={pending.quantity}
            onChange={(e) => onQty(Math.max(1, Math.min(cap, Math.trunc(Number(e.target.value)))))}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-sm"
          />
        )}
        {!pending.counted ? <p className="mt-1 text-xs text-muted">Capped at {NOT_COUNTED_CAP} until this product is counted at {branchName}.</p> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className={btn.secondary} onClick={onCancel}>Cancel</button>
        <button className={btn.primary} onClick={onAdd} disabled={cap <= 0 || pending.quantity < 1}>Add to cart</button>
      </div>
    </Overlay>
  );
}

function Overlay({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReviewStep({
  cart,
  branchName,
  technicianName,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  cart: CartLine[];
  branchName: string;
  technicianName: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (signature: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const dirtyRef = useRef(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0e1b15";
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirtyRef.current = true;
  }
  function up() {
    drawingRef.current = false;
  }
  function clearSig() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirtyRef.current = false;
  }
  function doSubmit() {
    const sig = dirtyRef.current && canvasRef.current ? canvasRef.current.toDataURL("image/png") : null;
    onSubmit(sig);
  }

  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="space-y-4 pb-4">
      <Card className="p-4">
        <div className="text-sm text-muted">Issuing to</div>
        <div className="font-medium">{technicianName} · {branchName}</div>
        <div className="mt-3 divide-y divide-line border-t border-line">
          {cart.map((l) => (
            <div key={l.productId} className="flex justify-between py-2 text-sm">
              <span className="min-w-0 truncate">{l.name}</span>
              <span className="font-medium shrink-0">{l.quantity} {uomLabel(l.unit)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-sm font-semibold">
          <span>Total items</span><span>{totalItems}</span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Technician signature (optional)</label>
          <button type="button" onClick={clearSig} className="text-xs font-medium text-brand-700 hover:underline">Clear</button>
        </div>
        <canvas
          ref={canvasRef}
          width={600}
          height={180}
          className="w-full h-40 rounded-lg border border-line bg-white touch-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
      </Card>

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <button className={btn.secondary} onClick={onBack} disabled={busy}>Back</button>
        <button className={btn.primary} onClick={doSubmit} disabled={busy}>{busy ? "Submitting…" : "Submit checkout"}</button>
      </div>
    </div>
  );
}
