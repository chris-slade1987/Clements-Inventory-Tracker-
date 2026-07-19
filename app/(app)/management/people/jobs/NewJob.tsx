"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { BRANCHES } from "@/lib/management";

const empty = { title: "", branch: "", openings: "1", hiringManagerName: "", description: "" };

export default function NewJob() {
  const router = useRouter();
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    if (!form.title.trim()) return setError("A job title is required.");
    setBusy(true); setError(null);
    const res = await fetch("/api/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "job.create", ...form, openings: Number(form.openings) || 1 }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not create the job.");
    setForm(null);
    if (data.id) router.push(`/management/people/jobs/${data.id}`);
    else router.refresh();
  }

  return (
    <>
      <button onClick={() => setForm({ ...empty })} className={btn.primary}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        New job
      </button>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">New job posting</h3>
            <label className="block text-sm font-medium">Job title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Pest Technician" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Branch
                <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Openings
                <input type="number" min={1} value={form.openings} onChange={(e) => setForm({ ...form, openings: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="block text-sm font-medium">Hiring manager
              <input value={form.hiringManagerName} onChange={(e) => setForm({ ...form, hiringManagerName: e.target.value })} placeholder="Optional" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Role summary, requirements…" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy || !form.title.trim()} className={`${btn.primary} flex-1`}>{busy ? "Creating…" : "Create job"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
