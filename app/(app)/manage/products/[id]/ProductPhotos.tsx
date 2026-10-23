"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { fileToJpegDataUrl } from "@/lib/client-image";

export type PhotoTile = { id: string; photoUrl: string; kind: string; primary: boolean };

const MAX = 3;
const KINDS = [
  { value: "product", label: "Product" },
  { value: "label", label: "Label" },
  { value: "barcode", label: "Barcode" },
  { value: "other", label: "Other" },
];

// Super-admin photo manager for the product Edit window (Part 2). Take a photo
// with the device camera or upload one (≤3 per product); the AI auto-tags each as
// product / label / barcode, with a manual override. Reference photos feed
// check-out identify, so a good shot here makes the shelf scan smarter.
export default function ProductPhotos({ productId, photos }: { productId: string; photos: PhotoTile[] }) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const full = photos.length >= MAX;

  function flash(m: string) { setNote(m); setTimeout(() => setNote(null), 3000); }

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setError(data.error ?? "Action failed."); return; }
      flash(okMsg);
      router.refresh();
    } catch {
      setBusy(false);
      setError("Network error. Try again.");
    }
  }

  async function onAdd(file: File) {
    if (full) { setError(`A product can have at most ${MAX} photos.`); return; }
    setBusy(true);
    setError(null);
    const image = await fileToJpegDataUrl(file);
    await post({ action: "add", productId, image, mime: "image/jpeg" }, "Photo added.");
  }

  async function onReplace(file: File) {
    if (!replaceId) return;
    setBusy(true);
    setError(null);
    const image = await fileToJpegDataUrl(file);
    const id = replaceId;
    setReplaceId(null);
    await post({ action: "replace", photoId: id, image, mime: "image/jpeg" }, "Photo replaced.");
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink">Reference photos</div>
          <div className="text-xs text-muted">Up to {MAX}. These feed check-out identify so shelf scans match this product.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || full} className={btn.secondary}>
            Take photo
          </button>
          <button type="button" onClick={() => uploadRef.current?.click()} disabled={busy || full} className={btn.primary}>
            Upload image
          </button>
        </div>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAdd(f); e.currentTarget.value = ""; }} />
      <input ref={uploadRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAdd(f); e.currentTarget.value = ""; }} />
      <input ref={replaceRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(f); e.currentTarget.value = ""; }} />

      {full ? <p className="mb-2 text-xs text-muted">Maximum of {MAX} photos reached — replace or delete one to add another.</p> : null}
      {note ? <p className="mb-2 text-sm text-brand-700">{note}</p> : null}
      {error ? <p className="mb-2 text-sm text-red-600" role="alert">{error}</p> : null}

      {photos.length === 0 ? (
        <p className="text-sm text-muted">No photos yet. Add one so check-out can recognize this product by sight.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <div key={p.id} className="rounded-lg border border-line p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photoUrl} alt="" className="h-32 w-full rounded-md border border-line object-cover" />
                {p.primary ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-semibold text-white">Primary</span>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[11px] text-muted">Tag</label>
                <select
                  value={KINDS.some((k) => k.value === p.kind) ? p.kind : "other"}
                  disabled={busy}
                  onChange={(e) => post({ action: "setKind", photoId: p.id, kind: e.target.value }, "Tag updated.")}
                  className="flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                >
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {!p.primary ? (
                  <button type="button" disabled={busy} onClick={() => post({ action: "setPrimary", photoId: p.id }, "Primary set.")} className="font-medium text-brand-700 hover:underline">
                    Make primary
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={() => { setReplaceId(p.id); replaceRef.current?.click(); }} className="font-medium text-brand-700 hover:underline">
                  Replace
                </button>
                <button type="button" disabled={busy} onClick={() => post({ action: "delete", photoId: p.id }, "Photo deleted.")} className="font-medium text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
