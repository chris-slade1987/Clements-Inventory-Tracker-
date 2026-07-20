"use client";

import { useState } from "react";
import { btn } from "@/components/ui";

export default function HandbookAckClient({ token, version, defaultName }: { token: string; version: number; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!name.trim()) return setError("Type your full name to acknowledge.");
    if (!agree) return setError("Check the box to confirm you have read the handbook.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/documents/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, signedName: name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not record your acknowledgment.");
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
        <div className="text-emerald-700 text-lg font-semibold">✓ Acknowledged</div>
        <p className="mt-1 text-sm text-emerald-800">Thank you, {name}. Your acknowledgment of the Employee Handbook (v{version}) has been recorded and filed with HR. You may close this page.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="text-sm font-medium text-slate-900 mb-2">Acknowledge the Employee Handbook (v{version})</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Type your full name to sign"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
      />
      <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        I have read the Clements Pest Control Employee Handbook above and I acknowledge receipt of it.
      </label>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button onClick={submit} disabled={busy} className={`${btn.primary} w-full mt-3`}>
        {busy ? "Recording…" : "I have read & acknowledge"}
      </button>
    </div>
  );
}
