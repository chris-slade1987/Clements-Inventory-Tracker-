"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

const empty = { name: "", email: "", phone: "", source: "", notes: "" };

export default function NewCandidate({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [form, setForm] = useState<typeof empty | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setError("Candidate name is required.");
    if (!form.email.trim()) return setError("A candidate email is required.");
    setBusy(true); setError(null);

    let res: Response;
    if (resume) {
      const fd = new FormData();
      fd.set("action", "candidate.create");
      fd.set("jobId", jobId);
      fd.set("name", form.name);
      fd.set("email", form.email);
      fd.set("phone", form.phone);
      fd.set("source", form.source);
      fd.set("notes", form.notes);
      fd.set("resume", resume);
      res = await fetch("/api/ats", { method: "POST", body: fd });
    } else {
      res = await fetch("/api/ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "candidate.create", jobId, ...form }),
      });
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not add the candidate.");
    setForm(null); setResume(null);
    if (data.id) router.push(`/management/people/candidates/${data.id}`);
    else router.refresh();
  }

  return (
    <>
      <button onClick={() => setForm({ ...empty })} className={btn.primary}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" /></svg>
        Add candidate
      </button>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Add a candidate</h3>
            <label className="block text-sm font-medium">Full name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Email
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Phone
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="block text-sm font-medium">Source
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Indeed, referral, walk-in…" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Résumé (optional)
              <input type="file" onChange={(e) => setResume(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700" />
            </label>
            <label className="block text-sm font-medium">Notes
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setResume(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy || !form.name.trim() || !form.email.trim()} className={`${btn.primary} flex-1`}>{busy ? "Adding…" : "Add candidate"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
