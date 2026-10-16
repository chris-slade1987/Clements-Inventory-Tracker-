"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { money, qty } from "@/lib/format";
import {
  deriveRates, buildPlan, projectMonthEndClose, paceRatio, paceStatusWord, type GoalSheetInput,
} from "@/lib/sales-goal";
import GoalSlider from "@/components/GoalSlider";
import { Gauge, ProgressRing, AchievementBar, rampColor, rampTextColor } from "@/components/motivation";

// The Sales Director's Excel goal sheet, rebuilt as an EASY, guided 4-step flow.
// A sticky stepper across the top shows progress (1 Results · 2 Goal · 3 Focus ·
// 4 Notes) and jumps to each step. The visual sales FUNNEL (Leads → Appointments
// → Proposals → Closed $) is always on screen — a skeleton before results are in,
// a tapering colored funnel once they are — so it's never hidden. The goal scale
// caps at $75k and the slider colors along its range as you drag; the pace gauge +
// achievement bar stay driven by REAL closed $ (projected vs goal) so a bigger
// goal can't fake a green pace. The Sales Director can also propose a goal.

const pct = (r: number) => `${Math.round((r || 0) * 100)}%`;
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

const GOAL_MAX = 75000; // the agreed cap for a monthly sales goal

type PaceSignal = { closedSoFar: number; priorClose: number; paceFrac: number; hasActuals: boolean };
type Proposal = { proposedGoal: number | null; goalStatus: string | null; proposedByName: string | null };

