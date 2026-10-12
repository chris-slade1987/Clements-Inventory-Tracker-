"use client";

import { useState } from "react";

// On-demand AI insight over the lead heat map / lead-source board. Fetches a
// grounded insight (company-wide for the director, personal for the advisor) and
// renders it inline. Falls back to a deterministic insight server-side when no AI
// key is set. SVG line icons only — no emoji.
function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
    </svg>
  );
}

export default function SalesInsightButton({
  kind, scope, advisorEmployeeId, branch, range, from, to, label,
}: {
  kind: "heatmap" | "sources";
  scope: "team" | "advisor";
  advisorEmployeeId?: string;
  branch?: string | null;
  range: string;
  from?: string;
  to?: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [text, setText] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setState("loading"); setErr(null);
    try {
      const res = await fetch("/api/sales/insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, scope, advisorEmployeeId, branch, range, from, to }),
      });
      const d = await res.json().catch(() => ({}));
      setState("done");
      if (!res.ok) { setErr(d.error ?? "Couldn't generate an insight."); return; }
      setText(d.text ?? ""); setAi(!!d.ai);
    } catch {
      setState("done"); setErr("Network error — try again.");
    }
  }

  const defaultLabel = kind === "sources" ? "AI source insight" : "AI heat-map insight";

  return (
    <div className="mt-3">
      {text == null && !err ? (
        <button onClick={run} disabled={state === "loading"} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
          <SparkIcon className="h-4 w-4" />
          {state === "loading" ? "Thinking…" : (label ?? defaultLabel)}
        </button>
      ) : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {text != null ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
            <SparkIcon className="h-4 w-4 text-brand-700" />
            {kind === "sources" ? "Lead-source insight" : "Heat-map insight"}
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{ai ? "AI" : "rule-based"}</span>
          </div>
          <p className="whitespace-pre-line text-sm text-ink">{text}</p>
        </div>
      ) : null}
    </div>
  );
}
