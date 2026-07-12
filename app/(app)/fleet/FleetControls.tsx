"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

const BRANCHES = [
  { key: "vero", label: "Vero Beach" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
];

const empty = { name: "", unitNumber: "", year: "", make: "", model: "", vin: "", plate: "", branch: "", currentMileage: "", purchasePrice: "" };

export default function FleetControls() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setForm(null); router.refresh();
  }

  async function onImport(file: File) {
    setBusy(true); setNote(null); setError(null);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/fleet/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(data.error ?? "Import failed.");
    setNote(`Imported ${data.created} added, ${data.updated} updated${data.skipped?.length ? `, ${data.skipped.length} skipped` : ""}.`);
    router.refresh();
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setForm({ ...empty })} className={btn.primary}>+ Add vehicle</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn.secondary}>Import / reimport fleet sheet</button>
        <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        <span className="text-xs text-muted">Upload the Fleet Sheet Master (.xlsx) — reads the Vehicle Fleet + Vehicle Status tabs. Re-uploading updates existing vehicles (matched by VIN / unit #).</span>
      </div>
      {note ? <p className="mt-2 text-sm text-brand-200">{note}</p> : null}
      {error && !form ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Add vehicle</h3>
            <F label="Name (year make model)" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <F label="Unit #" v={form.unitNumber} on={(v) => setForm({ ...form, unitNumber: v })} />
              <label className="block text-sm font-medium">Branch
                <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Year" v={form.year} on={(v) => setForm({ ...form, year: v })} />
              <F label="Make" v={form.make} on={(v) => setForm({ ...form, make: v })} />
              <F label="Model" v={form.model} on={(v) => setForm({ ...form, model: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="VIN" v={form.vin} on={(v) => setForm({ ...form, vin: v })} />
              <F label="Plate" v={form.plate} on={(v) => setForm({ ...form, plate: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Current mileage" v={form.currentMileage} on={(v) => setForm({ ...form, currentMileage: v })} />
              <F label="Purchase price" v={form.purchasePrice} on={(v) => setForm({ ...form, purchasePrice: v })} />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy || !form.name} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function F({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
