"use client";

import { useState } from "react";

const STATEMENT =
  "I acknowledge that I have received and reviewed this quarterly scorecard with my supervisor. My signature indicates receipt and discussion — not necessarily agreement — of the ratings and comments above.";

export default function ScorecardSignClient({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError("Type your full name to sign.");
    if (!ack) return setError("Confirm the acknowledgment to sign.");
    setBusy(true); setError(null);
    const res = await fetch("/api/scorecard-sign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, typedName: name, title }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "Could not sign.");
    setDone(true);
  }

  if (done)
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="font-semibold text-emerald-900">Signed — thank you.</div>
        <p className="mt-1 text-sm text-emerald-800">Your quarterly scorecard is now complete and on file. HR has been notified. You can close this window.</p>
      </div>
    );

  return (
    <div className="space-y-3">
      <p className="text-[13px] italic text-slate-600">&ldquo;{STATEMENT}&rdquo;</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full name to sign" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional — defaults to Branch Manager)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <label className="flex items-start gap-2 text-[13px] text-slate-800"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />I have read and agree to the statement above.</label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy ? "Signing…" : "Apply signature & complete"}
      </button>
    </div>
  );
}
