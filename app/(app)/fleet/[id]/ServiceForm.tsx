"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

const TYPES = [
  { key: "oil_change", label: "Oil change" },
  { key: "pm", label: "Preventive maintenance" },
  { key: "repair", label: "Repair" },
  { key: "tires", label: "Tires" },
  { key: "inspection", label: "Inspection" },
  { key: "other", label: "Other" },
];

const empty = { date: new Date().toISOString().slice(0, 10), type: "oil_change", description: "", cost: "", mileage: "", vendor: "", invoiceRef: "", nextDueDate: "", nextDueMileage: "" };

export default function ServiceForm({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/service", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setForm({ ...empty }); setOpen(false); router.refresh();
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button onClick={() => setOpen(true)} className={btn.primary}>+ Log service</button>
      </div>
    );
  }

  return (
    <Card className="p-4 mb-4 space-y-3">
      <div className="text-sm font-medium text-ink">Log a service / repair</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="block text-sm font-medium">Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
        <label className="block text-sm font-medium">Type
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <F label="Cost ($)" v={form.cost} on={(v) => setForm({ ...form, cost: v })} />
        <F label="Mileage" v={form.mileage} on={(v) => setForm({ ...form, mileage: v })} />
        <F label="Vendor" v={form.vendor} on={(v) => setForm({ ...form, vendor: v })} />
        <F label="Invoice #" v={form.invoiceRef} on={(v) => setForm({ ...form, invoiceRef: v })} />
      </div>
      <F label="Description" v={form.description} on={(v) => setForm({ ...form, description: v })} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Next due date
          <input type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
        <F label="Next due mileage" v={form.nextDueMileage} on={(v) => setForm({ ...form, nextDueMileage: v })} />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => { setOpen(false); setError(null); }} className={btn.secondary}>Cancel</button>
        <button onClick={save} disabled={busy || !form.cost} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save service"}</button>
      </div>
    </Card>
  );
}

function F({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
