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

export default function LogServiceClient({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ vehicleId: vehicles[0]?.id ?? "", date: new Date().toISOString().slice(0, 10), type: "oil_change", description: "", cost: "", mileage: "", vendor: "", invoiceRef: "", nextDueDate: "", nextDueMileage: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    const res = await fetch("/api/fleet/service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setMsg("Service logged.");
    setF({ ...f, description: "", cost: "", mileage: "", vendor: "", invoiceRef: "", nextDueDate: "", nextDueMileage: "" });
    router.refresh();
  }

  return (
    <Card className="p-4 space-y-3 max-w-2xl">
      <label className="block text-sm font-medium">Vehicle
        <select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="block text-sm font-medium">Date
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
        <label className="block text-sm font-medium">Type
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <F label="Cost ($)" v={f.cost} on={(v) => setF({ ...f, cost: v })} />
        <F label="Mileage" v={f.mileage} on={(v) => setF({ ...f, mileage: v })} />
        <F label="Vendor" v={f.vendor} on={(v) => setF({ ...f, vendor: v })} />
        <F label="Invoice #" v={f.invoiceRef} on={(v) => setF({ ...f, invoiceRef: v })} />
      </div>
      <F label="Description" v={f.description} on={(v) => setF({ ...f, description: v })} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Next due date
          <input type="date" value={f.nextDueDate} onChange={(e) => setF({ ...f, nextDueDate: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
        <F label="Next due mileage" v={f.nextDueMileage} on={(v) => setF({ ...f, nextDueMileage: v })} />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {msg ? <p className="text-sm text-brand-700">{msg}</p> : null}
      <button onClick={save} disabled={busy || !f.vehicleId || !f.cost} className={`${btn.primary} w-full`}>{busy ? "Saving…" : "Log service"}</button>
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
