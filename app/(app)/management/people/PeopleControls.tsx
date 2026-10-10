"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

const BRANCHES = [
  { key: "vero", label: "Vero Beach" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const empty = { name: "", email: "", personalEmail: "", phone: "", personalPhone: "", role: "", division: "", branch: "", title: "", birthMonth: "", birthDay: "", hireDate: "" };

export default function PeopleControls({ defaultBranch }: { defaultBranch: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setError("Name is required.");
    setBusy(true); setError(null);
    const res = await fetch("/api/personnel/lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not add employee.");
    setForm(null);
    if (data.id) router.push(`/management/people/${data.id}`);
    else router.refresh();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button onClick={() => setForm({ ...empty, branch: defaultBranch ?? "" })} className={btn.primary}>+ Add employee</button>
      <span className="text-xs text-muted">Creates a personnel profile. Terminate / offboarding is handled on each profile.</span>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Add employee</h3>
            <F label="Full name" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <F label="Work email" v={form.email} on={(v) => setForm({ ...form, email: v })} />
              <F label="Personal email" v={form.personalEmail} on={(v) => setForm({ ...form, personalEmail: v })} placeholder="name@gmail.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Work phone" v={form.phone} on={(v) => setForm({ ...form, phone: v })} />
              <F label="Personal phone" v={form.personalPhone} on={(v) => setForm({ ...form, personalPhone: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Role" v={form.role} on={(v) => setForm({ ...form, role: v })} placeholder="Technician, CSR, Sales…" />
              <F label="Division" v={form.division} on={(v) => setForm({ ...form, division: v })} placeholder="Service, Lawn…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Branch
                <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Hire date
                <DateInput className="mt-1" value={form.hireDate} onChange={(v) => setForm({ ...form, hireDate: v })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Birthday
                <span className="mt-1 flex gap-2">
                  <select value={form.birthMonth} onChange={(e) => setForm({ ...form, birthMonth: e.target.value })} className="flex-1 rounded-lg border border-line px-2 py-2 text-sm bg-surface">
                    <option value="">Month</option>
                    {MONTH_ABBR.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                  </select>
                  <input type="number" min={1} max={31} value={form.birthDay} onChange={(e) => setForm({ ...form, birthDay: e.target.value })} placeholder="Day" className="w-20 rounded-lg border border-line px-2 py-2 text-sm" />
                </span>
              </label>
            </div>
            <p className="text-[11px] text-muted">Hire date schedules the 30 & 60-day new-hire reviews automatically. Birthday (month &amp; day, no year) feeds the company birthday calendar — leave blank if unknown.</p>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy || !form.name.trim()} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Add employee"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function F({ label, v, on, placeholder }: { label: string; v: string; on: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
