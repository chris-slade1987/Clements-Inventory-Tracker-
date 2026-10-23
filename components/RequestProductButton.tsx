"use client";

import { useRef, useState } from "react";
import { btn, UnitSelect } from "@/components/ui";
import { fileToJpegDataUrl } from "@/lib/client-image";
import { DIVISIONS, divisionLabel } from "@/lib/constants";

// Manager "Request new product" flow (Part 3). Capture/upload up to 3 photos
// (product, barcode, label), let the AI pre-fill the catalog fields, enter how
// many are on hand at this branch, and submit a ProductRequest to the super
// admins. Nothing touches the catalog — a super admin reviews + approves.
const MAX = 3;

type Fields = {
  name: string;
  manufacturer: string;
  distributorSku: string;
  unitOfMeasure: string;
  description: string;
  division: string;
  onHandQty: string;
};

const EMPTY: Fields = { name: "", manufacturer: "", distributorSku: "", unitOfMeasure: "EA", description: "", division: "", onHandQty: "" };

export default function RequestProductButton({
  warehouseId,
  className,
  label = "Request new product",
  initialName = "",
  productId = null,
}: {
  warehouseId?: string;
  className?: string;
  label?: string;
  initialName?: string;
  productId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? btn.secondary}>
        {label}
      </button>
      {open ? (
        <RequestModal
          warehouseId={warehouseId}
          initialName={initialName}
          productId={productId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RequestModal({
  warehouseId,
  initialName,
  productId,
  onClose,
}: {
  warehouseId?: string;
  initialName: string;
  productId: string | null;
  onClose: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [fields, setFields] = useState<Fields>({ ...EMPTY, name: initialName });
  const [busy, setBusy] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const full = photos.length >= MAX;
  const set = (k: keyof Fields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  async function addPhoto(file: File) {
    if (full) return;
    const dataUrl = await fileToJpegDataUrl(file);
    setPhotos((p) => [...p, dataUrl].slice(0, MAX));
  }

  async function autofill() {
    if (photos.length === 0) { setError("Add a photo first so the AI can read it."); return; }
    setAutofilling(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/product-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autofill", images: photos }),
      });
      const data = await res.json().catch(() => ({}));
      setAutofilling(false);
      if (!res.ok) { setError(data.error ?? "Could not read the photos."); return; }
      const sug = data.suggestion ?? {};
      setFields((f) => ({
        ...f,
        name: f.name || (sug.name ?? ""),
        manufacturer: f.manufacturer || (sug.manufacturer ?? ""),
        distributorSku: f.distributorSku || (sug.distributorSku ?? ""),
        description: f.description || (sug.description ?? ""),
        division: f.division || (sug.division ?? ""),
      }));
      if (!data.ai) setError("AI reading isn't available right now — fill the fields in by hand.");
    } catch {
      setAutofilling(false);
      setError("Network error. Try again.");
    }
  }

  async function submit() {
    if (!fields.name.trim()) { setError("Give the product a name."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/product-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          productId,
          proposedName: fields.name.trim(),
          manufacturer: fields.manufacturer.trim() || undefined,
          distributorSku: fields.distributorSku.trim() || undefined,
          unitOfMeasure: fields.unitOfMeasure || undefined,
          description: fields.description.trim() || undefined,
          division: fields.division || undefined,
          onHandQty: fields.onHandQty === "" ? undefined : fields.onHandQty,
          warehouseId,
          images: photos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setError(data.error ?? "Could not send the request."); return; }
      setDone(true);
    } catch {
      setBusy(false);
      setError("Network error. Try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="surface-light max-h-[92vh] w-full space-y-3 overflow-y-auto rounded-t-2xl p-5 sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Request a new product</h3>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">✕</button>
        </div>

        {done ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm text-ink">Your request was sent to the super admins. You&apos;ll be notified when it&apos;s approved and ready to dispense.</p>
            <button className={btn.primary} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">
              Photograph the product, its barcode, and its label (up to {MAX}). The AI pre-fills the details — correct
              anything, tell us how many you have on hand, and send it for approval.
            </p>

            {/* Photos */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Photos ({photos.length}/{MAX})</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => cameraRef.current?.click()} disabled={full || busy} className={btn.secondary}>Take photo</button>
                  <button type="button" onClick={() => uploadRef.current?.click()} disabled={full || busy} className={btn.secondary}>Upload</button>
                </div>
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.currentTarget.value = ""; }} />
              <input ref={uploadRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.currentTarget.value = ""; }} />
              {photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((src, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-24 w-full rounded-lg border border-line object-cover" />
                      <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                        className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white" aria-label="Remove photo">✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No photos yet.</p>
              )}
              {photos.length > 0 ? (
                <button type="button" onClick={autofill} disabled={autofilling || busy} className="mt-2 text-sm font-medium text-brand-700 hover:underline">
                  {autofilling ? "Reading photos…" : "Fill details from photos (AI)"}
                </button>
              ) : null}
            </div>

            {/* Fields */}
            <label className="block text-sm font-medium">Product name
              <input value={fields.name} onChange={(e) => set("name", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Manufacturer
                <input value={fields.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Distributor SKU
                <input value={fields.distributorSku} onChange={(e) => set("distributorSku", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Unit
                <UnitSelect value={fields.unitOfMeasure} onChange={(c) => set("unitOfMeasure", c)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface" />
              </label>
              <label className="block text-sm font-medium">Line of service
                <select value={fields.division} onChange={(e) => set("division", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {DIVISIONS.map((d) => <option key={d} value={d}>{divisionLabel(d)}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium">Description
              <textarea value={fields.description} onChange={(e) => set("description", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">How many do you have on hand now?
              <input type="number" min={0} inputMode="numeric" value={fields.onHandQty} onChange={(e) => set("onHandQty", e.target.value)}
                placeholder="0" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              <span className="mt-0.5 block text-[11px] text-muted">Posted as your branch&apos;s starting count when a super admin approves it.</span>
            </label>

            {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} disabled={busy} className={btn.secondary}>Cancel</button>
              <button onClick={submit} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Sending…" : "Send request"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
