"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Result = {
  ok: boolean;
  statementNumber: string;
  period: string;
  total: number;
  purchases: number;
  linked: number;
  account: number;
  unlinked: number;
  created: number;
  updated: number;
  unlinkedSamples: string[];
};

/**
 * Upload a Coast fuel statement (.xlsx). Reused on the Fuel page and in the
 * Document Center. `variant="card"` renders a full drop card; `variant="inline"`
 * renders a compact button + result line.
 */
export default function FuelStatementUpload({ variant = "card" }: { variant?: "card" | "inline" }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/fleet/fuel/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Upload failed.");
      else {
        setResult(data);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = "";
  }

  const resultBlock = result ? (
    <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-800">
      <div className="font-medium">Imported {result.statementNumber ? `statement ${result.statementNumber}` : "statement"} · {result.period}</div>
      <div className="mt-0.5 text-brand-700">
        {result.purchases} purchases — <span className="font-medium">{result.linked} linked</span> to vehicles
        {result.account > 0 ? `, ${result.account} account-level` : ""}
        {result.unlinked > 0 ? `, ${result.unlinked} unlinked` : ""}.
        {" "}
        {result.created > 0 ? `${result.created} new` : ""}{result.created > 0 && result.updated > 0 ? ", " : ""}{result.updated > 0 ? `${result.updated} already on file` : ""}.
      </div>
      {result.unlinked > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-amber-700">
          {result.unlinkedSamples.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      ) : null}
    </div>
  ) : null;

  const errorBlock = error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null;

  if (variant === "inline") {
    return (
      <div className="space-y-2">
        <input ref={inputRef} type="file" accept=".xlsx" onChange={onPick} className="hidden" />
        <button onClick={() => inputRef.current?.click()} disabled={busy} className={btn.secondary}>
          {busy ? "Reading…" : "Upload Coast statement"}
        </button>
        {busy && fileName ? <p className="text-xs text-muted">Reading {fileName}…</p> : null}
        {errorBlock}
        {resultBlock}
      </div>
    );
  }

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">Upload a Coast statement</div>
          <p className="text-xs text-muted mt-0.5">Drop next month&rsquo;s Coast .xlsx here — we&rsquo;ll link every purchase to a vehicle automatically.</p>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx" onChange={onPick} className="hidden" />
        <button onClick={() => inputRef.current?.click()} disabled={busy} className={btn.primary}>
          {busy ? "Reading…" : "Choose file"}
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {busy && fileName ? <p className="text-xs text-muted">Reading {fileName}…</p> : null}
        {errorBlock}
        {resultBlock}
      </div>
    </Card>
  );
}
