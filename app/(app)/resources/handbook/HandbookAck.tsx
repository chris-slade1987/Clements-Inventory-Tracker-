"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

export default function HandbookAck({
  slug,
  version,
  acknowledgedVersion,
  acknowledgedAt,
  defaultName,
}: {
  slug: string;
  version: number;
  acknowledgedVersion: number | null;
  acknowledgedAt: string | null;
  defaultName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = acknowledgedVersion === version;

  async function submit() {
    if (!name.trim()) return setError("Type your full name to acknowledge.");
    if (!agree) return setError("Check the box to confirm you have read the handbook.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/documents/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, signedName: name, source: "in_app" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not record your acknowledgment.");
    router.refresh();
  }

  if (current) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-emerald-800">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          <span className="font-semibold">You acknowledged v{version}{acknowledgedAt ? ` on ${new Date(acknowledgedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}` : ""}.</span>
        </div>
        <p className="mt-1 text-sm text-emerald-700">Thank you. Your acknowledgment is on file with HR. No further action is needed unless a new version is published.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="font-semibold text-amber-900">
        {acknowledgedVersion ? `Please re-acknowledge — you last acknowledged v${acknowledgedVersion}; the current version is v${version}.` : "Acknowledgment required"}
      </div>
      <p className="mt-1 text-sm text-amber-800">Read the handbook below, then type your full name to acknowledge that you have read and received it.</p>
      <div className="mt-3 grid gap-2 sm:max-w-md">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your full name to sign"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 bg-white"
        />
        <label className="flex items-start gap-2 text-xs text-amber-900">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4" />
          I have read the Clements Pest Control Employee Handbook (v{version}) and I acknowledge receipt of it.
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button onClick={submit} disabled={busy} className={`${btn.primary} w-full sm:w-auto`}>
          {busy ? "Recording…" : "I have read & acknowledge"}
        </button>
      </div>
    </div>
  );
}
