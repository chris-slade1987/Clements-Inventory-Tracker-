"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import { BRANCHES } from "@/lib/management";

const empty = { name: "", email: "", phone: "", position: "", branch: "", targetStart: "" };

export default function NewPreHire() {
  const router = useRouter();
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setError("Candidate name is required.");
    if (!form.email.trim()) return setError("A personal email is required — it's where the magic link goes.");
    setBusy(true); setError(null);
    const res = await fetch("/api/prehire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not create pre-hire.");
    setForm(null);
    if (data.id) router.push(`/management/people/prehires/${data.id}`);
    else router.refresh();
  }

  return (
    <>
      <button onClick={() => setForm({ ...empty })} className={btn.primary}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" /></svg>
        New pre-hire
      </button>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Invite a candidate</h3>
            <p className="text-xs text-muted">They'll get a magic link by email to complete onboarding — no login required.</p>
            <F label="Candidate name" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <F label="Personal email" v={form.email} on={(v) => setForm({ ...form, email: v })} placeholder="name@gmail.com" />
              <F label="Phone" v={form.phone} on={(v) => setForm({ ...form, phone: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Position" v={form.position} on={(v) => setForm({ ...form, position: v })} placeholder="Pest Technician…" />
              <label className="block text-sm font-medium">Branch
                <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium">Target start date
              <DateInput className="mt-1" value={form.targetStart} onChange={(v) => setForm({ ...form, targetStart: v })} />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy || !form.name.trim() || !form.email.trim()} className={`${btn.primary} flex-1`}>{busy ? "Sending…" : "Create & send link"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function F({ label, v, on, placeholder }: { label: string; v: string; on: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
