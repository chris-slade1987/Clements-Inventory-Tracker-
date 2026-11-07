"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

// The saved sign-off state for this quarter, loaded server-side.
export type Persisted = {
  status: "draft" | "released" | "signed";
  releasedAt: string | null;
  reviewerName: string | null;
  directorName: string | null;
  directorSignName: string | null;
  directorSignedAt: string | null;
  signUrl: string | null;
  lastEmail: { status: string; at: string; error: string | null } | null;
  bonus: number;
  /** The reviewer's autosaved working draft (server copy) + when it was saved (ms). */
  draft: DraftIn;
  draftSavedAt: number;
  snapshot: {
    hits: Record<string, boolean>;
    metrics: Record<string, { score: string; note: string }>;
    answers: Record<string, string>;
    rating: string;
    reviewDate: string;
  } | null;
} | null;

// A draft as stored (server or browser) — any field may be missing.
type DraftIn = {
  hits?: Record<string, boolean>;
  metrics?: Record<string, { score?: string; note?: string }>;
  answers?: Record<string, string>;
  rating?: string;
  directorName?: string;
  reviewerName?: string;
  reviewDate?: string;
} | null;

// Field-level merge that never lets a BLANK wipe out text: a non-empty value
// always beats an empty one; when both sides have different text, the more
// recently saved side wins (an old browser draft with no timestamp counts as
// oldest). Keys that no longer exist on the form are kept, so text typed into a
// since-removed field is never silently dropped.
function pick(a: string | undefined, aAt: number, b: string | undefined, bAt: number): string {
  const A = (a ?? "").trim();
  const B = (b ?? "").trim();
  if (!A) return b ?? "";
  if (!B) return a ?? "";
  if (A === B) return a ?? "";
  return bAt > aAt ? (b ?? "") : (a ?? "");
}
function mergeDraft(base: Draft, baseAt: number, other: DraftIn, otherAt: number): Draft {
  if (!other) return base;
  const metrics: Draft["metrics"] = { ...base.metrics };
  for (const [k, v] of Object.entries(other.metrics ?? {})) {
    const cur = metrics[k] ?? { score: "", note: "" };
    metrics[k] = { score: pick(cur.score, baseAt, v?.score, otherAt), note: pick(cur.note, baseAt, v?.note, otherAt) };
  }
  const answers: Draft["answers"] = { ...base.answers };
  for (const [k, v] of Object.entries(other.answers ?? {})) answers[k] = pick(answers[k], baseAt, v, otherAt);
  const hits = otherAt > baseAt ? { ...base.hits, ...(other.hits ?? {}) } : { ...(other.hits ?? {}), ...base.hits };
  return {
    hits,
    metrics,
    answers,
    rating: pick(base.rating, baseAt, other.rating, otherAt),
    directorName: pick(base.directorName, baseAt, other.directorName, otherAt),
    reviewerName: pick(base.reviewerName, baseAt, other.reviewerName, otherAt),
    reviewDate: pick(base.reviewDate, baseAt, other.reviewDate, otherAt),
  };
}
const hasText = (d: DraftIn) =>
  !!d && (Object.values(d.answers ?? {}).some((v) => (v ?? "").trim()) || Object.values(d.metrics ?? {}).some((m) => (m?.note ?? "").trim() || (m?.score ?? "").trim()) || !!d.rating);

