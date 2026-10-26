"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Card, btn, UnitSelect } from "@/components/ui";
import { PRODUCT_CATEGORIES, DIVISIONS, DIVISION_LABELS, SUBDIVISIONS, type Division } from "@/lib/constants";
import ProductPhotos, { type PhotoTile } from "../ProductPhotos";

// Camera scanner is client-only (getUserMedia); load it lazily so it never
// bloats the initial Edit bundle and SSR stays clean.
const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

type ProductFields = {
  id: string;
  name: string;
  manufacturer: string | null;
  epaRegNumber: string | null;
  unitOfMeasure: string;
  category: string | null;
  division: string | null;
  subdivision: string | null;
  form: string | null;
  activeIngredient: string | null;
  targetPest: string | null;
  applicationMethod: string | null;
  barcode: string | null;
  distributorSku: string | null;
  notes: string | null;
  active: boolean;
  approved: boolean;
};

type Barcode = { id: string; code: string; symbology: string | null };

export default function ProductEditor({
  product,
  photos,
  barcodes: initialBarcodes,
}: {
  product: ProductFields;
  photos: PhotoTile[];
  barcodes: Barcode[];
}) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: product.name,
    manufacturer: product.manufacturer ?? "",
    epaRegNumber: product.epaRegNumber ?? "",
    unitOfMeasure: product.unitOfMeasure,
    category: product.category ?? "Other",
    division: product.division ?? "",
    subdivision: product.subdivision ?? "",
    form: product.form ?? "",
    activeIngredient: product.activeIngredient ?? "",
    targetPest: product.targetPest ?? "",
    applicationMethod: product.applicationMethod ?? "",
    barcode: product.barcode ?? "",
    distributorSku: product.distributorSku ?? "",
    notes: product.notes ?? "",
    active: product.active,
    approved: product.approved,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Barcode reader state
  const [barcodes, setBarcodes] = useState<Barcode[]>(initialBarcodes);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [bcBusy, setBcBusy] = useState(false);
  const [bcError, setBcError] = useState<string | null>(null);
  const [bcNote, setBcNote] = useState<string | null>(null);
  // When a scanned code is already on a DIFFERENT product, hold the conflict so the
  // manager can choose to move (reassign) it here instead of hitting a dead end.
  const [conflict, setConflict] = useState<{ code: string; symbology: string | null; other: { id: string; name: string } | null } | null>(null);

  const subOptions = form.division && (SUBDIVISIONS as Record<string, string[]>)[form.division]
    ? (SUBDIVISIONS as Record<string, string[]>)[form.division]
    : [];

  function bcFlash(m: string) { setBcNote(m); setTimeout(() => setBcNote(null), 3000); }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/manage/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: product.id, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Save failed."); return; }
    router.push(`/manage/products/${product.id}`);
    router.refresh();
  }

  async function linkCode(code: string, symbology?: string | null, opts?: { reassign?: boolean }) {
    const trimmed = code.trim();
    if (!trimmed) { setBcError("Enter a barcode to link."); return; }
    setBcBusy(true);
    setBcError(null);
    if (!opts?.reassign) setConflict(null);
    try {
      const res = await fetch("/api/inventory/barcode/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed, productId: product.id, symbology: symbology ?? null, reassign: opts?.reassign === true }),
      });
      const data = await res.json().catch(() => ({}));
      setBcBusy(false);
      // Already on a different product and the manager hasn't chosen override yet —
      // surface the conflict so they can move it here (or open the other product).
      if (!opts?.reassign && (res.status === 409 || (data && data.alreadyLinked && !data.sameProduct))) {
        setConflict({ code: trimmed, symbology: symbology ?? null, other: data.linkedTo ?? null });
        return;
      }
      if (!res.ok) { setBcError(data.error ?? "Could not link barcode."); return; }
      if (data.alreadyLinked && data.sameProduct) {
        bcFlash("Already linked to this product.");
      } else if (data.barcode) {
        setBarcodes((prev) => prev.some((b) => b.code === data.barcode.code)
          ? prev.map((b) => (b.code === data.barcode.code ? { id: data.barcode.id, code: data.barcode.code, symbology: symbology ?? b.symbology } : b))
          : [...prev, { id: data.barcode.id, code: data.barcode.code, symbology: symbology ?? null }]);
        bcFlash(data.reassigned ? `Moved ${trimmed} here${data.reassignedFrom ? ` from ${data.reassignedFrom.name}` : ""}.` : `Linked ${trimmed}.`);
      }
      setConflict(null);
      setManualCode("");
      router.refresh();
    } catch {
      setBcBusy(false);
      setBcError("Network error. Try again.");
    }
  }

  async function unlink(id: string) {
    setBcBusy(true);
    setBcError(null);
    try {
      const res = await fetch("/api/inventory/barcode/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      setBcBusy(false);
      if (!res.ok) { setBcError(data.error ?? "Could not remove barcode."); return; }
      setBarcodes((prev) => prev.filter((b) => b.id !== id));
      bcFlash("Barcode removed.");
      router.refresh();
    } catch {
      setBcBusy(false);
      setBcError("Network error. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      {/* --- Product fields --- */}
      <Card className="p-4">
        <div className="mb-3 text-sm font-medium text-ink">Product details</div>
        <div className="space-y-3">
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Unit of measure
              <UnitSelect
                value={form.unitOfMeasure}
                onChange={(code) => setForm({ ...form, unitOfMeasure: code })}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Line of service
              <select
                value={form.division}
                onChange={(e) => setForm({ ...form, division: e.target.value, subdivision: "" })}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
              >
                <option value="">— None —</option>
                {DIVISIONS.map((d) => <option key={d} value={d}>{DIVISION_LABELS[d as Division]}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Subcategory
              <select
                value={form.subdivision}
                onChange={(e) => setForm({ ...form, subdivision: e.target.value })}
                disabled={!form.division}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface disabled:opacity-50"
              >
                <option value="">— None —</option>
                {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Physical form" value={form.form} onChange={(v) => setForm({ ...form, form: v })} placeholder="liquid, granular, aerosol…" />
            <Field label="Manufacturer" value={form.manufacturer} onChange={(v) => setForm({ ...form, manufacturer: v })} />
          </div>
          <Field label="Active ingredient" value={form.activeIngredient} onChange={(v) => setForm({ ...form, activeIngredient: v })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="EPA reg #" value={form.epaRegNumber} onChange={(v) => setForm({ ...form, epaRegNumber: v })} />
            <Field label="Target pest" value={form.targetPest} onChange={(v) => setForm({ ...form, targetPest: v })} />
          </div>
          <Field label="Application method" value={form.applicationMethod} onChange={(v) => setForm({ ...form, applicationMethod: v })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Distributor SKU" value={form.distributorSku} onChange={(v) => setForm({ ...form, distributorSku: v })} />
            <Field label="Primary barcode (legacy field)" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} placeholder="Prefer the barcode reader below" />
          </div>
          <label className="block text-sm font-medium">Notes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={form.approved} onChange={(e) => setForm({ ...form, approved: e.target.checked })} />
              On approved catalog
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <div className="flex gap-2 pt-1">
            <Link href={`/manage/products/${product.id}`} className={btn.secondary}>Cancel</Link>
            <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </Card>

      {/* --- Barcode reader --- */}
      <Card className="p-4">
        <div className="mb-1 text-sm font-medium text-ink">Barcodes</div>
        <div className="mb-3 text-xs text-muted">
          Scan or type the product&apos;s barcode to link it. Linked codes resolve this product at check-out — no barcode photo needed.
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setScanning(true)} disabled={bcBusy} className={btn.primary}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M7 5v14M11 5v14M15 5v10M15 17v2M19 5v14M21 5v14" /></svg>
            Scan barcode
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block flex-1 text-sm font-medium">Or enter a code manually
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") linkCode(manualCode); }}
              inputMode="numeric"
              placeholder="e.g. 012345678905"
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm font-mono"
            />
          </label>
          <button type="button" onClick={() => linkCode(manualCode)} disabled={bcBusy || !manualCode.trim()} className={btn.secondary}>
            Link code
          </button>
        </div>

        {bcNote ? <p className="mt-2 text-sm text-brand-700">{bcNote}</p> : null}
        {bcError ? <p className="mt-2 text-sm text-red-600" role="alert">{bcError}</p> : null}

        {conflict ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert">
            <p className="text-sm text-ink">
              Barcode <span className="font-mono font-medium">{conflict.code}</span> is already linked to{" "}
              <span className="font-medium">{conflict.other?.name ?? "another product"}</span>.
            </p>
            <p className="mt-1 text-xs text-muted">
              If the barcode really belongs to <span className="text-ink">{product.name}</span>, move it here — it comes off{" "}
              {conflict.other?.name ?? "the other product"} and resolves to this product at check-out from now on. Past check-out history isn&apos;t changed.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={bcBusy} onClick={() => linkCode(conflict.code, conflict.symbology, { reassign: true })} className={btn.primary}>
                {bcBusy ? "Moving…" : "Move barcode to this product"}
              </button>
              {conflict.other ? (
                <Link href={`/manage/products/${conflict.other.id}/edit`} className={btn.secondary}>Open {conflict.other.name}</Link>
              ) : null}
              <button type="button" onClick={() => setConflict(null)} className="text-xs font-medium text-muted hover:text-ink">Cancel</button>
            </div>
          </div>
        ) : null}

        <div className="mt-3">
          <div className="text-xs font-medium text-muted">Linked barcodes</div>
          {barcodes.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None linked yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {barcodes.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-mono text-sm text-ink">{b.code}</span>
                    {b.symbology ? <span className="ml-2 text-xs text-muted">{b.symbology}</span> : null}
                  </span>
                  <button type="button" onClick={() => unlink(b.id)} disabled={bcBusy} className="text-xs font-medium text-red-600 hover:underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* --- Photo manager (add / replace / delete / tag) --- */}
      <ProductPhotos
        productId={product.id}
        photos={photos}
      />

      {scanning ? (
        <BarcodeScanner
          onDetected={(code) => { setScanning(false); linkCode(code); }}
          onClose={() => setScanning(false)}
          onPermissionDenied={() => { setScanning(false); setBcError("Couldn't access the camera — type the code manually instead."); }}
        />
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
