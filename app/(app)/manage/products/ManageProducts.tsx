"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { PRODUCT_CATEGORIES } from "@/lib/constants";

type Product = {
  id: string;
  name: string;
  manufacturer: string | null;
  epaRegNumber: string | null;
  unitOfMeasure: string;
  category: string | null;
  barcode: string | null;
  distributorSku: string | null;
  active: boolean;
};

const empty = {
  id: "",
  name: "",
  manufacturer: "",
  epaRegNumber: "",
  unitOfMeasure: "ea",
  category: "General Pest",
  barcode: "",
  distributorSku: "",
};

export default function ManageProducts({ products }: { products: Product[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const visible = products.filter((p) => showInactive || p.active);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const action = form.id ? "update" : "create";
    const res = await fetch("/api/manage/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setForm(null);
    router.refresh();
  }

  async function setActive(id: string, active: boolean) {
    await fetch("/api/manage/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setActive", id, active }),
    });
    router.refresh();
  }

  async function onImport(file: File) {
    setBusy(true);
    setNote(null);
    setError(null);
    const fd = new FormData();
    fd.append("type", "products");
    fd.append("file", file);
    const res = await fetch("/api/manage/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(data.error ?? "Import failed.");
    setNote(
      `Imported: ${data.created} added, ${data.updated} updated` +
        (data.skipped?.length ? `, ${data.skipped.length} skipped.` : ".")
    );
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setForm({ ...empty })} className={btn.primary}>
          + Add product
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn.secondary}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
        />
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <p className="text-xs text-muted mb-3">
        CSV columns: <code>name, manufacturer, epaRegNumber, unitOfMeasure, category, barcode, distributorSku</code>.
        Existing products (matched by name) are updated; unknown categories map to Other.
      </p>

      {note ? <p className="mb-3 text-sm text-brand-700">{note}</p> : null}
      {error && !form ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">EPA #</th>
                <th className="px-3 py-2 font-medium">Barcode</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className={`border-b border-line last:border-0 ${!p.active ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted">{p.manufacturer ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">{p.category ?? "—"}</td>
                  <td className="px-3 py-2">{p.unitOfMeasure}</td>
                  <td className="px-3 py-2 text-xs">{p.epaRegNumber ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.barcode ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() =>
                        setForm({
                          id: p.id,
                          name: p.name,
                          manufacturer: p.manufacturer ?? "",
                          epaRegNumber: p.epaRegNumber ?? "",
                          unitOfMeasure: p.unitOfMeasure,
                          category: p.category ?? "Other",
                          barcode: p.barcode ?? "",
                          distributorSku: p.distributorSku ?? "",
                        })
                      }
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                    <span className="text-line px-1">·</span>
                    {p.active ? (
                      <button onClick={() => setActive(p.id, false)} className="text-xs font-medium text-red-600 hover:underline">
                        Deactivate
                      </button>
                    ) : (
                      <button onClick={() => setActive(p.id, true)} className="text-xs font-medium text-brand-700 hover:underline">
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="surface-light w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">{form.id ? "Edit product" : "Add product"}</h3>
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <Field label="Unit" value={form.unitOfMeasure} onChange={(v) => setForm({ ...form, unitOfMeasure: v })} />
            </div>
            <Field label="Manufacturer" value={form.manufacturer} onChange={(v) => setForm({ ...form, manufacturer: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="EPA reg #" value={form.epaRegNumber} onChange={(v) => setForm({ ...form, epaRegNumber: v })} />
              <Field label="Barcode" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} />
            </div>
            <Field label="Distributor SKU" value={form.distributorSku} onChange={(v) => setForm({ ...form, distributorSku: v })} />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