// Labels for fields that were on earlier versions of this form.
const LEGACY_LABELS: Record<string, string> = {
  director_comments: "Director's self-assessment / comments",
  retention: "Customer retention / attrition",
  coaching: "Coaching cadence",
  marketing: "Marketing & lead quality",
  process: "Process adherence",
  attainment: "Team sales attainment",
  close_rate: "Team closing rate",
  pipeline: "Pipeline coverage",
  goal_discipline: "Goal-setting discipline",
  conversion: "Lead → proposal conversion",
  production: "Termite units / new agreements",
  development: "Advisor development",
  branch_tiers: "Branch sales vs bonus tiers",
  bonus: "Quarterly team-sales bonus earned",
  step_up: "Producing-rep milestone",
  growth: "Profitable revenue growth",
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

// Quarterly Sales Director Review form — dashboard-style, in the COO's order:
// (1) PERFORMANCE grouped by branch with the months nested underneath (target vs
// actual, a Yes/No "met target" toggle, auto-calculated bonus), (2) INTANGIBLES,
// (3) NOTES, (4) SIGN-OFF + RELEASE. While a draft, edits autosave to the account
// (SalesReview.draft) and this browser;
// Release persists the review and emails the Director a sign link, which locks the
// form until it's reopened. The Director's signature files it to their personnel
// record and copies HR (see lib/sales-review-store.ts).
export default function SalesReviewForm({
  perfGroups,
  veroGroup,
  octPeek,
  bonusTarget,
  metrics,
  sections,
  periodLabel,
  year,
  quarter,
  directorDefault,
  directorEmail,
  reviewerDefault,
  persisted,
}: {
  perfGroups: PerfGroup[];
  veroGroup: VeroGroup;
  octPeek: OctPeek;
  bonusTarget: string;
  metrics: ReviewMetric[];
  sections: ReviewSection[];
  periodLabel: string;
  year: number;
  quarter: number;
  directorDefault: string;
  directorEmail: string | null;
  reviewerDefault: string;
  persisted: Persisted;
}) {
  const router = useRouter();
  const allMonths = useMemo(() => perfGroups.flatMap((g) => g.months), [perfGroups]);
  const storageKey = `sales-review-draft:${periodLabel}`;
  const status = persisted?.status ?? "draft";
  const locked = status === "released" || status === "signed";
  const snap = persisted?.snapshot ?? null;
  const serverDraft = persisted?.draft ?? null;
  const serverAt = persisted?.draftSavedAt ?? 0;
  const [d, setD] = useState<Draft>(() => {
    const base: Draft = {
      hits: { ...Object.fromEntries(allMonths.map((m) => [m.id, m.defaultHit])), ...(snap?.hits ?? {}) },
      metrics: { ...Object.fromEntries(metrics.map((m) => [m.key, { score: "", note: "" }])), ...(snap?.metrics ?? {}) },
      answers: { ...(snap?.answers ?? {}) },
      rating: snap?.rating ?? "",
      directorName: persisted?.directorName || directorDefault,
      reviewerName: persisted?.reviewerName || reviewerDefault,
      reviewDate: snap?.reviewDate ?? "",
    };
    // A released/signed review shows exactly what was released; a draft starts
    // from the account's autosaved copy (so it follows the reviewer across devices).
    return locked ? base : mergeDraft(base, 0, serverDraft, serverAt || 1);
  });
  const [restored, setRestored] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(serverDraft ? "saved" : "idle");
  const [recovered, setRecovered] = useState(false);
  const skipNextSave = useRef(true);
  const [busy, setBusy] = useState<null | "release" | "reopen">(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [lastSignUrl, setLastSignUrl] = useState<string | null>(persisted?.signUrl ?? null);

  async function act(action: "release" | "reopen") {
    if (action === "release") {
      if (!d.rating) return setMsg({ tone: "err", text: "Choose an overall rating before releasing." });
      if (!d.reviewerName.trim()) return setMsg({ tone: "err", text: "Type your name in the Reviewer / COO signature before releasing." });
      if (!window.confirm(`Release the ${periodLabel} review and email ${d.directorName || "the Sales Director"} a link to sign? The form locks until you reopen it.`)) return;
    } else if (!window.confirm("Reopen this review to revise it? The Director's current sign link stops working; releasing again sends a fresh one.")) {
      return;
    }
    setBusy(action);
    setMsg(null);
    const res = await fetch("/api/sales/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, year, quarter, draft: d }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ tone: "err", text: out.error ?? "Something went wrong." });
    if (action === "release") {
      setLastSignUrl(out.signUrl ?? null);
      const sent = out.emailStatus === "sent";
      setMsg({
        tone: sent ? "ok" : "err",
        text: sent
          ? `Released — ${out.directorName} was emailed a sign link${out.directorEmail ? ` at ${out.directorEmail}` : ""}.`
          : `Released, but the email ${out.directorEmail ? `to ${out.directorEmail} ` : ""}did not send (${out.emailStatus}). Copy the sign link below and send it to ${out.directorName} directly.`,
      });
    } else {
      setMsg({ tone: "ok", text: "Reopened — you can revise and release again." });
    }
    router.refresh();
  }

  async function saveToServer(draft: Draft) {
    setSaveState("saving");
    try {
      const res = await fetch("/api/sales/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveDraft", year, quarter, draft }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // A released/signed review shows exactly what was released — never a draft.
    if (locked) {
      setRestored(true);
      return;
    }
    // Recovery: fold in any draft saved in THIS browser (the only place drafts lived
    // before account autosave). Blank fields never overwrite text. If the browser
    // copy adds anything, push it to the account right away so it shows everywhere.
    let local: DraftIn = null;
    let localAt = 0;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as DraftIn & { savedAt?: number };
        local = parsed;
        localAt = typeof parsed?.savedAt === "number" ? parsed.savedAt : 0;
      }
    } catch { /* no browser draft */ }
    if (local && hasText(local)) {
      const merged = mergeDraft(d, serverAt, local, localAt);
      if (JSON.stringify(merged) !== JSON.stringify(d)) {
        setD(merged);
        setRecovered(true);
        void saveToServer(merged);
      }
    }
    setRestored(true);
  }, [storageKey, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  // Autosave: this browser immediately (timestamped), the account ~1s after typing stops.
  useEffect(() => {
    if (!restored || locked) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* ignore */ }
    if (skipNextSave.current) {
      skipNextSave.current = false; // the initial render isn't an edit
      return;
    }
    const t = setTimeout(() => void saveToServer(d), 1000);
    return () => clearTimeout(t);
  }, [d, restored, storageKey, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Text typed into fields that have since been removed from the form.
  const metricKeys = new Set(metrics.map((m) => m.key));
  const questionKeys = new Set(sections.flatMap((s) => s.questions.map((q) => q.key)));
  const legacy = [
    ...Object.entries(d.answers)
      .filter(([k, v]) => !questionKeys.has(k) && (v ?? "").trim())
      .map(([k, v]) => ({ kind: "answer" as const, key: k, label: LEGACY_LABELS[k] ?? k, text: v.trim() })),
    ...Object.entries(d.metrics)
      .filter(([k, v]) => !metricKeys.has(k) && ((v?.note ?? "").trim() || (v?.score ?? "").trim()))
      .map(([k, v]) => ({ kind: "metric" as const, key: k, label: LEGACY_LABELS[k] ?? k, text: [v.score, v.note].filter((x) => (x ?? "").trim()).join(" — ") })),
  ];
  function moveLegacyToSummary(item: (typeof legacy)[number]) {
    setD((s) => {
      const existing = (s.answers.coo_notes ?? "").trim();
      const answers: Record<string, string> = { ...s.answers, coo_notes: `${existing ? `${existing}\n\n` : ""}${item.label}: ${item.text}` };
      const metricsNext = { ...s.metrics };
      if (item.kind === "answer") delete answers[item.key];
      else delete metricsNext[item.key];
      return { ...s, answers, metrics: metricsNext };
    });
  }

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
      {/* Status banner — where this quarter's review stands in the sign-off flow. */}
      {status === "released" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          <span className="font-semibold">Released {fmtDate(persisted?.releasedAt ?? null)}</span> — awaiting {d.directorName}&rsquo;s signature. The form is locked; reopen it below to revise.
        </div>
      ) : status === "signed" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">
          <span className="font-semibold">Signed by {persisted?.directorSignName} on {fmtDate(persisted?.directorSignedAt ?? null)}</span> — filed to {d.directorName}&rsquo;s personnel record; HR has a copy.
        </div>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs print:hidden">
          <span className={saveState === "error" ? "text-red-600" : "text-muted"}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "All changes saved to your account — open this review on any device."
                : saveState === "error"
                  ? "Couldn't save to your account — your changes are kept on this device; they'll save on your next edit."
                  : "Changes save to your account as you type."}
          </span>
        </div>
      ) : null}

      {recovered ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">
          <span className="font-semibold">Recovered your earlier notes</span> from this browser and saved them to your account, so they&rsquo;ll now appear on any device.
        </div>
      ) : null}

      {!locked && legacy.length > 0 ? (
        <Card className="p-4 border-amber-200 print:hidden">
          <h2 className="text-sm font-semibold text-ink">Notes from fields no longer on this form</h2>
          <p className="mt-0.5 text-xs text-muted">You wrote these in fields that were later removed or renamed. They aren&rsquo;t part of the review until you add them — tap to append one to the COO summary.</p>
          <div className="mt-3 space-y-3">
            {legacy.map((item) => (
              <div key={`${item.kind}:${item.key}`} className="rounded-xl border border-line p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{item.label}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{item.text}</p>
                <button type="button" onClick={() => moveLegacyToSummary(item)} className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-black/[0.03]">
                  Add to COO summary
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <fieldset disabled={locked} className="space-y-5 min-w-0">
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
              <textarea value={d.metrics[m.key]?.note ?? ""} onChange={(e) => setMetric(m.key, { note: e.target.value })} rows={3} placeholder="Note" className={inputCls} />
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
                <textarea value={d.answers[q.key] ?? ""} onChange={(e) => setAnswer(q.key, e.target.value)} rows={5} className={inputCls} />
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
          <label className="block text-sm font-medium text-ink">Reviewer / COO (signature)
            <input value={d.reviewerName} onChange={(e) => setD((s) => ({ ...s, reviewerName: e.target.value }))} placeholder="Type full name" className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-ink">Date
            <input type="date" value={d.reviewDate} onChange={(e) => setD((s) => ({ ...s, reviewDate: e.target.value }))} className={inputCls} />
          </label>
          <div className="block text-sm font-medium text-ink">Sales Director (signature)
            <div className="mt-1 rounded-lg border border-dashed border-line px-3 py-2 text-sm font-normal">
              {status === "signed" ? (
                <span className="text-ink">{persisted?.directorSignName} <span className="text-muted">· {fmtDate(persisted?.directorSignedAt ?? null)}</span></span>
              ) : status === "released" ? (
                <span className="text-amber-700">Awaiting {d.directorName}</span>
              ) : (
                <span className="text-muted">{d.directorName} signs via emailed link</span>
              )}
            </div>
          </div>
        </div>
      </Card>
      </fieldset>

      {/* 5 — RELEASE (outside the locked fieldset so reopen stays clickable) */}
      <Card className="p-4 print:hidden">
        <h2 className="text-sm font-semibold text-ink">Release for signature</h2>
        {status === "draft" ? (
          <>
            <p className="mt-0.5 text-xs text-muted">
              Releasing saves this review, signs it as reviewer, and emails <span className="font-medium text-ink">{d.directorName}</span>
              {directorEmail ? <> ({directorEmail})</> : <span className="text-red-600"> — no email on file; you&rsquo;ll get a link to send him</span>} a secure link to review and e-sign.
              Once he signs, it&rsquo;s filed to his personnel record and HR gets a copy. Your edits save to your account as you type.
            </p>
            <button type="button" onClick={() => act("release")} disabled={busy !== null}
              className="mt-3 w-full sm:w-auto rounded-xl bg-emerald-grad px-5 py-3 text-sm font-medium text-white shadow-sm disabled:opacity-50">
              {busy === "release" ? "Releasing…" : `Release & email to ${d.directorName.split(" ")[0] || "Director"}`}
            </button>
          </>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-muted">
              {status === "released"
                ? <>Released {fmtDate(persisted?.releasedAt ?? null)}{persisted?.lastEmail ? <> · last email {persisted.lastEmail.status === "sent" ? "sent" : <span className="text-red-600">{persisted.lastEmail.status}</span>} {fmtDate(persisted.lastEmail.at)}</> : null}. Reopen to revise; releasing again emails a fresh link.</>
                : <>Signed and filed. Reopen only if it must be corrected — re-releasing sends it back to {d.directorName} to sign again and overwrites the filed copy.</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {status === "released" ? (
                <button type="button" onClick={() => act("release")} disabled={busy !== null}
                  className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50">
                  {busy === "release" ? "Sending…" : "Resend sign link"}
                </button>
              ) : null}
              <button type="button" onClick={() => act("reopen")} disabled={busy !== null}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink hover:bg-black/[0.03] disabled:opacity-50">
                {busy === "reopen" ? "Reopening…" : "Reopen to revise"}
              </button>
            </div>
          </>
        )}
        {status === "released" && lastSignUrl ? (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">Sign link</div>
            <input readOnly value={lastSignUrl} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full rounded-lg border border-line bg-black/[0.02] px-3 py-2 text-xs" />
          </div>
        ) : null}
        {msg ? <p className={`mt-3 text-sm ${msg.tone === "ok" ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p> : null}
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