const STATUS_LABEL: Record<string, string> = {
  advisor_set: "Advisor set",
  advisor_requested: "Awaiting approval",
  director_proposed: "Director proposed",
  agreed: "Agreed",
};
const STATUS_TONE: Record<string, string> = {
  advisor_set: "bg-brand-50 text-brand-700 border-brand-200",
  advisor_requested: "bg-amber-50 text-amber-800 border-amber-200",
  director_proposed: "bg-amber-50 text-amber-800 border-amber-200",
  agreed: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

type Field = { key: keyof GoalSheetInput; label: string; help: string; kind: "count" | "money" };

// The activity counts that build the funnel…
const ACTIVITY_FIELDS: Field[] = [
  { key: "leads", label: "Leads", help: "Every new sales opportunity you worked — calls, web, referrals, real-estate.", kind: "count" },
  { key: "reis", label: "Real-estate re-inspections", help: "Homes you inspected for a real-estate sale.", kind: "count" },
  { key: "appts", label: "Other appointments", help: "Sales appointments you ran that weren't ReIs.", kind: "count" },
  { key: "proposals", label: "Proposals given", help: "Quotes/proposals you presented.", kind: "count" },
];
// …and the dollars (kept by service line so your close rates stay accurate).
const DOLLAR_FIELDS: Field[] = [
  { key: "totalExposure", label: "Total $ proposed", help: "Every dollar you quoted last month (pest + termite).", kind: "money" },
  { key: "pcExposed", label: "Pest-control $ proposed", help: "Of that, the pest-control dollars.", kind: "money" },
  { key: "pcSold", label: "Pest-control $ sold", help: "Pest-control dollars that closed.", kind: "money" },
  { key: "tcSold", label: "Termite $ sold", help: "Termite dollars that closed.", kind: "money" },
  { key: "tcUnits", label: "Termite jobs sold", help: "Number of termite jobs closed (a count).", kind: "count" },
];

// This month's focus — the initiatives an advisor plans to lean on.
const INITIATIVE_OPTIONS = ["Group networking", "Drop-offs", "Cross-selling lists", "Team ride-alongs"];

const FUNNEL_COLOR: Record<string, string> = {
  leads: "#74A96E", appts: "#4F8A5F", proposals: "#2E6F47", closed: "#15B85C",
};

type FStage = { key: string; label: string; display: string; sub: string; size: number; value: number; color: string; convToNext: number | null; convLabel: string };

export default function GoalPlanner({
  periodKey, periodLabelText, advisorEmployeeId, advisorName, initial, canEdit,
  viewerRole = "advisor",
  initialInitiatives = [],
  initialNotes = "",
  initialOverrides = { leadsGoal: 0, proposalsGoal: 0, dealsGoal: 0 },
  paceSignal = { closedSoFar: 0, priorClose: 0, paceFrac: 0, hasActuals: false },
  proposal = { proposedGoal: null, goalStatus: null, proposedByName: null },
}: {
  periodKey: string;
  periodLabelText: string;
  advisorEmployeeId?: string;
  advisorName?: string;
  initial: GoalSheetInput;
  canEdit: boolean;
  viewerRole?: "advisor" | "director";
  initialInitiatives?: string[];
  initialNotes?: string;
  initialOverrides?: { leadsGoal: number; proposalsGoal: number; dealsGoal: number };
  paceSignal?: PaceSignal;
  proposal?: Proposal;
}) {
  const router = useRouter();
  const [v, setV] = useState<GoalSheetInput>(initial);
  const [initiatives, setInitiatives] = useState<string[]>(initialInitiatives);
  const [customInit, setCustomInit] = useState("");
  const [notes, setNotes] = useState<string>(initialNotes);
  const [ov, setOv] = useState(initialOverrides);
  const [ovOpen, setOvOpen] = useState((initialOverrides.leadsGoal || initialOverrides.proposalsGoal || initialOverrides.dealsGoal) > 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [proposeVal, setProposeVal] = useState<number>(proposal.proposedGoal ?? (initial.salesGoal > 0 ? initial.salesGoal : 40000));

  const set = (k: keyof GoalSheetInput, val: string) => setV((s) => ({ ...s, [k]: val === "" ? 0 : Number(val) }));

  const { rates, plan } = useMemo(() => {
    const r = deriveRates(v);
    return { rates: r, plan: buildPlan(r, { salesGoal: v.salesGoal, workdays: v.workdays }) };
  }, [v]);

  // ── The funnel: Leads → Appointments → Proposals → Closed $ (always rendered) ──
  const funnel = useMemo(() => {
    const leads = v.leads || 0;
    const appts = (v.reis || 0) + (v.appts || 0);
    const proposals = v.proposals || 0;
    const closedAmt = (v.pcSold || 0) + (v.tcSold || 0);
    const proposedAmt = v.totalExposure || 0;
    const closeRate = rates.totalClosingPct; // $ closed / $ proposed
    const wonSize = proposals * (closeRate || 0);
    const stages: FStage[] = [
      { key: "leads", label: "Leads", display: qty(leads), sub: "opportunities worked", size: leads, value: leads, color: FUNNEL_COLOR.leads, convToNext: div(appts, leads), convLabel: "became appointments" },
      { key: "appts", label: "Appointments", display: qty(appts), sub: "ReIs + appointments run", size: appts, value: appts, color: FUNNEL_COLOR.appts, convToNext: div(proposals, appts), convLabel: "got a proposal" },
      { key: "proposals", label: "Proposals", display: qty(proposals), sub: proposedAmt > 0 ? `${money(proposedAmt)} proposed` : "quotes presented", size: proposals, value: proposals, color: FUNNEL_COLOR.proposals, convToNext: closeRate, convLabel: "close rate ($)" },
      { key: "closed", label: "Closed", display: money(closedAmt), sub: proposedAmt > 0 ? `from ${money(proposedAmt)} proposed` : "won this month", size: wonSize, value: closedAmt, color: FUNNEL_COLOR.closed, convToNext: null, convLabel: "" },
    ];
    const hasData = stages.some((s) => s.value > 0);
    return { stages, leads, appts, proposals, closedAmt, proposedAmt, closeRate, hasData };
  }, [v, rates]);

  // REAL on-track pace (projected month-end close is fixed by actuals; the goal
  // slider never moves it — so a higher goal can't fake a green pace reading).
  const projected = useMemo(() => projectMonthEndClose(paceSignal), [paceSignal]);
  const ratio = paceRatio(projected, v.salesGoal);
  const hasPace = paceSignal.hasActuals && v.salesGoal > 0;
  const pacePct = Math.min(100, ratio * 100);
  const paceColor = hasPace ? rampColor(pacePct) : "#9BB0A4";
  const paceTextColor = hasPace ? rampTextColor(pacePct) : "#5C6B62";
  const paceWord = hasPace ? paceStatusWord(ratio) : "Awaiting results";

  const ready = v.salesGoal > 0 && v.workdays > 0 && rates.tcClosingPct > 0 && rates.exposurePerProposal > 0 && rates.proposalsPerProspect > 0;
  const stretch = ready && plan.prospectsPerDay > 8;

  const status = proposal.goalStatus;
  const showProposalBanner = viewerRole === "advisor" && proposal.proposedGoal != null && status === "director_proposed";

  // Step completion → the stepper + top progress bar.
  const steps = [
    { n: 1, id: "step-results", label: "Last month", done: funnel.hasData },
    { n: 2, id: "step-goal", label: "This month's goal", done: v.salesGoal > 0 && v.workdays > 0 },
    { n: 3, id: "step-initiatives", label: "Focus", done: initiatives.length > 0 },
    { n: 4, id: "step-notes", label: "Notes", done: notes.trim().length > 0 },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  async function post(payload: Record<string, unknown>, okMsg: string) {
    setBusy(true); setMsg(null); setErr(false);
    try {
      const res = await fetch("/api/sales/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey, ...(advisorEmployeeId ? { advisorEmployeeId } : {}), ...payload }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(true); setMsg(d.error ?? "Could not save."); return false; }
      setMsg(okMsg);
      router.refresh();
      return true;
    } catch (e) { setBusy(false); setErr(true); setMsg((e as Error).message); return false; }
  }

  const save = () => post({ ...v, initiatives, notesForDirector: notes }, "Saved.");
  const requestApproval = () =>
    post({ ...v, initiatives, notesForDirector: notes, leadsGoal: ov.leadsGoal, proposalsGoal: ov.proposalsGoal, dealsGoal: ov.dealsGoal, action: "request_approval" }, "Sent to your Sales Director for approval.");
  const approveGoalAction = () => post({ action: "approve" }, "Goal approved.");
  const propose = () => post({ action: "propose", proposedGoal: proposeVal }, "Goal proposed to the advisor.");
  const accept = async () => {
    if (await post({ action: "accept" }, "Proposal accepted — it's now your goal.")) {
      if (proposal.proposedGoal != null) setV((s) => ({ ...s, salesGoal: proposal.proposedGoal as number }));
    }
  };

  const scrollTo = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));

  const toggleInit = (label: string) =>
    setInitiatives((cur) => (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]));
  const addCustomInit = () => {
    const t = customInit.trim();
    if (t && !initiatives.includes(t)) setInitiatives((cur) => [...cur, t]);
    setCustomInit("");
  };

  const numInput = (k: keyof GoalSheetInput, kind: "count" | "money") => (
    <div className="relative">
      {kind === "money" ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span> : null}
      <input
        type="number" inputMode={kind === "money" ? "decimal" : "numeric"} min={0}
        disabled={!canEdit}
        value={v[k] === 0 ? "" : String(v[k])}
        onChange={(e) => set(k, e.target.value)}
        placeholder="0"
        className={`w-full rounded-lg border border-line py-2.5 text-base sm:text-sm ${kind === "money" ? "pl-7 pr-3" : "px-3"} disabled:bg-slate-50`}
      />
    </div>
  );

  const ovInput = (label: string, val: number, onChange: (n: number) => void) => (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      <input
        type="number" inputMode="numeric" min={0}
        value={val === 0 ? "" : String(val)}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        placeholder="0"
        className="w-full rounded-lg border border-line px-3 py-2 text-base sm:text-sm"
      />
    </label>
  );

  const fieldLabel = (f: Field) => (
    <label key={f.key} className="block text-sm">
      <span className="font-medium text-ink">{f.label}</span>
      <span className="mb-1 mt-0.5 block text-[11px] leading-snug text-muted">{f.help}</span>
      {numInput(f.key, f.kind)}
    </label>
  );

  const stepBadge = (n: number, done: boolean) => (
    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-emerald-600 text-white" : "bg-brand-600 text-white"}`}>
      {done ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
      ) : n}
    </span>
  );

  return (
    <div className="max-w-3xl space-y-4 pb-10">
      {/* Header line + goal status chip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {advisorName ? <p className="text-sm text-muted">Goal sheet for <span className="font-medium text-ink">{advisorName}</span> · {periodLabelText}</p> : <span />}
        {status ? (
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[status] ?? "border-line text-muted"}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        ) : null}
      </div>

      {/* ───────── Sticky stepper + progress (makes the sheet feel quick) ───────── */}
      <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-line bg-canvas/85 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-canvas/70">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Your goal sheet</span>
          <span className="text-[11px] font-medium text-ink">{doneCount} of 4 done</span>
        </div>
        <div className="mb-2.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-emerald-grad transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(doneCount / 4) * 100}%` }} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${s.done ? "border-emerald-200 bg-emerald-50" : "border-line bg-white hover:bg-black/[0.02]"}`}
            >
              {stepBadge(s.n, s.done)}
              <span className="min-w-0 truncate text-[11px] font-medium text-ink">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Advisor: the director proposed a goal — accept it, or set your own below. */}
      {showProposalBanner ? (
        <Card className="p-4 ring-1 ring-amber-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">
                {proposal.proposedByName ? <>{proposal.proposedByName} </> : "Your Sales Director "}
                proposed a goal of <span className="font-semibold tabular-nums">{money(proposal.proposedGoal ?? 0)}</span> for {periodLabelText}.
              </div>
              <div className="mt-0.5 text-xs text-muted">Accept it to make it your goal, or set your own target below — nothing changes until you choose.</div>
            </div>
            {canEdit ? (
              <button onClick={accept} disabled={busy} className={`${btn.primary} shrink-0`}>{busy ? "Working…" : "Accept this goal"}</button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Director: the advisor submitted their goal for approval. */}
      {viewerRole === "director" && status === "advisor_requested" ? (
        <Card className="p-4 ring-1 ring-amber-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">
                {advisorName ?? "This advisor"} submitted <span className="font-semibold tabular-nums">{money(v.salesGoal)}</span> for your approval.
              </div>
              <div className="mt-0.5 text-xs text-muted">Review their roadmap, targets, and notes below — then approve, or propose a different goal.</div>
            </div>
            {canEdit ? (
              <button onClick={approveGoalAction} disabled={busy} className={`${btn.primary} shrink-0`}>{busy ? "Working…" : "Approve goal"}</button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ───────── STEP 1 — Last month's results + the funnel ───────── */}
      <Card className="p-4 sm:p-5" id="step-results">
        <div className="mb-1 flex items-center gap-2">
          {stepBadge(1, steps[0].done)}
          <h2 className="text-base font-semibold text-ink">Fill out last month&apos;s results</h2>
        </div>
        <p className="mb-4 text-xs text-muted">No guessing — enter what actually happened. It builds your funnel and learns your personal close rates. <span className="italic">Once SmarterLaunch is connected, these numbers will fill in for you automatically.</span></p>

        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Activity</div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {ACTIVITY_FIELDS.map(fieldLabel)}
        </div>

        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Dollars</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {DOLLAR_FIELDS.map(fieldLabel)}
        </div>

        {/* The funnel — always on screen (skeleton until results are entered) */}
        <div className="mt-6 rounded-xl border border-line bg-white/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Your sales funnel</h3>
            {funnel.hasData && funnel.proposedAmt > 0 ? (
              <span className="text-xs text-muted">
                <span className="font-medium text-ink tabular-nums">{money(funnel.closedAmt)}</span> from{" "}
                <span className="tabular-nums">{money(funnel.proposedAmt)}</span> ·{" "}
                <span className="font-semibold" style={{ color: rampTextColor(funnel.closeRate * 100) }}>{pct(funnel.closeRate)} close</span>
              </span>
            ) : null}
          </div>
          <FunnelViz stages={funnel.stages} muted={!funnel.hasData} />
          <p className="mt-3 text-[11px] text-muted">
            {funnel.hasData ? "Leads → Appointments → Proposals → Closed. Each stage narrows; the % shows how many advanced." : "Enter your activity above and the funnel fills in — Leads → Appointments → Proposals → Closed."}
          </p>
          {funnel.hasData ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatChip label="Close rate" value={pct(rates.totalClosingPct)} />
              <StatChip label="Avg job value" value={money(rates.avgTcJobPrice)} />
              <StatChip label="Proposals / lead" value={qty(rates.proposalsPerProspect)} />
              <StatChip label="Termite close" value={pct(rates.tcClosingPct)} />
            </div>
          ) : null}
        </div>
      </Card>

      {/* ───────── STEP 2 — Set this month's goal + pace + game plan ───────── */}
      <Card className={`p-4 sm:p-5 ${ready ? "ring-1 ring-brand-300" : ""}`} id="step-goal">
        <div className="mb-1 flex items-center gap-2">
          {stepBadge(2, steps[1].done)}
          <h2 className="text-base font-semibold text-ink">Set this month&apos;s goal</h2>
        </div>
        <p className="mb-4 text-xs text-muted">Pick your target (up to {money(GOAL_MAX)}) and your workdays. The slider colors as you aim higher; the speedometer colors by your <span className="font-medium text-ink">real</span> pace once results come in.</p>

        <div className="grid gap-4 sm:grid-cols-5 sm:items-stretch">
          {/* Goal slider + workdays */}
          <div className="rounded-xl border border-line bg-white/60 p-4 sm:col-span-3">
            {canEdit ? (
              <GoalSlider
                id="salesGoal"
                label="Sales goal this month"
                value={v.salesGoal}
                onChange={(n) => set("salesGoal", String(n))}
                min={0}
                max={GOAL_MAX}
                step={500}
                format={(n) => money(n)}
              />
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-light text-ink">Sales goal this month</span>
                <span className="text-2xl font-semibold tabular-nums text-ink">{money(v.salesGoal)}</span>
              </div>
            )}
            {canEdit && v.salesGoal === 0 ? (
              <p className="mt-2 text-[11px] text-muted">Drag to set your target — most advisors aim for $40,000&ndash;$60,000 a month.</p>
            ) : null}

            <label className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink">Workdays this month<span className="ml-1 text-[11px] font-normal text-muted">(e.g. 20)</span></span>
              <div className="w-24">{numInput("workdays", "count")}</div>
            </label>
          </div>

          {/* Pace gauge — truthful color, driven by projected close vs goal */}
          <div className="grid place-items-center rounded-xl border border-line bg-white/60 p-4 sm:col-span-2">
            {v.salesGoal > 0 ? (
              <>
                {hasPace ? (
                  <Gauge value={projected} target={v.salesGoal} size={176} format={() => pct(ratio)} label="projected vs goal" showStatus={false} />
                ) : (
                  <div className="grid place-items-center py-2">
                    <ProgressRing value={0} target={100} size={132} stroke={13} tone="#C3DAC9" label="—" ariaLabel="Projected pace — awaiting results" />
                    <div className="mt-1 text-xs text-muted">projected vs goal</div>
                  </div>
                )}
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: paceTextColor }}>{paceWord}</div>
                <div className="mt-2 grid w-full grid-cols-2 gap-2">
                  <div className="rounded-lg border border-line bg-white p-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-muted">Projected</div>
                    <div className="text-sm font-semibold tabular-nums" style={{ color: paceColor }}>{hasPace ? money(projected) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-line bg-white p-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-muted">Goal</div>
                    <div className="text-sm font-semibold tabular-nums text-ink">{money(v.salesGoal)}</div>
                  </div>
                </div>
                <p className="mt-2 text-center text-[11px] leading-snug text-muted">
                  {hasPace
                    ? <>From <span className="font-medium text-ink">{money(paceSignal.closedSoFar)}</span> closed so far at today&rsquo;s run-rate. The color tracks real pace — not the goal you set.</>
                    : <>Your live closed $ drives this once results are in. Dragging the goal won&rsquo;t fake the color.</>}
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-xs text-muted">Set a goal to see your pace projection.</p>
            )}
          </div>
        </div>

        {/* The game plan — tied straight to the goal */}
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
          <h3 className="text-sm font-semibold text-ink">Your daily game plan</h3>
          {!ready ? (
            <p className="mt-1 text-sm text-muted">Enter last month&rsquo;s results and set this month&rsquo;s goal, and your daily plan appears here.</p>
          ) : (
            <>
              <p className="mb-3 mt-1 text-sm text-ink">
                To hit <span className="font-semibold">{money(v.salesGoal)}</span> in <span className="font-semibold">{v.workdays}</span> workdays, each day aim for about{" "}
                <span className="font-semibold tabular-nums text-brand-700">{qty(plan.prospectsPerDay)}</span> leads →{" "}
                <span className="font-semibold tabular-nums text-brand-700">{qty(plan.proposalsPerDay)}</span> proposals →{" "}
                <span className="font-semibold tabular-nums text-brand-700">{money(plan.exposurePerDay)}</span> proposed.
              </p>
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Big label="Sales / day" value={money(plan.salesPerDay)} hero />
                <Big label="Proposals / day" value={qty(plan.proposalsPerDay)} sub={`${qty(plan.totalProposals)} this month`} />
                <Big label="Leads / day" value={qty(plan.prospectsPerDay)} sub={`${qty(plan.prospectsNeeded)} this month`} />
                <Big label="$ proposed / day" value={money(plan.exposurePerDay)} sub={`${money(plan.exposureDollarsNeeded)} this month`} />
              </div>
              {hasPace ? (
                <div className="mt-4">
                  <AchievementBar
                    label="Where you are vs. this month's goal"
                    value={projected}
                    target={v.salesGoal}
                    caption={`Projected ${money(projected)} of ${money(v.salesGoal)} · ${paceWord}`}
                    milestones={[{ at: 25 }, { at: 50 }, { at: 75 }]}
                  />
                </div>
              ) : null}
              {stretch ? (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <strong>Reality check:</strong> {qty(plan.prospectsPerDay)} leads a day is a heavy load. Either raise your average job value by cross-selling more services, lift your close rate, or adjust the goal so the plan is realistic.
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Doesn't look realistic? Hard-code your own targets and ask your director to sign off. */}
        {canEdit && viewerRole === "advisor" ? (
          <div className={`mt-4 rounded-xl border p-4 ${stretch ? "border-amber-300 bg-amber-50/60" : "border-line bg-white/60"}`}>
            <button type="button" onClick={() => setOvOpen((o) => !o)} aria-expanded={ovOpen} className="flex w-full items-center justify-between gap-2 text-left">
              <span className="text-sm font-medium text-ink">{stretch ? "This plan is a stretch — set your own targets instead?" : "Prefer to set your own targets & get sign-off?"}</span>
              <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${ovOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {ovOpen ? (
              <div className="mt-3">
                <p className="mb-3 text-xs text-muted">Enter the monthly numbers you&rsquo;re committing to, then send them to your Sales Director for sign-off. They&rsquo;ll see your goal, roadmap, and notes alongside these targets.</p>
                <div className="grid grid-cols-3 gap-2">
                  {ovInput("Leads / mo", ov.leadsGoal, (n) => setOv((s) => ({ ...s, leadsGoal: n })))}
                  {ovInput("Proposals / mo", ov.proposalsGoal, (n) => setOv((s) => ({ ...s, proposalsGoal: n })))}
                  {ovInput("Deals / mo", ov.dealsGoal, (n) => setOv((s) => ({ ...s, dealsGoal: n })))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={requestApproval} disabled={busy} className={btn.primary}>{busy ? "Sending…" : "Request Sales Director approval"}</button>
                  {status === "advisor_requested" ? <span className="text-xs font-medium text-amber-700">Awaiting your Sales Director&rsquo;s approval.</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* ───────── STEP 3 — This month's focus (initiatives) ───────── */}
      <Card className="p-4 sm:p-5" id="step-initiatives">
        <div className="mb-1 flex items-center gap-2">
          {stepBadge(3, steps[2].done)}
          <h2 className="text-base font-semibold text-ink">What will you focus on this month?</h2>
        </div>
        <p className="mb-4 text-xs text-muted">Pick the initiatives you&rsquo;ll lean on to hit your goal. Tap to select — add your own if you have one.</p>

        <div className="flex flex-wrap gap-2">
          {INITIATIVE_OPTIONS.map((label) => {
            const on = initiatives.includes(label);
            return (
              <button
                key={label}
                type="button"
                disabled={!canEdit}
                onClick={() => toggleInit(label)}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${on ? "border-brand-400 bg-brand-50 text-brand-800" : "border-line bg-white text-ink hover:bg-black/[0.02]"}`}
              >
                <span className={`grid h-4 w-4 place-items-center rounded-full border ${on ? "border-brand-500 bg-brand-500 text-white" : "border-line"}`}>
                  {on ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg> : null}
                </span>
                {label}
              </button>
            );
          })}
          {/* Custom initiatives the advisor added */}
          {initiatives.filter((i) => !INITIATIVE_OPTIONS.includes(i)).map((label) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full border border-brand-400 bg-brand-50 px-3.5 py-2 text-sm font-medium text-brand-800">
              {label}
              {canEdit ? <button type="button" onClick={() => toggleInit(label)} className="text-brand-600 hover:text-brand-900" aria-label={`Remove ${label}`}>×</button> : null}
            </span>
          ))}
        </div>

        {canEdit ? (
          <div className="mt-3 flex gap-2">
            <input
              value={customInit}
              onChange={(e) => setCustomInit(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomInit(); } }}
              placeholder="Add another focus…"
              className="w-full max-w-xs rounded-lg border border-line px-3 py-2 text-sm"
            />
            <button type="button" onClick={addCustomInit} className={btn.secondary}>Add</button>
          </div>
        ) : null}
      </Card>

      {/* ───────── STEP 4 — Notes for the Sales Director ───────── */}
      <Card className="p-4 sm:p-5" id="step-notes">
        <div className="mb-1 flex items-center gap-2">
          {stepBadge(4, steps[3].done)}
          <h2 className="text-base font-semibold text-ink">Notes for your Sales Director</h2>
        </div>
        <p className="mb-3 text-xs text-muted">Anything you want to talk through this month — wins, roadblocks, support you need. Your Sales Director sees this on your sheet.</p>
        <textarea
          value={notes}
          disabled={!canEdit}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="e.g. Need help with two big termite bids · want to join the Tuesday BNI group · truck in the shop next week"
          className="w-full rounded-lg border border-line px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-50"
        />
      </Card>

      {/* ───────── Director co-goal-setting ───────── */}
      {viewerRole === "director" && canEdit ? (
        <Card className="p-4 ring-1 ring-brand-200 sm:p-5">
          <div className="mb-1 flex items-center gap-2">
            {/* target glyph (not a cross) */}
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></svg>
            <h2 className="text-base font-semibold text-ink">Propose a goal</h2>
          </div>
          <p className="mb-4 text-xs text-muted">
            Set a goal alongside {advisorName ?? "the advisor"} — it won&apos;t overwrite their sheet. They&apos;ll see your proposal and can accept it.
            {proposal.proposedGoal != null ? <> Current proposal: <span className="font-medium text-ink tabular-nums">{money(proposal.proposedGoal)}</span>{status === "agreed" ? " (accepted)" : ""}.</> : null}
          </p>
          <div className="rounded-xl border border-line bg-white/60 p-4">
            <GoalSlider
              id="proposeGoal"
              label="Proposed goal"
              value={proposeVal}
              onChange={setProposeVal}
              min={0}
              max={GOAL_MAX}
              step={500}
              format={(n) => money(n)}
            />
            <p className="mt-2 text-[11px] text-muted">
              {hasPace
                ? <>At their current pace they project <span className="font-medium text-ink">{money(projected)}</span> — this proposal would be <span className="font-medium" style={{ color: rampTextColor(Math.min(100, paceRatio(projected, proposeVal) * 100)) }}>{paceStatusWord(paceRatio(projected, proposeVal)).toLowerCase()}</span>.</>
                : <>Pick a realistic figure; once results are in, the pace color shows whether it&rsquo;s on track.</>}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={propose} disabled={busy} className={btn.secondary}>{busy ? "Working…" : "Propose to advisor"}</button>
            {proposal.proposedGoal != null && status !== "agreed" ? (
              <button onClick={accept} disabled={busy} className={btn.primary}>Accept on their behalf</button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Save */}
      {canEdit ? (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 rounded-xl bg-canvas/80 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-canvas/70">
          <button onClick={save} disabled={busy} className={`${btn.primary}`}>{busy ? "Saving…" : "Save goal sheet"}</button>
          {msg ? <span className={`text-sm ${err ? "text-red-600" : "text-brand-700"}`}>{msg}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-muted">Read-only view.</p>
      )}
    </div>
  );
}

// A visual, tapering sales funnel — each stage a centered bar whose width rides on
// the stage's size, with the conversion % to the next stage shown between bars.
// `muted` renders a greyed skeleton (fixed taper, "—" values) before any results.
function FunnelViz({ stages, muted = false }: { stages: FStage[]; muted?: boolean }) {
  const maxSize = Math.max(1, ...stages.map((s) => s.size));
  const SKELETON_W = [100, 82, 64, 50];
  return (
    <div role="list" aria-label="Sales funnel" className="space-y-1">
      {stages.map((s, i) => {
        // Live: taper 100%→55% by size. Skeleton: a fixed, evenly tapering shape.
        const w = muted ? SKELETON_W[i] : Math.round(55 + 45 * (s.size / maxSize));
        const bg = muted ? "#CBD8CE" : s.color;
        return (
          <div key={s.key} role="listitem">
            <div
              className={`mx-auto flex items-center justify-between gap-3 rounded-xl px-4 py-3 shadow-sm ${muted ? "text-slate-500" : "text-white"}`}
              style={{ width: `${w}%`, minWidth: 160, background: bg }}
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-95">{s.label}</div>
                {s.sub ? <div className="truncate text-[10px] opacity-85">{s.sub}</div> : null}
              </div>
              <div className="shrink-0 text-xl font-semibold tabular-nums">{muted ? "—" : s.display}</div>
            </div>
            {i < stages.length - 1 ? (
              <div className="flex items-center justify-center py-1" aria-hidden>
                <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-muted">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
                  {muted ? "—" : <>{pct(s.convToNext ?? 0)} {s.convLabel}</>}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-2.5 text-center">
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Big({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${hero ? "border-brand-300 bg-white" : "border-line bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${hero ? "text-2xl text-brand-700" : "text-xl text-ink"}`}>{value}</div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
