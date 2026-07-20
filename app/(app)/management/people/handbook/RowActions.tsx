"use client";

import { useState } from "react";

export default function RowActions({ employeeId }: { employeeId: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/documents/ack-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not generate link.");
    setUrl(data.url);
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
      <button onClick={generate} disabled={busy} className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-brand-50 disabled:opacity-50">
        {busy ? "Generating…" : "Generate link"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
