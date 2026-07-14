"use client";

import { useState } from "react";
import { btn } from "@/components/ui";

export default function SignClient({ token, role, statement, defaultName }: { token: string; role: string; statement: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function sign() {
    if (!name.trim()) return setError("Type your full name to sign.");
    if (!agree) return setError("Please check the box to agree and sign.");
    setBusy(true); setError(null);
    const res = await fetch("/api/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, signerName: name, agree }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not sign.");
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
        <div className="text-emerald-700 text-lg font-semibold">✓ Signed</div>
        <p className="mt-1 text-sm text-emerald-800">Thank you, {name}. Your signature has been recorded and a copy filed with HR. You may close this page.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="text-sm font-medium text-slate-900 mb-1">Sign as {role}</div>
      <p className="text-xs text-slate-600 italic mb-3">&ldquo;{statement}&rdquo;</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
      <label className="mt-2 flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />I have read the statement above and I am signing electronically.</label>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button onClick={sign} disabled={busy} className={`${btn.primary} w-full mt-3`}>{busy ? "Signing…" : "E-sign"}</button>
    </div>
  );
}
