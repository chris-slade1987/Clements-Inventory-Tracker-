"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Opt = { key: string; label: string };
type Disp = { disposition: string | null; dispositionDate: string | null; salePrice: number | null; dispositionNotes: string | null } | null;

export default function VehicleDisposition({ vehicleId, status, dispositions, current }: { vehicleId: string; status: string; dispositions: Opt[]; current: Disp }) {
  const router = useRouter();
  const active = status === "active";
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ disposition: "sold", dispositionDate: new Date().toISOString().slice(0, 10), salePrice: "", dispositionNotes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dispose() {
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/vehicle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dispose", id: vehicleId, ...f }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Failed.");
    setOpen(false); router.refresh();
  }
  async function reactivate() {
    if (!confirm("Return this vehicle to active service?")) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/vehicle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reactivate", id: vehicleId }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Failed."); }
    router.refresh();
  }

  if (!active) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">This vehicle is out of service — its full history is retained below.</span>
        <button onClick={reactivate} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline">Return to active service</button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        <button onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted hover:text-ink">Retire / mark sold</button>
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-3 ring-1 ring-amber-200">
      <div className="text-sm font-medium text-ink">Take vehicle out of service</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">Disposition
          <select value={f.disposition} onChange={(e) => setF({ ...f, disposition: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            {dispositions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Date
          <input type="date" value={f.dispositionDate} onChange={(e) => setF({ ...f, dispositionDate: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
        <label className="block text-sm font-medium">Sale price
          <input value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} placeholder="$ (if sold/traded)" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="block text-sm font-medium">Notes
        <textarea value={f.dispositionNotes} onChange={(e) => setF({ ...f, dispositionNotes: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Buyer, condition, reason for retirement…" />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => { setOpen(false); setError(null); }} className={btn.secondary}>Cancel</button>
        <button onClick={dispose} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Confirm"}</button>
      </div>
    </Card>
  );
}
