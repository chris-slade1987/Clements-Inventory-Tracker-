"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

const BRANCHES = [
  { key: "vero", label: "Vero Beach" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
];

export type VehicleEdit = {
  id: string;
  name: string;
  unitNumber: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  plate: string;
  branch: string;
  currentMileage: string;
  purchasePrice: string;
  loanBank: string;
  loanNumber: string;
  monthlyPayment: string;
  loanBalance: string;
  payoffDate: string;
  status: string;
};

// Full edit form for an existing vehicle — including the **branch**, so a vehicle
// can be moved between offices after it's created (previously only possible on
// create or by re-importing the fleet sheet). The driver is NOT edited here; it's
// managed by the Assigned-driver control so the name + employee link stay in sync.
export default function EditVehicle({ vehicle }: { vehicle: VehicleEdit }) {
  const router = useRouter();
  const [form, setForm] = useState<VehicleEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setError("Vehicle name is required.");
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setForm(null);
    router.refresh();
  }

  return (
    <>
      <button onClick={() => { setForm(vehicle); setError(null); }} className="text-xs font-medium text-brand-700 hover:underline">Edit vehicle</button>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Edit vehicle</h3>
            <F label="Name (year make model)" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <F label="Unit #" v={form.unitNumber} on={(v) => setForm({ ...form, unitNumber: v })} />
              <label className="block text-sm font-medium">Branch
                <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">— Unassigned —</option>
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
            <div className="border-t border-line pt-3 text-xs font-medium uppercase tracking-wide text-muted">Loan (optional)</div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Loan bank" v={form.loanBank} on={(v) => setForm({ ...form, loanBank: v })} />
              <F label="Loan number" v={form.loanNumber} on={(v) => setForm({ ...form, loanNumber: v })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Monthly payment" v={form.monthlyPayment} on={(v) => setForm({ ...form, monthlyPayment: v })} />
              <F label="Loan balance" v={form.loanBalance} on={(v) => setForm({ ...form, loanBalance: v })} />
              <label className="block text-sm font-medium">Payoff date
                <input type="date" value={form.payoffDate} onChange={(e) => setForm({ ...form, payoffDate: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            </div>
            <p className="text-[11px] text-muted">The driver is set with the “Assigned driver” control, not here. Retiring / reactivating is handled by the disposition control.</p>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy || !form.name.trim()} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function F({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
