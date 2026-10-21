"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Product = {
  id: string;
  name: string;
  distributorSku: string | null;
  manufacturer: string | null;
  unit: string;
  approved: boolean;
  confirmed: boolean;
};
type Candidate = { productId: string; name: string; confidence: number; reason: string };
type PhotoRow = {
  id: string;
  productId: string | null;
  productName: string | null;
  photoUrl: string;
  status: string;
  primary: boolean;
  aiSuggestedName: string | null;
  aiConfidence: number | null;
  labelText: string | null;
  capturedByName: string | null;
  createdAt: string | Date;
};
type Review = { photoId: string; photoUrl: string; candidates: Candidate[]; labelText: string | null; ai: boolean; message?: string };

export default function PhotoCatalogClient({
  products,
  pending,
  assigned,
}: {
  products: Product[];
  pending: PhotoRow[];
  assigned: PhotoRow[];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null); // captured dataURL, not yet submitted
  const [review, setReview] = useState<Review | null>(null); // after AI reading, awaiting human assign
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function flash(m: string) { setNote(m); setTimeout(() => setNote(null), 3500); }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function onCapture(file: File) {
    setError(null);
    const dataUrl = await fileToDataUrl(file);
    setPreview(dataUrl); // show it; the human decides to submit or delete
  }

  // Human pressed "Submit for AI reading" — only now does anything leave the device.
  async function submitForReading() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "identify", image: preview, mime: "image/jpeg" }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setError(data.error ?? "Could not read the photo."); return; }
      setPreview(null);
      setReview({ photoId: data.photoId, photoUrl: data.photoUrl, candidates: data.candidates ?? [], labelText: data.labelText ?? null, ai: data.ai, message: data.message });
    } catch {
      setBusy(false);
      setError("Network error. Try again.");
    }
  }

  async function act(body: Record<string, unknown>, okMsg: string, after?: () => void) {
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
      after?.();
      router.refresh();
    } catch {
      setBusy(false);
      setError("Network error. Try again.");
    }
  }

  const assignReview = (productId: string) =>
    review && act({ action: "assign", photoId: review.photoId, productId }, "Photo assigned.", () => setReview(null));

  return (
    <div className="space-y-5 pb-6">
      {note ? <p className="text-sm font-medium text-brand-700">{note}</p> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {/* ── Capture → preview → submit ─────────────────────────────────── */}
      {!review ? (
        <Card className="p-4">
          {!preview ? (
            <>
              <label className={`${btn.primary} w-full cursor-pointer justify-center`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M3 7h3l2-2h8l2 2h3v12H3V7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" />
                </svg>
                Take a product photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onCapture(f); e.currentTarget.value = ""; }} />
              </label>
              <p className="mt-2 text-xs text-muted">Photograph the product label or barcode. You&apos;ll review the shot before anything is sent for reading.</p>
            </>
          ) : (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Captured product" className="mx-auto max-h-72 w-auto rounded-lg border border-line object-contain" />
              <p className="text-xs text-muted text-center">Clear and readable? Submit it for AI reading, or delete and retake.</p>
              <div className="grid grid-cols-2 gap-2">
                <button className={btn.secondary} onClick={() => setPreview(null)} disabled={busy}>Delete / retake</button>
                <button className={btn.primary} onClick={submitForReading} disabled={busy}>{busy ? "Reading…" : "Submit for AI reading"}</button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {/* ── Review the AI suggestion → human assigns / overrides / discards ── */}
      {review ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={review.photoUrl} alt="" className="h-24 w-24 shrink-0 rounded-lg border border-line object-cover" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">Which product is this?</div>
              {review.labelText ? <div className="mt-0.5 text-xs text-muted line-clamp-3">Label text: {review.labelText}</div> : null}
              {!review.ai && review.message ? <div className="mt-1 text-xs text-amber-700">{review.message}</div> : null}
            </div>
          </div>

          {review.candidates.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-muted mb-1">AI suggestions (tap to assign)</div>
              <ul className="divide-y divide-line rounded-lg border border-line overflow-hidden">
                {review.candidates.map((c) => (
                  <li key={c.productId}>
                    <button className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#eef5f0]" disabled={busy} onClick={() => assignReview(c.productId)}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block text-xs text-muted">{Math.round(c.confidence * 100)}% · {c.reason || "match"}</span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-brand-700">Assign</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <div className="text-xs font-medium text-muted mb-1">{review.candidates.length > 0 ? "Wrong match? Choose another product" : "Choose the product"}</div>
            <ProductPicker products={products} disabled={busy} onPick={(p) => assignReview(p.id)} />
          </div>

          <div className="flex items-center gap-2 border-t border-line pt-3">
            <button className="text-sm font-medium text-muted hover:text-red-600" disabled={busy} onClick={() => act({ action: "discard", photoId: review.photoId }, "Discarded — not a product.", () => setReview(null))}>
              Not a product — discard
            </button>
            <button className="ml-auto text-sm font-medium text-muted hover:text-ink" disabled={busy} onClick={() => act({ action: "delete", photoId: review.photoId }, "Photo deleted.", () => setReview(null))}>
              Delete photo
            </button>
          </div>
        </Card>
      ) : null}

      {/* ── Pending (submitted, awaiting a decision) ───────────────────── */}
      {pending.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Awaiting a match ({pending.length})</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pending.map((p) => (
              <GalleryCard key={p.id} photo={p} products={products} busy={busy} onAct={act} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Assigned catalog gallery (editable) ────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Catalog photos {assigned.length > 0 ? `(${assigned.length})` : ""}</h2>
        {assigned.length === 0 ? (
          <p className="text-sm text-muted">No photos assigned yet. Capture a product label above to start the catalog.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assigned.map((p) => (
              <GalleryCard key={p.id} photo={p} products={products} busy={busy} onAct={act} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// A gallery tile: the photo + which product it's on, with re-assign (correction)
// and delete. Pending (unassigned) tiles show the AI's guess and a picker to assign.
function GalleryCard({
  photo,
  products,
  busy,
  onAct,
}: {
  photo: PhotoRow;
  products: Product[];
  busy: boolean;
  onAct: (body: Record<string, unknown>, okMsg: string, after?: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Card className="p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.photoUrl} alt="" className="aspect-square w-full rounded-md border border-line object-cover" />
      <div className="mt-1.5 min-h-[2.2rem]">
        {photo.productName ? (
          <div className="text-xs font-medium text-ink line-clamp-2">{photo.productName}</div>
        ) : (
          <div className="text-xs text-amber-700">
            {photo.aiSuggestedName ? `AI: ${photo.aiSuggestedName}` : "No match yet"}
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-1">
          <ProductPicker products={products} disabled={busy} compact onPick={(p) => onAct({ action: "assign", photoId: photo.id, productId: p.id }, "Photo re-assigned.", () => setEditing(false))} />
          <button className="mt-1 w-full text-[11px] text-muted hover:text-ink" onClick={() => setEditing(false)}>cancel</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          <button className="font-medium text-brand-700 hover:underline" disabled={busy} onClick={() => setEditing(true)}>
            {photo.productName ? "Re-assign" : "Assign"}
          </button>
          <button className="ml-auto text-muted hover:text-red-600" disabled={busy} onClick={() => { if (window.confirm("Delete this photo?")) onAct({ action: "delete", photoId: photo.id }, "Photo deleted."); }}>
            Delete
          </button>
        </div>
      )}
    </Card>
  );
}

// Type-to-search product picker (the "choose other product" dropdown).
function ProductPicker({
  products,
  onPick,
  disabled,
  compact,
}: {
  products: Product[];
  onPick: (p: Product) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return products
      .filter((p) => [p.name, p.distributorSku, p.manufacturer].filter(Boolean).some((v) => v!.toLowerCase().includes(s)))
      .slice(0, 8);
  }, [q, products]);
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
        placeholder={compact ? "Search product…" : "Search the catalog by name or SKU…"}
        className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      {q.trim() && results.length > 0 ? (
        <ul className="surface-light mt-1 divide-y divide-line rounded-lg border border-line overflow-hidden">
          {results.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#eef5f0]" disabled={disabled} onClick={() => { setQ(""); onPick(p); }}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block text-[11px] text-muted">{p.distributorSku ?? p.manufacturer ?? ""}{p.approved && p.confirmed ? "" : " · not cataloged"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim() ? (
        <p className="mt-1 text-[11px] text-muted">No match. Try the name or SKU.</p>
      ) : null}
    </div>
  );
}
