"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, btn, UnitSelect } from "@/components/ui";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import { UNITS_OF_MEASURE, uomLabel } from "@/lib/uom";

type Product = {
  id: string;
  name: string;
  manufacturer: string | null;
  epaRegNumber: string | null;
  unitOfMeasure: string;
  category: string | null;
  activeIngredient: string | null;
  targetPest: string | null;
  applicationMethod: string | null;
  barcode: string | null;
  distributorSku: string | null;
  active: boolean;
  approved: boolean;
  notes: string | null;
};

const empty = {
  id: "",
  name: "",
  manufacturer: "",
  epaRegNumber: "",
  unitOfMeasure: "EA",
  category: "Insecticide/Pesticide",
  activeIngredient: "",
  targetPest: "",
  applicationMethod: "",
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

  // Filters
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [mfrFilter, setMfrFilter] = useState("");

  const manufacturers = Array.from(
    new Set(products.map((p) => p.manufacturer?.trim()).filter((m): m is string => !!m))
  ).sort((a, b) => a.localeCompare(b));

  const needle = q.trim().toLowerCase();
  const visible = products.filter((p) => {
    if (!showInactive && !p.active) return false;
    if (catFilter && (p.category ?? "") !== catFilter) return false;
    if (mfrFilter && (p.manufacturer ?? "") !== mfrFilter) return false;
    if (needle) {
      const hay = [p.name, p.manufacturer, p.activeIngredient, p.epaRegNumber, p.distributorSku, p.barcode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const filtered = catFilter || mfrFilter || needle;

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
        CSV columns: <code>name, category, manufacturer, epaRegNumber, activeIngredient, targetPest, unitOfMeasure, distributorSku</code>.
        Existing products (matched by name) are updated; a blank category is auto-classified.
      </p>

      {note ? <p className="mb-3 text-sm text-brand-200">{note}</p> : null}
      {error && !form ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, ingredient, EPA #, SKU…"
          className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm text-ink"
        />
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm bg-surface"
        >
          <option value="">All categories</option>
          {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={mfrFilter}
          onChange={(e) => setMfrFilter(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm bg-surface"
        >
          <option value="">All manufacturers</option>
          {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {filtered ? (
          <button
            onClick={() => { setQ(""); setCatFilter(""); setMfrFilter(""); }}
            className="text-xs font-medium text-brand-200 hover:underline"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-xs text-muted">
          {visible.length} of {products.filter((p) => showInactive || p.active).length} shown
        </span>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Active ingredient</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">Approved</th>
                <th className="px-3 py-2 font-medium">EPA #</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className={`border-b border-line last:border-0 ${!p.active ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/manage/products/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                    <div className="text-xs text-muted">{p.manufacturer ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">{p.category ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.activeIngredient ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span title={p.unitOfMeasure}>{uomLabel(p.unitOfMeasure)}</span>
                    <span className="text-muted"> ({p.unitOfMeasure})</span>
                  </td>
                  <td className="px-3 py-2">
                    {p.approved ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">Approved</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Off-catalog</span>
                    )}
                    {p.notes ? <div className="mt-0.5 text-[10px] text-muted">{p.notes}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{p.epaRegNumber ?? "—"}</td>
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
                          activeIngredient: p.activeIngredient ?? "",
                          targetPest: p.targetPest ?? "",
                          applicationMethod: p.applicationMethod ?? "",
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

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-brand-700">
          Units of measure reference ({UNITS_OF_MEASURE.length} codes)
        </summary>
        <Card className="mt-2 p-3">
          <p className="mb-2 text-xs text-muted">
            The controlled list used by every unit dropdown (check-in, check-out, product admin). Units are always chosen from these codes — never typed.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {UNITS_OF_MEASURE.map((u) => (
              <div key={u.code} className="flex justify-between gap-2">
                <span className="text-muted">{u.label}</span>
                <span className="font-mono font-medium">{u.code}</span>
              </div>
            ))}
          </div>
        </Card>
      </details>

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
              <label className="block text-sm font-medium">Unit
                <UnitSelect
                  value={form.unitOfMeasure}
                  onChange={(code) => setForm({ ...form, unitOfMeasure: code })}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
                />
              </label>
            </div>
            <Field label="Manufacturer" value={form.manufacturer} onChange={(v) => setForm({ ...form, manufacturer: v })} />
            <Field label="Active ingredient" value={form.activeIngredient} onChange={(v) => setForm({ ...form, activeIngredient: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="EPA reg #" value={form.epaRegNumber} onChange={(v) => setForm({ ...form, epaRegNumber: v })} />
              <Field label="Target pest" value={form.targetPest} onChange={(v) => setForm({ ...form, targetPest: v })} />
            </div>
            <Field label="Application method" value={form.applicationMethod} onChange={(v) => setForm({ ...form, applicationMethod: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Barcode" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} />
              <Field label="Distributor SKU" value={form.distributorSku} onChange={(v) => setForm({ ...form, distributorSku: v })} />
            </div>
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
