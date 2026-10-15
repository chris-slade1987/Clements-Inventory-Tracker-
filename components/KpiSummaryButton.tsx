"use client";

import { useState } from "react";

// On-demand AI KPI read-out. Fetches a grounded, scope-aware management summary
// (company or a single branch) and renders it inline. Degrades to a deterministic
// summary server-side when no Anthropic key is set. Brand-compliant: a thin line
// "spark" icon, never an emoji (docs/BRAND_KIT.md).
function Spark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
    </svg>
  );
}

export default function KpiSummaryButton({
  scope,
  p,
  basis = "month",
  label = "AI summary",
}: {
  scope: string;
  p?: string;
  basis?: "month" | "ytd";
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [text, setText] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setState("loading");
    setErr(null);
    try {
      const res = await fetch("/api/kpi/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, p, basis }),
      });
      const d = await res.json().catch(() => ({}));
      setState("done");
      if (!res.ok) {
        setErr(d.error ?? "Couldn't generate a summary.");
        return;
      }
      setText(d.text ?? "");
      setAi(!!d.ai);
    } catch {
      setState("done");
      setErr("Network error — try again.");
    }
  }

  return (
    <div className="mb-5">
      {text == null && !err ? (
        <button
          onClick={run}
          disabled={state === "loading"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          <Spark />
          {state === "loading" ? "Reading the numbers…" : label}
        </button>
      ) : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {text != null ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
            <Spark /> KPI summary
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{ai ? "AI" : "rule-based"}</span>
          </div>
          <p className="whitespace-pre-line text-sm text-ink">{text}</p>
        </div>
      ) : null}
    </div>
  );
}
