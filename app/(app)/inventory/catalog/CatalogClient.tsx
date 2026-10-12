"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, btn, UnitSelect } from "@/components/ui";

type Barcode = { id: string; code: string; symbology: string | null };
type Product = {
  id: string;
  name: string;
  manufacturer: string | null;
  epaRegNumber: string | null;
  category: string | null;
  activeIngredient: string | null;
  targetPest: string | null;
  applicationMethod: string | null;
  legacyBarcode: string | null;
  distributorSku: string | null;
  unit: string;
  approved: boolean;
  confirmed: boolean;
  barcodes: Barcode[];
};

type ImportReport = {
  distinctItems: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedSurcharge: number;
  skippedCredit: number;
  applied: boolean;
  rows: { itemNumber: string; name: string; action: string; changes?: string[] }[];
};

export default function CatalogClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? products.filter((p) => [p.name, p.distributorSku, p.manufacturer, p.category, ...p.barcodes.map((b) => b.code)].filter(Boolean).some((x) => x!.toLowerCase().includes(s)))
      : products;
    return list.slice(0, 100);
  }, [products, q]);

  async function runImport(apply: boolean) {
    setImportBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/catalog-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json().catch(() => ({}));
      setImportBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Import failed.");
        return;
      }
      setImportReport(data.report as ImportReport);
      if (apply) router.refresh();
    } catch {
      setImportBusy(false);
      setError("Network error during import.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Import CSV */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium text-sm">Import catalog CSV</div>
            <div className="text-xs text-muted">Add/update products from the committed SiteOne line-item files. Idempotent.</div>
          </div>
          <div className="flex gap-2">
            <button className={btn.secondary} onClick={() => runImport(false)} disabled={importBusy}>{importBusy ? "…" : "Preview"}</button>
            <button className={btn.primary} onClick={() => runImport(true)} disabled={importBusy}>Import</button>
          </div>
        </div>
        {importReport ? (
          <div className="mt-3 rounded-lg border border-line bg-[#f6faf7] p-3 text-sm">
            <div className="font-medium">
              {importReport.applied ? "Imported" : "Preview"}: {importReport.created} created · {importReport.updated} updated · {importReport.unchanged} unchanged
            </div>
            <div className="text-xs text-muted mt-1">
              {importReport.distinctItems} distinct items · skipped {importReport.skippedSurcharge} surcharge + {importReport.skippedCredit} credit line(s)
            </div>
            {importReport.rows.filter((r) => r.action !== "unchanged").length > 0 ? (
              <ul className="mt-2 max-h-48 overflow-y-auto text-xs text-muted space-y-0.5">
                {importReport.rows.filter((r) => r.action !== "unchanged").slice(0, 100).map((r, i) => (
                  <li key={i}>{r.action} · {r.itemNumber} · {r.name}{r.changes ? ` [${r.changes.join(", ")}]` : ""}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, SKU, barcode…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {filtered.length === 0 ? (
        <EmptyState title="No products" hint="Adjust your search." />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              open={open === p.id}
              onToggle={() => setOpen(open === p.id ? null : p.id)}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  open,
  onToggle,
  busy,
  setBusy,
  setError,
  onChanged,
}: {
  product: Product;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.distributorSku ?? "");
  const [unit, setUnit] = useState(product.unit);
  const [category, setCategory] = useState(product.category ?? "");
  const [newCode, setNewCode] = useState("");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manage/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: product.id,
          name,
          unitOfMeasure: unit,
          manufacturer: product.manufacturer,
          epaRegNumber: product.epaRegNumber,
          category: category || null,
          activeIngredient: product.activeIngredient,
          targetPest: product.targetPest,
          applicationMethod: product.applicationMethod,
          barcode: product.legacyBarcode,
          distributorSku: sku || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      onChanged();
    } catch {
      setBusy(false);
      setError("Network error.");
    }
  }

  async function linkCode() {
    const code = newCode.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/barcode/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, productId: product.id }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok && !data.sameProduct) {
        setError(data.error ?? (data.alreadyLinked ? `Already linked to ${data.linkedTo?.name ?? "another product"}.` : "Could not link."));
        return;
      }
      setNewCode("");
      onChanged();
    } catch {
      setBusy(false);
      setError("Network error.");
    }
  }

  async function unlink(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/barcode/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Could not unlink.");
        return;
      }
      onChanged();
    } catch {
      setBusy(false);
      setError("Network error.");
    }
  }

  return (
    <Card className="p-3">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={onToggle}>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{product.name}</span>
          <span className="block text-xs text-muted">
            {product.distributorSku ? `SKU ${product.distributorSku} · ` : ""}{product.barcodes.length} barcode{product.barcodes.length === 1 ? "" : "s"}
            {product.approved ? "" : " · off-catalog"}{product.confirmed ? "" : " · unconfirmed"}
          </span>
        </span>
        <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Distributor SKU</label>
              <input value={sku} onChange={(e) => setSku(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Unit</label>
              <UnitSelect value={unit} onChange={setUnit} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </div>
          </div>
          <button className={btn.primary} onClick={save} disabled={busy}>Save fields</button>

          <div>
            <div className="text-xs font-medium mb-1">Barcodes</div>
            {product.legacyBarcode ? (
              <div className="text-xs text-muted mb-1">Legacy: <span className="font-mono">{product.legacyBarcode}</span></div>
            ) : null}
            {product.barcodes.length === 0 ? (
              <p className="text-xs text-muted">No linked barcodes.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {product.barcodes.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-mono truncate">{b.code}{b.symbology ? ` · ${b.symbology}` : ""}</span>
                    <button className="text-muted hover:text-red-600 text-xs font-medium" onClick={() => unlink(b.id)} disabled={busy}>Unlink</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="New barcode…" className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-mono" />
              <button className={btn.secondary} onClick={linkCode} disabled={busy || !newCode.trim()}>Link</button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
