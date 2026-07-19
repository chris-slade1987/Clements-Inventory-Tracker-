"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import {
  RECOMMENDATION_ORDER,
  RECOMMENDATION_LABELS,
  BASICS_OPTIONS,
  BASICS_LABELS,
  validateScorecard,
  type InterviewTemplate,
  type ScorecardResponses,
} from "@/lib/ats-config";

export default function ScorecardForm({
  interviewId,
  template,
  initialResponses,
  initialOverall,
  initialRecommendation,
  initialSummary,
  readOnly,
  canReopen,
}: {
  interviewId: string;
  template: InterviewTemplate;
  initialResponses: ScorecardResponses;
  initialOverall: number | null;
  initialRecommendation: string | null;
  initialSummary: string | null;
  readOnly: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [comps, setComps] = useState<Record<string, { rating?: number | null; notes?: string }>>(
    initialResponses.competencies ?? {},
  );
  const [basics, setBasics] = useState<Record<string, string>>(initialResponses.basics ?? {});
  const [overall, setOverall] = useState<number | null>(initialOverall);
  const [recommendation, setRecommendation] = useState<string>(initialRecommendation ?? "");
  const [summary, setSummary] = useState<string>(initialSummary ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setRating = (key: string, rating: number) => { setComps((s) => ({ ...s, [key]: { ...s[key], rating } })); setSaved(false); };
  const setNotes = (key: string, notes: string) => { setComps((s) => ({ ...s, [key]: { ...s[key], notes } })); setSaved(false); };
  const setBasic = (key: string, v: string) => { setBasics((s) => ({ ...s, [key]: v })); setSaved(false); };

  const responses: ScorecardResponses = useMemo(() => ({ competencies: comps, basics }), [comps, basics]);
  const ratedCount = template.competencies.filter((c) => typeof comps[c.key]?.rating === "number").length;

  async function post(action: "save" | "submit") {
    setBusy(action); setError(null);
    const res = await fetch("/api/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, interviewId, responses, overallRating: overall, recommendation, summary }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
    if (action === "save") { setSaved(true); router.refresh(); }
    else router.refresh();
  }

  function submit() {
    const missing = validateScorecard({ responses, overallRating: overall, recommendation, summary });
    if (missing.length) { setError(`Please complete: ${missing.join("; ")}`); return; }
    post("submit");
  }

  async function reopen() {
    if (!confirm("Reopen this completed scorecard for editing?")) return;
    setBusy("reopen"); setError(null);
    const res = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", interviewId }) });
    setBusy(null);
    if (res.ok) router.refresh(); else setError("Could not reopen.");
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      {readOnly ? (
        <Card className="p-3 flex flex-wrap items-center gap-3 bg-emerald-50 border-emerald-200">
          <span className="text-sm text-emerald-800">This scorecard is complete and read-only.</span>
          {canReopen ? <button onClick={reopen} disabled={busy === "reopen"} className="text-xs font-medium text-brand-700 hover:underline">Reopen for editing</button> : null}
        </Card>
      ) : null}

      {/* Competencies */}
      {template.competencies.map((c, i) => {
        const rating = comps[c.key]?.rating ?? null;
        return (
          <Card key={c.key} className="p-4 space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
              <div className="text-sm font-semibold text-ink">{c.label}</div>
            </div>
            <p className="text-xs text-muted italic">{c.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {template.ratingScale.map((r) => {
                const sel = rating === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setRating(c.key, r.value)}
                    title={r.label}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60 ${sel ? "bg-emerald-grad text-[#05271c] shadow" : "border border-line bg-white text-ink hover:bg-black/[0.03]"}`}
                  >
                    {r.value} · {r.label}
                  </button>
                );
              })}
            </div>
            <textarea
              value={comps[c.key]?.notes ?? ""}
              onChange={(e) => setNotes(c.key, e.target.value)}
              disabled={readOnly}
              rows={2}
              placeholder="Notes (optional)"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-70"
            />
          </Card>
        );
      })}

      {/* Basics check */}
      <Card className="p-4 space-y-2.5">
        <div className="text-sm font-semibold text-ink">Basics check</div>
        {template.basics.map((b) => (
          <div key={b.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="flex-1 text-sm text-ink">{b.label}</span>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
              {BASICS_OPTIONS.map((opt) => {
                const sel = basics[b.key] === opt;
                return (
                  <button key={opt} type="button" disabled={readOnly} onClick={() => setBasic(b.key, opt)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${sel ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>
                    {BASICS_LABELS[opt]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </Card>

      {/* Overall + recommendation + summary */}
      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold text-ink">Overall</div>
        <div>
          <div className="text-xs text-muted mb-1">Overall rating</div>
          <div className="flex flex-wrap gap-1.5">
            {template.ratingScale.map((r) => {
              const sel = overall === r.value;
              return (
                <button key={r.value} type="button" disabled={readOnly} onClick={() => { setOverall(r.value); setSaved(false); }} title={r.label}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60 ${sel ? "bg-emerald-grad text-[#05271c] shadow" : "border border-line bg-white text-ink hover:bg-black/[0.03]"}`}>
                  {r.value} · {r.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted mb-1">Recommendation <span className="text-red-500">*</span></div>
          <div className="flex flex-wrap gap-1.5">
            {RECOMMENDATION_ORDER.map((k) => {
              const sel = recommendation === k;
              return (
                <button key={k} type="button" disabled={readOnly} onClick={() => { setRecommendation(k); setSaved(false); }}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60 ${sel ? "bg-emerald-grad text-[#05271c] shadow" : "border border-line bg-white text-ink hover:bg-black/[0.03]"}`}>
                  {RECOMMENDATION_LABELS[k]}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block text-sm font-medium text-ink">Summary <span className="text-red-500">*</span>
          <textarea value={summary} onChange={(e) => { setSummary(e.target.value); setSaved(false); }} disabled={readOnly} rows={4}
            placeholder="Strengths, concerns, and your recommended next step…"
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-70" />
        </label>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!readOnly ? (
        <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
          <div className="max-w-3xl mx-auto flex items-center gap-4">
            <div className="text-sm">
              <div className="font-semibold tabular-nums">{ratedCount}/{template.competencies.length} rated</div>
              <div className="text-xs text-muted">All ratings, a recommendation & a summary are required to submit.</div>
            </div>
            <button onClick={() => post("save")} disabled={busy !== null} className={`${btn.secondary} ml-auto`}>{busy === "save" ? "Saving…" : saved ? "Saved ✓" : "Save draft"}</button>
            <button onClick={submit} disabled={busy !== null} className={btn.primary}>{busy === "submit" ? "Submitting…" : "Submit scorecard"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
