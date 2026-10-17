"use client";

import { useState } from "react";

export default function RowActions({ employeeId }: { employeeId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy("link");
    setError(null); setMsg(null);
    const res = await fetch("/api/documents/ack-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not generate link.");
    setUrl(data.url);
  }

  async function emailReminder() {
    setBusy("email");
    setError(null); setMsg(null);
    const res = await fetch("/api/documents/ack-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, action: "email" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not send reminder.");
    setMsg(data.mode === "inapp" ? "Nudged in their Inbox." : "Reminder emailed.");
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed — select and copy the link manually.");
    }
  }

  if (url) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="w-56 max-w-full rounded border border-line px-2 py-1 text-xs text-slate-700 bg-surface" />
        <button onClick={copy} className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-brand-50">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={emailReminder} disabled={!!busy} className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-brand-50 disabled:opacity-50">
          {busy === "email" ? "Sending…" : "Email reminder"}
        </button>
        <button onClick={generate} disabled={!!busy} className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-brand-50 disabled:opacity-50">
          {busy === "link" ? "Generating…" : "Copy link"}
        </button>
      </div>
      {msg ? <p className="mt-1 text-xs text-emerald-700">{msg}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
