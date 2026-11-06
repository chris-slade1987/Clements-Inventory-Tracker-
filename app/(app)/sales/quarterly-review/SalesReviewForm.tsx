"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import type { ReviewMetric, ReviewSection } from "@/lib/sales-review";

const RATINGS = ["Exceeds", "Meets", "Below", "Needs improvement"] as const;
const MET = ["Met", "Not met", "N/A"] as const;

type Draft = {
  metrics: Record<string, { met: string; note: string }>;
  answers: Record<string, string>;
  rating: string;
  directorName: string;
  reviewerName: string;
  reviewDate: string;
};

// Fillable Quarterly Sales Director Review. This is a DRAFT template: the reviewer
// fills Met-Not + notes and the narrative, then Print / Save as PDF (the page's
// print button). The draft is kept in the browser (per quarter) so a refresh won't
// lose it. Full DB persistence + e-signatures can be wired next, mirroring the
// manager quarterly scorecard's sign/finalize flow.
export default function SalesReviewForm({
  metrics,
  sections,
  periodLabel,
  directorDefault,
  reviewerDefault,
}: {
  metrics: ReviewMetric[];
  sections: ReviewSection[];
  periodLabel: string;
  directorDefault: string;
  reviewerDefault: string;
}) {
  const storageKey = `sales-review-draft:${periodLabel}`;
  const [d, setD] = useState<Draft>({
    metrics: Object.fromEntries(metrics.map((m) => [m.key, { met: "", note: "" }])),
    answers: {},
    rating: "",
    directorName: directorDefault,
    reviewerName: reviewerDefault,
    reviewDate: "",
  });
  const [restored, setRestored] = useState(false);

  // Restore any saved draft for this quarter. One-time hydration from localStorage
  // (kept in an effect so SSR renders the defaults and there's no hydration
  // mismatch); the setState-in-effect rule is intentionally suppressed for it.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Draft>;
        setD((cur) => ({
          ...cur,
          ...saved,
          metrics: { ...cur.metrics, ...(saved.metrics ?? {}) },
          answers: { ...cur.answers, ...(saved.answers ?? {}) },
          reviewerName: saved.reviewerName || cur.reviewerName,
        }));
      }
    } catch { /* no draft */ }
    setRestored(true);
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist on change (per quarter).
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify(d)); } catch { /* ignore */ }
  }, [d, restored, storageKey]);

  const setMetric = (k: string, patch: Partial<{ met: string; note: string }>) =>
    setD((s) => ({ ...s, metrics: { ...s.metrics, [k]: { ...s.metrics[k], ...patch } } }));
  const setAnswer = (k: string, v: string) => setD((s) => ({ ...s, answers: { ...s.answers, [k]: v } }));

  const inputCls = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm";

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Performance scorecard */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">Performance scorecard</h2>
        <p className="mt-0.5 text-xs text-muted">Score each measure for the quarter against its target, with a short note.</p>
        <div className="mt-3 space-y-3">
          {metrics.map((m) => (
            <div key={m.key} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{m.label}</div>
                  <div className="text-[11px] text-muted">Target: {m.target}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{m.help}</div>
                </div>
                <div className="flex shrink-0 gap-1 rounded-lg bg-black/[0.05] p-1 print:hidden">
                  {MET.map((opt) => {
                    const sel = d.metrics[m.key]?.met === opt;
                    const tone = opt === "Met" ? "bg-emerald-grad text-white" : opt === "Not met" ? "bg-red-500 text-white" : "bg-slate-500 text-white";
                    return (
                      <button key={opt} type="button" onClick={() => setMetric(m.key, { met: sel ? "" : opt })}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${sel ? tone : "text-ink/70 hover:text-ink"}`}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {/* Print shows the chosen value as text */}
                <span className="hidden print:inline text-xs font-medium">{d.metrics[m.key]?.met || "—"}</span>
              </div>
              <input
                value={d.metrics[m.key]?.note ?? ""}
                onChange={(e) => setMetric(m.key, { note: e.target.value })}
                placeholder="Note (figure, trend, or context)"
                className={inputCls}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Qualitative sections */}
      {sections.map((sec) => (
        <Card key={sec.key} className="p-4">
          <h2 className="text-sm font-semibold text-ink">{sec.title}</h2>
          {sec.intro ? <p className="mt-0.5 text-xs text-muted">{sec.intro}</p> : null}
          <div className="mt-3 space-y-3">
            {sec.questions.map((q) => (
              <label key={q.key} className="block text-sm font-medium text-ink">
                {q.label}
                {q.help ? <span className="block text-[11px] font-normal text-muted">{q.help}</span> : null}
                <textarea value={d.answers[q.key] ?? ""} onChange={(e) => setAnswer(q.key, e.target.value)} rows={3} className={inputCls} />
              </label>
            ))}
          </div>
        </Card>
      ))}

      {/* Overall rating + signatures */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">Overall rating & sign-off</h2>
        <div className="mt-3">
          <div className="text-sm font-medium text-ink">Overall rating</div>
          <div className="mt-1 flex flex-wrap gap-1 rounded-xl bg-black/[0.05] p-1 w-fit print:hidden">
            {RATINGS.map((r) => {
              const sel = d.rating === r;
              return (
                <button key={r} type="button" onClick={() => setD((s) => ({ ...s, rating: sel ? "" : r }))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${sel ? "bg-emerald-grad text-white shadow-sm" : "text-ink/70 hover:text-ink"}`}>
                  {r}
                </button>
              );
            })}
          </div>
          <span className="hidden print:inline text-sm font-medium">{d.rating || "—"}</span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium text-ink">Sales Director (signature)
            <input value={d.directorName} onChange={(e) => setD((s) => ({ ...s, directorName: e.target.value }))} placeholder="Type full name" className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-ink">Reviewer / COO (signature)
            <input value={d.reviewerName} onChange={(e) => setD((s) => ({ ...s, reviewerName: e.target.value }))} placeholder="Type full name" className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-ink">Date
            <input type="date" value={d.reviewDate} onChange={(e) => setD((s) => ({ ...s, reviewDate: e.target.value }))} className={inputCls} />
          </label>
        </div>
        <p className="mt-3 text-[11px] text-muted print:hidden">
          This draft is saved in your browser for {periodLabel}. Use <span className="font-medium">Print / Save PDF</span> above to file it.
          Once the template is approved, this can be wired to save and e-sign in Canopy like the manager quarterly scorecard.
        </p>
      </Card>
    </div>
  );
}
