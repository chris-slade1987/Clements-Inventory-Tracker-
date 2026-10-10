"use client";

import { useState } from "react";

type Item = { key: string; type: "choice" | "textarea" | "yesno"; label: string; options?: string[] };
type Section = { title: string; items: Item[] };

export default function ExitInterviewClient({ token, name, sections }: { token: string; name: string; sections: Section[] }) {
  const [resp, setResp] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch("/api/exit-interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, responses: resp }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Could not submit. Please try again.");
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Thank you</h2>
        <p className="mt-1 text-sm text-slate-600">Your exit interview has been submitted. We appreciate your feedback.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="text-lg font-semibold text-slate-900">Exit interview</h2>
      <p className="text-sm text-slate-500">Hi {name.split(" ")[0]} — thank you for taking a few minutes. Every field is optional; share whatever is helpful.</p>

      <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {sections.map((sec) => (
          <div key={sec.title} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{sec.title}</div>
            {sec.items.map((it) => (
              <Row key={it.key} it={it} value={resp[it.key] ?? ""} onChange={(v) => setResp((s) => ({ ...s, [it.key]: v }))} />
            ))}
          </div>
        ))}
      </div>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button onClick={submit} disabled={busy} className="mt-4 w-full rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Submitting…" : "Submit exit interview"}
      </button>
    </div>
  );
}

function Row({ it, value, onChange }: { it: Item; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-sm text-slate-800 mb-1">{it.label}</div>
      {it.type === "yesno" || it.type === "choice" ? (
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          {(it.type === "yesno" ? ["Yes", "No"] : it.options ?? []).map((opt) => (
            <button key={opt} type="button" onClick={() => onChange(opt)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${value === opt ? "bg-emerald-grad text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>{opt}</button>
          ))}
        </div>
      ) : (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      )}
    </div>
  );
}
