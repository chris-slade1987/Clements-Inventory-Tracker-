"use client";

import { useState } from "react";

// The AI-coach sparkle — a COO-sanctioned sales-motivation emoji (docs/BRAND_KIT.md
// §1): the ✨ signals the AI coach / team briefing in the sales module.
const Spark = ({ className = "text-base leading-none" }: { className?: string }) => (
  <span className={className} role="img" aria-label="AI">✨</span>
);

// On-demand AI coaching. Fetches a grounded coaching note (advisor) or team
// briefing (director) and renders it inline. Falls back to the deterministic
// diagnosis text server-side when no AI key is set.
export default function SalesCoachButton({
  scope, advisorEmployeeId, periodKey, label = "AI coaching insight",
}: {
  scope: "advisor" | "team"; advisorEmployeeId?: string; periodKey: string; label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [text, setText] = useState<string | null>(null);
  const [proj, setProj] = useState<number | null>(null);
  const [ai, setAi] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setState("loading"); setErr(null);
    try {
      const res = await fetch("/api/sales/coach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, advisorEmployeeId, periodKey }),
      });
      const d = await res.json().catch(() => ({}));
      setState("done");
      if (!res.ok) { setErr(d.error ?? "Couldn't generate an insight."); return; }
      setText(d.text ?? ""); setProj(typeof d.projection === "number" ? d.projection : null); setAi(!!d.ai);
    } catch {
      setState("done"); setErr("Network error — try again.");
    }
  }

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  return (
    <div className="mt-3">
      {text == null && !err ? (
        <button onClick={run} disabled={state === "loading"} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
          <Spark /> {state === "loading" ? "Thinking…" : label}
        </button>
      ) : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {text != null ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
            <Spark /> {scope === "team" ? "Team briefing" : "AI coach"}
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{ai ? "AI" : "rule-based"}</span>
          </div>
          <p className="whitespace-pre-line text-sm text-ink">{text}</p>
          {proj != null ? <div className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs text-muted">Projected month-end at this pace: <b className="text-ink">{money(proj)}</b></div> : null}
        </div>
      ) : null}
    </div>
  );
}
