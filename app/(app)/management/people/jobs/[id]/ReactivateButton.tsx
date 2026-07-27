"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAGE_LABELS, PIPELINE_STAGE_FLOW } from "@/lib/ats-config";

// Inline "Reactivate" for the Excluded archive (HR/admin only). Returns the
// candidate to a chosen active stage, clearing the excluded stamps.
const STAGES = PIPELINE_STAGE_FLOW.filter((s) => s !== "pre_hire");

export default function ReactivateButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toStage, setToStage] = useState<string>("applied");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch("/api/hiring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "candidate.reactivate", id: candidateId, toStage }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed."); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Reactivate</button>;
  }
  return (
    <span className="shrink-0 flex items-center gap-1.5">
      <select value={toStage} onChange={(e) => setToStage(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-xs bg-white">
        {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
      </select>
      <button onClick={submit} disabled={busy} className="text-xs font-medium text-emerald-700 hover:underline">{busy ? "…" : "Go"}</button>
      <button onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">Cancel</button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
