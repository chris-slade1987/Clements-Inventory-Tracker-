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

// A friendly, plain-language rebuild of the Sales Director's Excel goal sheet.
// Redesigned as a guided, confident flow (not a dense form): it leads with the
// decision + the outcomes — this month's GOAL and its truthful pace, then the
// visual sales FUNNEL (Leads → Appointments → Proposals → Closed $) tied straight
// to the daily GAME PLAN ("to hit $X: ~N leads → ~M proposals a day"). The detailed
// last-month inputs (activity + the pest/termite $ breakdown) are tucked into a
// collapsible "Last month's details" section so the first screen isn't a wall of
// inputs. The pace speedometer + goal-slider color are driven by the advisor's
// REAL on-track pace (projected month-end close vs goal) — dragging the goal can
// never fake a green reading. The Sales Director can also propose a goal.

const pct = (r: number) => `${Math.round((r || 0) * 100)}%`;
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

type PaceSignal = { closedSoFar: number; priorClose: number; paceFrac: number; hasActuals: boolean };
type Proposal = { proposedGoal: number | null; goalStatus: string | null; proposedByName: string | null };

const STATUS_LABEL: Record<string, string> = {
  advisor_set: "Advisor set",
  director_proposed: "Director proposed",
  agreed: "Agreed",
};
const STATUS_TONE: Record<string, string> = {
  advisor_set: "bg-brand-50 text-brand-700 border-brand-200",
  director_proposed: "bg-amber-50 text-amber-800 border-amber-200",
  agreed: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

type Field = { key: keyof GoalSheetInput; label: string; help: string; kind: "count" | "money" };

// Funnel-first inputs: the activity counts that build the funnel…
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

const FUNNEL_COLOR: Record<string, string> = {
  leads: "#74A96E", appts: "#4F8A5F", proposals: "#2E6F47", closed: "#15B85C",
};

type FStage = { key: string; label: string; display: string; sub: string; size: number; value: number; color: string; convToNext: number | null; convLabel: string };

export default function GoalPlanner({
  periodKey, periodLabelText, advisorEmployeeId, advisorName, initial, canEdit,
  viewerRole = "advisor",
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
  paceSignal?: PaceSignal;
  proposal?: Proposal;
}) {
  const router = useRouter();
  const [v, setV] = useState<GoalSheetInput>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [proposeVal, setProposeVal] = useState<number>(proposal.proposedGoal ?? (initial.salesGoal > 0 ? initial.salesGoal : 50000));

  const set = (k: keyof GoalSheetInput, val: string) => setV((s) => ({ ...s, [k]: val === "" ? 0 : Number(val) }));

  const { rates, plan } = useMemo(() => {
    const r = deriveRates(v);
    return { rates: r, plan: buildPlan(r, { salesGoal: v.salesGoal, workdays: v.workdays }) };
  }, [v]);

  // ── The funnel: Leads → Appointments → Proposals → Closed $ ──────────────
  const funnel = useMemo(() => {
    const leads = v.leads || 0;
    const appts = (v.reis || 0) + (v.appts || 0);
    const proposals = v.proposals || 0;
    const closedAmt = (v.pcSold || 0) + (v.tcSold || 0);
    const proposedAmt = v.totalExposure || 0;
    const closeRate = rates.totalClosingPct; // $ closed / $ proposed
    // "Closed" taper size rides on the count scale so the funnel narrows sensibly.
    const wonSize = proposals * (closeRate || 0);
    const all: FStage[] = [
      { key: "leads", label: "Leads", display: qty(leads), sub: "opportunities worked", size: leads, value: leads, color: FUNNEL_COLOR.leads, convToNext: div(appts, leads), convLabel: "became appointments" },
      { key: "appts", label: "Appointments", display: qty(appts), sub: "ReIs + appointments run", size: appts, value: appts, color: FUNNEL_COLOR.appts, convToNext: div(proposals, appts), convLabel: "got a proposal" },
      { key: "proposals", label: "Proposals", display: qty(proposals), sub: `${money(proposedAmt)} proposed`, size: proposals, value: proposals, color: FUNNEL_COLOR.proposals, convToNext: closeRate, convLabel: "close rate ($)" },
      { key: "closed", label: "Closed", display: money(closedAmt), sub: `from ${money(proposedAmt)} proposed`, size: wonSize, value: closedAmt, color: FUNNEL_COLOR.closed, convToNext: null, convLabel: "" },
    ];
    // Start the funnel at the first stage that actually has data (e.g. skip Leads
    // if the advisor hasn't tracked them yet) — never show a dead top segment.
    const firstReal = all.findIndex((s) => s.value > 0);
    const shown = firstReal === -1 ? [] : all.slice(firstReal);
    return { shown, leads, appts, proposals, closedAmt, proposedAmt, closeRate, hasData: firstReal !== -1 };
  }, [v, rates]);

  // Last month's inputs (the collapsible). Open by default when there's nothing
  // entered yet (so a first-timer is guided straight to it); collapsed once the
  // funnel has data so returning advisors see the outcomes first.
  const [detailsOpen, setDetailsOpen] = useState(!funnel.hasData);

  // REAL on-track pace (projected month-end close is fixed by actuals; the goal
  // slider never moves it — so a higher goal can't fake a green reading).
  const projected = useMemo(() => projectMonthEndClose(paceSignal), [paceSignal]);
  const ratio = paceRatio(projected, v.salesGoal);
  const hasPace = paceSignal.hasActuals && v.salesGoal > 0;
  const pacePct = Math.min(100, ratio * 100);
  const paceColor = hasPace ? rampColor(pacePct) : "#9BB0A4";
  const paceTextColor = hasPace ? rampTextColor(pacePct) : "#5C6B62";
  const paceWord = hasPace ? paceStatusWord(ratio) : "Awaiting results";

  const propRatio = paceRatio(projected, proposeVal);
  const propHasPace = paceSignal.hasActuals && proposeVal > 0;
  const propColor = propHasPace ? rampColor(Math.min(100, propRatio * 100)) : "#9BB0A4";
  const propWord = propHasPace ? paceStatusWord(propRatio) : "Set a figure";

  const ready = v.salesGoal > 0 && v.workdays > 0 && rates.tcClosingPct > 0 && rates.exposurePerProposal > 0 && rates.proposalsPerProspect > 0;
  const stretch = ready && plan.prospectsPerDay > 8;

  const status = proposal.goalStatus;
  const showProposalBanner = viewerRole === "advisor" && proposal.proposedGoal != null && status === "director_proposed";

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

  const save = () => post({ ...v }, "Saved.");
  const propose = () => post({ action: "propose", proposedGoal: proposeVal }, "Goal proposed to the advisor.");
  const accept = async () => {
    if (await post({ action: "accept" }, "Proposal accepted — it's now your goal.")) {
      if (proposal.proposedGoal != null) setV((s) => ({ ...s, salesGoal: proposal.proposedGoal as number }));
    }
  };

  // Jump to — and open — the last-month inputs (used by the empty-state CTAs).
  const openDetails = () => {
    setDetailsOpen(true);
    requestAnimationFrame(() => document.getElementById("last-month-details")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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

  const fieldLabel = (f: Field) => (
    <label key={f.key} className="block text-sm">
      <span className="font-medium text-ink">{f.label}</span>
      <span className="mb-1 mt-0.5 block text-[11px] leading-snug text-muted">{f.help}</span>
      {numInput(f.key, f.kind)}
    </label>
  );

  const stepBadge = (n: number) => (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>
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

      {/* ───────── STEP 1 — This month's goal + truthful pace (the lead) ───────── */}
      <Card className="p-4 sm:p-5">
        <div className="mb-1 flex items-center gap-2">
          {stepBadge(1)}
          <h2 className="text-base font-semibold text-ink">Set this month&apos;s goal</h2>
        </div>
        <p className="mb-4 text-xs text-muted">Pick your target for {periodLabelText} and how many days you&rsquo;ll work. The speedometer colors by your real pace once results come in.</p>

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
                max={150000}
                step={500}
                format={(n) => money(n)}
                accentColor={paceColor}
                statusWord={paceWord}
              />
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-light text-ink">Sales goal this month</span>
                <span className="text-2xl font-semibold tabular-nums text-ink">{money(v.salesGoal)}</span>
              </div>
            )}
            {canEdit && v.salesGoal === 0 ? (
              <p className="mt-2 text-[11px] text-muted">Drag to set your target — most advisors aim for $50,000+ a month.</p>
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
                    <ProgressRing value={0} target={100} size={132} stroke={13} tone="#C3DAC9" label="—" />
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
      </Card>

      {/* ───────── STEP 2 — Your funnel & the daily game plan (outcomes) ───────── */}
      <Card className={`p-4 sm:p-5 ${ready ? "ring-1 ring-brand-300" : ""}`}>
        <div className="mb-1 flex items-center gap-2">
          {stepBadge(2)}
          <h2 className="text-base font-semibold text-ink">Your funnel &amp; game plan</h2>
        </div>
        <p className="mb-4 text-xs text-muted">Last month&rsquo;s funnel (your whole book — pest + termite) turns into exactly what it takes to hit this month&rsquo;s goal.</p>

        {/* The funnel — last month's story, lead to close */}
        {funnel.hasData ? (
          <>
            {funnel.proposedAmt > 0 ? (
              <div className="mb-3 text-xs text-muted">
                <span className="font-medium text-ink tabular-nums">{money(funnel.closedAmt)}</span> closed from{" "}
                <span className="tabular-nums">{money(funnel.proposedAmt)}</span> proposed ·{" "}
                <span className="font-semibold" style={{ color: rampTextColor(funnel.closeRate * 100) }}>{pct(funnel.closeRate)} close</span>
              </div>
            ) : null}
            <FunnelViz stages={funnel.shown} />
            <p className="mt-3 text-[11px] text-muted">Each stage narrows to the next; the % shows how many advanced.</p>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-black/[0.015] px-4 py-6 text-center">
            <p className="text-sm text-muted">Enter last month&rsquo;s activity and your funnel — leads → appointments → proposals → closed — appears here.</p>
            {canEdit ? <button onClick={openDetails} className={`${btn.secondary} mt-3`}>Add last month&rsquo;s results</button> : null}
          </div>
        )}

        {/* Your numbers (derived) — a compact strip so the plan's inputs are visible */}
        {funnel.hasData ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label="Close rate" value={pct(rates.totalClosingPct)} />
            <StatChip label="Avg job value" value={money(rates.avgTcJobPrice)} />
            <StatChip label="Proposals / lead" value={qty(rates.proposalsPerProspect)} />
            <StatChip label="Termite close" value={pct(rates.tcClosingPct)} />
          </div>
        ) : null}

        {/* The game plan — tied straight to the goal */}
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
          <h3 className="text-sm font-semibold text-ink">Your daily game plan</h3>
          {!ready ? (
            <p className="mt-1 text-sm text-muted">Set this month&rsquo;s goal above and enter last month&rsquo;s results, and your daily plan appears here.</p>
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
      </Card>

      {/* ───────── Last month's details — the inputs (collapsible) ───────── */}
      <Card className="overflow-hidden p-0" id="last-month-details">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"
        >
          {stepBadge(3)}
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">Last month&rsquo;s results</span>
            <span className="block truncate text-[11px] text-muted">
              {funnel.hasData
                ? <>{qty(funnel.leads)} leads · {qty(funnel.proposals)} proposals · {money(funnel.closedAmt)} closed — tap to {detailsOpen ? "hide" : "edit"}</>
                : "Enter what actually happened — it builds your funnel and learns your personal numbers."}
            </span>
          </span>
          <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {detailsOpen ? (
          <div className="border-t border-line px-4 pb-5 pt-4 sm:px-5">
            <p className="mb-4 text-xs text-muted">No guessing — enter last month&rsquo;s actuals. The more accurate they are, the better your plan.</p>

            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Activity</div>
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              {ACTIVITY_FIELDS.map(fieldLabel)}
            </div>

            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Dollars</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {DOLLAR_FIELDS.map(fieldLabel)}
            </div>
          </div>
        ) : null}
      </Card>

      {/* ───────── Director co-goal-setting ───────── */}
      {viewerRole === "director" && canEdit ? (
        <Card className="p-4 ring-1 ring-brand-200 sm:p-5">
          <div className="mb-1 flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v18M5 8h14M7 13h10" /></svg>
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
              max={150000}
              step={500}
              format={(n) => money(n)}
              accentColor={propColor}
              statusWord={propWord}
            />
            <p className="mt-2 text-[11px] text-muted">
              {propHasPace
                ? <>At their current pace they project <span className="font-medium text-ink">{money(projected)}</span> — this proposal would be <span className="font-medium" style={{ color: propColor }}>{propWord.toLowerCase()}</span>.</>
                : <>Pick a realistic figure; once results are in, the color shows whether it&rsquo;s on pace.</>}
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
function FunnelViz({ stages }: { stages: FStage[] }) {
  const maxSize = Math.max(1, ...stages.map((s) => s.size));
  return (
    <div role="list" aria-label="Sales funnel" className="space-y-1">
      {stages.map((s, i) => {
        // Taper from 100% (largest stage) down to ~55% (smallest), so the funnel
        // always narrows visibly while every bar stays wide enough to read on a phone.
        const w = Math.round(55 + 45 * (s.size / maxSize));
        return (
          <div key={s.key} role="listitem">
            <div
              className="mx-auto flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-white shadow-sm"
              style={{ width: `${w}%`, minWidth: 160, background: s.color }}
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-95">{s.label}</div>
                {s.sub ? <div className="truncate text-[10px] opacity-85">{s.sub}</div> : null}
              </div>
              <div className="shrink-0 text-xl font-semibold tabular-nums">{s.display}</div>
            </div>
            {i < stages.length - 1 ? (
              <div className="flex items-center justify-center py-1" aria-hidden>
                <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-muted">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
                  {pct(s.convToNext ?? 0)} {s.convLabel}
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
