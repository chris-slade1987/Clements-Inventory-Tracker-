"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Card, EmptyState, btn } from "@/components/ui";
import { uomLabel } from "@/lib/uom";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

const PAGE_SIZE = 50;

type Product = {
  id: string;
  name: string;
  unit: string;
  distributorSku: string | null;
  category: string | null;
  onHand: number;
  counted: boolean;
};

export default function StockCountClient({
  isAdmin,
  branchId,
  branchName,
  warehouses,
  products,
}: {
  isAdmin: boolean;
  branchId: string;
  branchName: string;
  warehouses: { id: string; name: string }[];
  products: Product[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ counted: number; adjusted: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const pendingCount = Object.values(entries).filter((v) => v.trim() !== "" && Number.isFinite(Number(v))).length;
  const hasUnsaved = pendingCount > 0;

  // Warn before leaving (close/reload) with unsaved counts.
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsaved]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => [p.name, p.distributorSku, p.category].filter(Boolean).some((x) => x!.toLowerCase().includes(s)));
  }, [products, q]);

  const totalProducts = products.length;
  const neverCounted = products.filter((p) => !p.counted).length;
  const totalMatches = matches.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = matches.slice(pageStart, pageStart + PAGE_SIZE);
  const showingTo = Math.min(pageStart + PAGE_SIZE, totalMatches);

  function flash(msg: string) {
    setNote(msg);
    setTimeout(() => setNote(null), 3500);
  }

  function switchBranch(id: string) {
    if (hasUnsaved && !window.confirm(`You have ${pendingCount} unsaved count${pendingCount === 1 ? "" : "s"}. Switch branch and discard them?`)) return;
    router.push(`/inventory/stock-count?branch=${id}`);
  }

  // Scan-to-jump: resolve a barcode to a catalog product, then jump to its row
  // (clearing the search and paging to it) and focus its count field.
  async function handleDetected(code: string) {
    setScanning(false);
    try {
      const res = await fetch(`/api/inventory/barcode/${encodeURIComponent(code)}?branch=${encodeURIComponent(branchId)}`);
      if (res.status === 404) { flash("That barcode isn't linked to a product yet."); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.product) { flash("Lookup failed — search by name instead."); return; }
      jumpToProduct(data.product.id, data.product.name);
    } catch {
      flash("Network error during lookup.");
    }
  }

  function jumpToProduct(productId: string, name: string) {
    const idx = matches.findIndex((p) => p.id === productId);
    if (idx === -1) {
      // The current search hides it — clear the search and page to it in the full list.
      const fullIdx = products.findIndex((p) => p.id === productId);
      if (fullIdx === -1) { flash(`${name} isn't in this branch's catalog.`); return; }
      setQ("");
      setPage(Math.floor(fullIdx / PAGE_SIZE) + 1);
      setPendingFocus(productId);
      flash(`Jumped to ${name}`);
      return;
    }
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
    setPendingFocus(productId);
    flash(`Jumped to ${name}`);
  }

  // Focus a product's input once it's rendered on the visible page.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingFocus) return;
    const el = rowRefs.current[pendingFocus];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, visible]);

  async function submit() {
    const counts = Object.entries(entries)
      .map(([productId, v]) => ({ productId, counted: Math.trunc(Number(v)), raw: v }))
      .filter((c) => c.productId && v_ok(c.raw) && c.counted >= 0)
      .map(({ productId, counted }) => ({ productId, counted }));
    if (counts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/stock-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId: branchId, counts }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Could not save counts.");
        return;
      }
      setDone({ counted: data.counted ?? counts.length, adjusted: data.adjusted ?? 0 });
      setEntries({});
      router.refresh();
    } catch {
      setBusy(false);
      setError("Network error.");
    }
  }

  function v_ok(v: string | undefined) {
    return v != null && v.trim() !== "" && Number.isFinite(Number(v));
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        {isAdmin ? (
          <div>
            <label className="block text-xs font-medium mb-1">Branch</label>
            <select value={branchId} onChange={(e) => switchBranch(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium mb-1">Find product</label>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Product, SKU, category…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={() => setScanning(true)} className={btn.secondary} disabled={!branchId}>
          Scan to jump
        </button>
      </Card>

      {/* Count progress across the whole shelf — not just the visible page. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{totalProducts} product{totalProducts === 1 ? "" : "s"} in catalog</span>
        <span className={neverCounted > 0 ? "text-amber-600 font-medium" : ""}>{neverCounted} never counted at {branchName}</span>
        {hasUnsaved ? <span className="text-brand-700 font-medium">{pendingCount} unsaved</span> : null}
      </div>

      {note ? <p className="text-sm font-medium text-brand-700">{note}</p> : null}
      {done ? (
        <p className="text-sm font-medium text-brand-700">Saved {done.counted} count{done.counted === 1 ? "" : "s"} ({done.adjusted} with a change) at {branchName}.</p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {visible.length === 0 ? (
        <EmptyState title="No products" hint={q ? "No products match your search." : "No products to count."} />
      ) : (
        <div className="space-y-2">
          {visible.map((p) => (
            <Card key={p.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted">
                    Recorded {p.onHand} {uomLabel(p.unit)}
                    {p.counted ? "" : " · not yet counted"}
                  </div>
                </div>
                <input
                  ref={(el) => { rowRefs.current[p.id] = el; }}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="count"
                  value={entries[p.id] ?? ""}
                  onChange={(e) => setEntries((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  className="h-10 w-24 shrink-0 rounded-lg border border-line text-center text-sm"
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Showing X of Y + pagination — nothing is silently hidden. */}
      {totalMatches > 0 ? (
        <div className="flex flex-col items-center gap-2 text-sm">
          <div className="text-xs text-muted">
            Showing {pageStart + 1}–{showingTo} of {totalMatches}
            {totalMatches > PAGE_SIZE ? " — search to refine, or page through below" : ""}
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center gap-3">
              <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className={btn.secondary}>Prev</button>
              <span className="text-muted">Page {safePage} of {totalPages}</span>
              <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} className={btn.secondary}>Next</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="copilot-safe-actions sticky bottom-20 md:bottom-4">
        <button className={`${btn.primary} w-full`} onClick={submit} disabled={busy || pendingCount === 0 || !branchId}>
          {busy ? "Saving…" : `Save ${pendingCount || ""} count${pendingCount === 1 ? "" : "s"}`}
        </button>
      </div>

      {scanning ? (
        <BarcodeScanner
          onDetected={handleDetected}
          onClose={() => setScanning(false)}
          onSearchInstead={() => setScanning(false)}
          onPermissionDenied={() => { setScanning(false); flash("Camera unavailable — search by name instead."); }}
        />
      ) : null}
    </div>
  );
}
