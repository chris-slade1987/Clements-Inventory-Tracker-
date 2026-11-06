"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import type { ReviewMetric, ReviewSection } from "@/lib/sales-review";

const RATINGS = ["Exceeds", "Meets", "Below", "Needs improvement"] as const;
const SCORE = ["Strong", "On track", "Needs focus"] as const;

export type PerfMonth = {
  id: string;
  monthLabel: string;   // Aug / Sep
  target: number;       // $50K bonus minimum
  actual: number;       // Total Branch Sales
  tierPct: number;      // bonus % the actual earns (0 / 1.5 / 2 / 2.5)
  defaultHit: boolean;  // actual >= target
};
export type PerfGroup = { label: string; totalSales: number; months: PerfMonth[] };
export type VeroGroup = { label: string; totalSales: number; months: { monthLabel: string; sales: number }[] } | null;
export type OctPeek = { label: string; branches: { label: string; sales: number; hit: boolean; pctOfMin: number }[] } | null;

type Draft = {
  hits: Record<string, boolean>;
  metrics: Record<string, { score: string; note: string }>;
  answers: Record<string, string>;
  rating: string;
  directorName: string;
  reviewerName: string;
  reviewDate: string;
};

// Quarterly Sales Director Review form — dashboard-style, in the COO's order:
// (1) PERFORMANCE grouped by branch with the months nested underneath (target vs
// actual, a Yes/No "met target" toggle, auto-calculated bonus), (2) INTANGIBLES,
// (3) NOTES, (4) SIGN-OFF. Draft kept in the browser per quarter; Print/Save-PDF
// files it. (DB persistence + e-signatures to follow on approval.)
export default function SalesReviewForm({
  perfGroups,
  veroGroup,
  octPeek,
  bonusTarget,
  metrics,
  sections,
  periodLabel,
  directorDefault,
  reviewerDefault,
}: {
  perfGroups: PerfGroup[];
  veroGroup: VeroGroup;
  octPeek: OctPeek;
  bonusTarget: string;
  metrics: ReviewMetric[];
  sections: ReviewSection[];
  periodLabel: string;
  directorDefault: string;
  reviewerDefault: string;
}) {
  const allMonths = useMemo(() => perfGroups.flatMap((g) => g.months), [perfGroups]);
  const storageKey = `sales-review-draft:${periodLabel}`;
  const [d, setD] = useState<Draft>({
    hits: Object.fromEntries(allMonths.map((m) => [m.id, m.defaultHit])),
    metrics: Object.fromEntries(metrics.map((m) => [m.key, { score: "", note: "" }])),
    answers: {},
    rating: "",
    directorName: directorDefault,
    reviewerName: reviewerDefault,
    reviewDate: "",
  });
  const [restored, setRestored] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Draft>;
        setD((cur) => ({
          ...cur,
          ...saved,
          hits: { ...cur.hits, ...(saved.hits ?? {}) },
          metrics: { ...cur.metrics, ...(saved.metrics ?? {}) },
          answers: { ...cur.answers, ...(saved.answers ?? {}) },
          reviewerName: saved.reviewerName || cur.reviewerName,
        }));
      }
    } catch { /* no draft */ }
    setRestored(true);
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify(d)); } catch { /* ignore */ }
  }, [d, restored, storageKey]);

  const monthBonus = (m: PerfMonth) => (d.hits[m.id] ? Math.round((m.actual * m.tierPct) / 100) : 0);
  const groupBonus = (g: PerfGroup) => g.months.reduce((s, m) => s + monthBonus(m), 0);
  const totalBonus = useMemo(() => allMonths.reduce((s, m) => s + monthBonus(m), 0), [allMonths, d.hits]); // eslint-disable-line react-hooks/exhaustive-deps
  const metCount = allMonths.filter((m) => d.hits[m.id]).length;

  const setMetric = (k: string, patch: Partial<{ score: string; note: string }>) =>
    setD((s) => ({ ...s, metrics: { ...s.metrics, [k]: { ...s.metrics[k], ...patch } } }));
  const setAnswer = (k: string, v: string) => setD((s) => ({ ...s, answers: { ...s.answers, [k]: v } }));
  const toggleHit = (id: string, v: boolean) => setD((s) => ({ ...s, hits: { ...s.hits, [id]: v } }));
  const inputCls = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm";

  return (
    <div className="space-y-5 max-w-4xl">
      {/* 1 — PERFORMANCE (grouped by branch; months nested) */}
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 border-b border-line">
          <div>
            <h2 className="text-sm font-semibold text-ink">Branch performance &amp; bonus</h2>
            <p className="mt-0.5 text-xs text-muted">Total Branch Sales vs the $50K/mo minimum · tiers 1.5% @ $50K · 2% @ $65K · 2.5% @ $80K</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-muted">{periodLabel} bonus</div>
            <div className={`text-3xl font-light tabular-nums ${totalBonus > 0 ? "text-brand-600" : "text-ink"}`}>{money(totalBonus)}</div>
            <div className="text-[11px] text-muted">{metCount} of {allMonths.length} months met · target {bonusTarget}</div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line bg-black/[0.02]">
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-3 py-2 font-medium text-right">Target</th>
              <th className="px-3 py-2 font-medium">Actual</th>
              <th className="px-3 py-2 font-medium text-center">Met target?</th>
              <th className="px-4 py-2 font-medium text-right">Bonus</th>
            </tr>
          </thead>
          <tbody>
            {perfGroups.map((g) => {
              const gb = groupBonus(g);
              return (
                <GroupBlock key={g.label} label={g.label} totalSales={g.totalSales} groupBonus={gb}>
                  {g.months.map((m) => {
                    const yes = !!d.hits[m.id];
                    const pct = Math.min(100, Math.round((m.actual / 80000) * 100)); // scaled to top tier
                    const barColor = m.actual >= 80000 ? "bg-emerald-600" : m.actual >= 65000 ? "bg-emerald-500" : m.actual >= 50000 ? "bg-emerald-400" : "bg-red-400";
                    return (
                      <tr key={m.id} className="border-b border-line last:border-0 align-middle">
                        <td className="py-2.5 pl-8 pr-3 text-muted">{m.monthLabel}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted">{money(m.target)}</td>
                        <td className="px-3 py-2.5 min-w-[170px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="tabular-nums text-ink">{money(m.actual)}</span>
                            <span className="text-[10px] text-muted">{m.tierPct > 0 ? `${m.tierPct}% tier` : `${Math.round((m.actual / 50000) * 100)}% of min`}</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="mx-auto flex w-fit items-center rounded-full border border-line p-0.5 print:hidden">
                            <button type="button" onClick={() => toggleHit(m.id, true)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${yes ? "bg-emerald-grad text-white shadow-sm" : "text-muted hover:text-ink"}`}>Yes</button>
                            <button type="button" onClick={() => toggleHit(m.id, false)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${!yes ? "bg-red-500 text-white shadow-sm" : "text-muted hover:text-ink"}`}>No</button>
                          </div>
                          <span className="hidden print:inline text-xs font-medium">{yes ? "Yes" : "No"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(monthBonus(m))}</td>
                      </tr>
                    );
                  })}
                </GroupBlock>
              );
            })}

            {/* Vero Beach — context only, excluded from the bonus */}
            {veroGroup ? (
              <>
                <tr className="bg-black/[0.03]">
                  <td colSpan={5} className="px-4 py-2">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                      {veroGroup.label}
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">excluded from bonus</span>
                      <span className="ml-auto text-[11px] font-normal tabular-nums text-muted">{money(veroGroup.totalSales)} total</span>
                    </span>
                  </td>
                </tr>
                {veroGroup.months.map((v, i) => (
                  <tr key={`vero-${i}`} className="border-b border-line last:border-0 text-muted">
                    <td className="py-2.5 pl-8 pr-3">{v.monthLabel}</td>
                    <td className="px-3 py-2.5 text-right">—</td>
                    <td className="px-3 py-2.5 tabular-nums">{money(v.sales)}</td>
                    <td className="px-3 py-2.5 text-center">—</td>
                    <td className="px-4 py-2.5 text-right">—</td>
                  </tr>
                ))}
              </>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-black/[0.02]">
              <td className="px-4 py-3 font-semibold text-ink" colSpan={4}>{periodLabel} total bonus (auto)</td>
              <td className="px-4 py-3 text-right text-lg font-semibold tabular-nums text-brand-700">{money(totalBonus)}</td>
            </tr>
          </tfoot>
        </table>

        {octPeek ? (
          <div className="m-4 rounded-xl border border-dashed border-line bg-black/[0.02] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{octPeek.label} — early next-quarter look (not scored here)</div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink">
              {octPeek.branches.map((b) => (
                <span key={b.label} className="tabular-nums">{b.label}: {money(b.sales)} <span className={b.hit ? "text-brand-600" : "text-muted"}>({b.pctOfMin}% of min{b.hit ? " ✓" : ""})</span></span>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* 2 — INTANGIBLES */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">Role &amp; leadership (intangibles)</h2>
        <p className="mt-0.5 text-xs text-muted">The few role-relevant intangibles that matter alongside the hard numbers.</p>
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
                  {SCORE.map((opt) => {
                    const sel = d.metrics[m.key]?.score === opt;
                    const tone = opt === "Strong" ? "bg-emerald-grad text-white" : opt === "On track" ? "bg-amber-500 text-white" : "bg-red-500 text-white";
                    return (
                      <button key={opt} type="button" onClick={() => setMetric(m.key, { score: sel ? "" : opt })}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${sel ? tone : "text-ink/70 hover:text-ink"}`}>{opt}</button>
                    );
                  })}
                </div>
                <span className="hidden print:inline text-xs font-medium">{d.metrics[m.key]?.score || "—"}</span>
              </div>
              <input value={d.metrics[m.key]?.note ?? ""} onChange={(e) => setMetric(m.key, { note: e.target.value })} placeholder="Note" className={inputCls} />
            </div>
          ))}
        </div>
      </Card>

      {/* 3 — NOTES */}
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

      {/* 4 — SIGN-OFF */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">Overall rating &amp; sign-off</h2>
        <div className="mt-3">
          <div className="text-sm font-medium text-ink">Overall rating</div>
          <div className="mt-1 flex flex-wrap gap-1 rounded-xl bg-black/[0.05] p-1 w-fit print:hidden">
            {RATINGS.map((r) => {
              const sel = d.rating === r;
              return (
                <button key={r} type="button" onClick={() => setD((s) => ({ ...s, rating: sel ? "" : r }))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${sel ? "bg-emerald-grad text-white shadow-sm" : "text-ink/70 hover:text-ink"}`}>{r}</button>
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
          Draft saved in your browser for {periodLabel}. Use <span className="font-medium">Print / Save PDF</span> above to file it.
          Once approved, this can be wired to release → e-sign → file to the personnel record + copy HR, like the manager scorecard.
        </p>
      </Card>
    </div>
  );
}

// A branch group: a tinted header row (branch name + quarter total + its bonus
// subtotal) followed by its month rows.
function GroupBlock({ label, totalSales, groupBonus, children }: { label: string; totalSales: number; groupBonus: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-brand-50/60">
        <td colSpan={5} className="px-4 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">{label}</span>
            <span className="text-[11px] font-normal tabular-nums text-muted">· {money(totalSales)} this quarter</span>
            <span className="ml-auto text-[11px] font-medium tabular-nums text-brand-700">Bonus {money(groupBonus)}</span>
          </span>
        </td>
      </tr>
      {children}
    </>
  );
}
