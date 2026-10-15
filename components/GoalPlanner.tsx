"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { money, qty } from "@/lib/format";
import {
  deriveRates, buildPlan, projectMonthEndClose, paceRatio, paceStatusWord, type GoalSheetInput,
} from "@/lib/sales-goal";
import GoalSlider from "@/components/GoalSlider";
import { Gauge, ProgressRing, AchievementBar, KpiMeter, rampColor, rampTextColor } from "@/components/motivation";

// A friendly, plain-language rebuild of the Sales Director's Excel goal sheet.
// Two steps — last month's results, then this month's goal — and a live "game
// plan" that shows exactly how many leads/proposals/day it takes. The plan now
// reads as MOMENTUM, not a form: a speedometer + rings + sliders driven by the
// advisor's REAL on-track pace (projected month-end close vs goal), so the signal
// color tells the truth about whether the plan is on pace — not where the slider
// thumb sits. The Sales Director can also propose a goal alongside the advisor's.

const pct = (r: number) => `${Math.round((r || 0) * 100)}%`;

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

const RECAP_FIELDS: Field[] = [
  { key: "reis", label: "Real-estate re-inspections (ReIs)", help: "Homes you inspected for a real-estate sale.", kind: "count" },
  { key: "appts", label: "Appointments", help: "Other sales appointments you ran.", kind: "count" },
  { key: "proposals", label: "Proposals given", help: "How many quotes/proposals you presented.", kind: "count" },
  { key: "pcExposed", label: "Pest-control $ proposed", help: "Total pest-control dollars you quoted.", kind: "money" },
  { key: "pcSold", label: "Pest-control $ sold", help: "Pest-control dollars that closed.", kind: "money" },
  { key: "totalExposure", label: "Total $ proposed (pest + termite)", help: "Every dollar you quoted last month.", kind: "money" },
  { key: "tcSold", label: "Termite $ sold", help: "Termite dollars that closed.", kind: "money" },
  { key: "tcUnits", label: "Termite jobs sold", help: "Number of termite jobs closed (a count).", kind: "count" },
];

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

  // REAL on-track pace. `projected` is the month-end close extrapolated from
  // actuals (fixed — it does NOT move when the goal slider moves). `ratio` =
  // projected ÷ goal drives the signal color, so dragging the goal UP can never
  // turn the bar green on its own — only real closed $ relative to the goal does.
  const projected = useMemo(() => projectMonthEndClose(paceSignal), [paceSignal]);
  const ratio = paceRatio(projected, v.salesGoal);
  const hasPace = paceSignal.hasActuals && v.salesGoal > 0;
  const pacePct = Math.min(100, ratio * 100);
  const paceColor = hasPace ? rampColor(pacePct) : "#9BB0A4";
  const paceTextColor = hasPace ? rampTextColor(pacePct) : "#5C6B62";
  const paceWord = hasPace ? paceStatusWord(ratio) : "Awaiting results";

  // The director's proposed goal, judged against the advisor's REAL pace too.
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

  const numInput = (k: keyof GoalSheetInput, kind: "count" | "money") => (
    <div className="relative">
      {kind === "money" ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span> : null}
      <input
        type="number" inputMode={kind === "money" ? "decimal" : "numeric"} min={0}
        disabled={!canEdit}
        value={v[k] === 0 ? "" : String(v[k])}
        onChange={(e) => set(k, e.target.value)}
        placeholder="0"
        className={`w-full rounded-lg border border-line py-2 text-sm ${kind === "money" ? "pl-7 pr-3" : "px-3"} disabled:bg-slate-50`}
      />
    </div>
  );

  return (
    <div className="space-y-5 max-w-4xl pb-10">
      {/* Header line + goal status chip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {advisorName ? <p className="text-sm text-muted">Goal sheet for <span className="font-medium text-ink">{advisorName}</span> · {periodLabelText}</p> : <span />}
        {status ? (
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[status] ?? "border-line text-muted"}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        ) : null}
      </div>

      {/* ───────── PACE HERO — the speedometer the eye lands on first ───────── */}
      {v.salesGoal > 0 ? (
        <Card className="p-5">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
            <div className="shrink-0">
              {hasPace ? (
                <Gauge
                  value={projected}
                  target={v.salesGoal}
                  size={188}
                  format={() => pct(ratio)}
                  label="projected vs goal"
                  showStatus={false}
                />
              ) : (
                // No closed $ yet — a neutral dial, never a misleading red reading.
                <div className="grid place-items-center">
                  <ProgressRing value={0} target={100} size={150} stroke={14} tone="#C3DAC9" label="—" />
                  <div className="mt-1 text-xs text-muted">projected vs goal</div>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: paceTextColor }}>{paceWord}</div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-line bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Projected month-end</div>
                  <div className="mt-0.5 text-2xl font-semibold tabular-nums" style={{ color: paceColor }}>{hasPace ? money(projected) : "—"}</div>
                </div>
                <div className="rounded-xl border border-line bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Goal</div>
                  <div className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{money(v.salesGoal)}</div>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] text-muted">
                {hasPace
                  ? <>Projected from <span className="font-medium text-ink">{money(paceSignal.closedSoFar)}</span> closed so far at today&rsquo;s run-rate{paceSignal.priorClose > 0 ? <>, blended with last month&rsquo;s <span className="font-medium text-ink">{money(paceSignal.priorClose)}</span></> : null}. The color tracks real pace — not the goal you set.</>
                  : <>Your live closed $ will drive this gauge once the sales feed is connected. For now, build the plan below.</>}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* STEP 1 */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">1</span>
            <h2 className="text-base font-semibold text-ink">Last month&apos;s results</h2>
          </div>
          <p className="text-xs text-muted mb-4">Enter what actually happened last month. We use it to learn your personal numbers — no guessing.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {RECAP_FIELDS.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="font-medium text-ink">{f.label}</span>
                {numInput(f.key, f.kind)}
                <span className="mt-0.5 block text-[11px] text-muted">{f.help}</span>
              </label>
            ))}
          </div>
        </Card>

        {/* STEP 2 */}
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">2</span>
              <h2 className="text-base font-semibold text-ink">This month&apos;s goal</h2>
            </div>
            <p className="text-xs text-muted mb-4">What are you going for this month, and how many days will you work?</p>
            {/* Sales goal — drag to set (motivation kit). The fill + thumb color is
                driven by REAL on-track pace (projected ÷ goal), so a higher goal
                can't turn the bar green on its own. */}
            <div className="rounded-xl border border-line bg-white/60 p-4 mb-3">
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
                  <span className="text-lg font-medium tabular-nums text-ink">{money(v.salesGoal)}</span>
                </div>
              )}
              {/* Projected $ right next to the goal $ — the honest readout. */}
              {v.salesGoal > 0 ? (
                <div className="mt-3">
                  {hasPace ? (
                    <>
                      <KpiMeter label="Projected vs goal" value={projected} target={v.salesGoal} format={(n) => money(n)} />
                      <p className="mt-1.5 text-[11px] text-muted">On pace for <span className="font-medium" style={{ color: paceTextColor }}>{money(projected)}</span> of your {money(v.salesGoal)} goal.</p>
                    </>
                  ) : (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted">Projected vs goal</span>
                      <span className="text-xs text-muted">Awaiting results — dragging the goal won&rsquo;t fake the color.</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted">Drag to set your target — most advisors aim for $50,000+ a month.</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-ink">Workdays this month</span>
                {numInput("workdays", "count")}
                <span className="mt-0.5 block text-[11px] text-muted">e.g. 20</span>
              </label>
            </div>
          </Card>

          {/* Your numbers (derived) — close rates as rings so the strengths pop. */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Your numbers (from last month)</h3>
            <div className="flex flex-wrap items-center justify-around gap-4">
              <RingStat label="Termite close" value={rates.tcClosingPct} />
              <RingStat label="Total close" value={rates.totalClosingPct} />
              <div className="min-w-[8rem] space-y-2">
                <MiniStat label="Avg termite job" value={money(rates.avgTcJobPrice)} />
                <MiniStat label="Proposals per lead" value={qty(rates.proposalsPerProspect)} />
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted">These come straight from last month&apos;s results — the more accurate that is, the better your plan.</p>
          </Card>
        </div>
      </div>

      {/* ───────── Director co-goal-setting ───────── */}
      {viewerRole === "director" && canEdit ? (
        <Card className="p-5 ring-1 ring-brand-200">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v18M5 8h14M7 13h10" /></svg>
            <h2 className="text-base font-semibold text-ink">Propose a goal</h2>
          </div>
          <p className="text-xs text-muted mb-4">
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
          <div className="mt-3 flex items-center gap-3">
            <button onClick={propose} disabled={busy} className={btn.secondary}>{busy ? "Working…" : "Propose to advisor"}</button>
            {proposal.proposedGoal != null && status !== "agreed" ? (
              <button onClick={accept} disabled={busy} className={btn.primary}>Accept on their behalf</button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* GAME PLAN */}
      <Card className={`p-5 ${ready ? "ring-1 ring-brand-300 bg-brand-50/40" : ""}`}>
        <h2 className="text-base font-semibold text-ink mb-1">Your game plan</h2>
        {!ready ? (
          <p className="text-sm text-muted">Fill in last month&apos;s results and this month&apos;s goal above, and your daily plan appears here.</p>
        ) : (
          <>
            <p className="text-sm text-ink mb-4">To hit <span className="font-semibold">{money(v.salesGoal)}</span> in <span className="font-semibold">{v.workdays}</span> workdays, here&apos;s your daily target:</p>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
              <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                <strong>Reality check:</strong> {qty(plan.prospectsPerDay)} leads a day is a heavy load. Either raise your average job value by cross-selling more services, lift your close rate, or adjust the goal so the plan is realistic.
              </p>
            ) : null}
          </>
        )}
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className={`${btn.primary}`}>{busy ? "Saving…" : "Save goal sheet"}</button>
          {msg ? <span className={`text-sm ${err ? "text-red-600" : "text-brand-700"}`}>{msg}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-muted">Read-only view.</p>
      )}
    </div>
  );
}

function RingStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <ProgressRing value={(value || 0) * 100} target={100} size={88} stroke={11} />
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-medium text-ink tabular-nums">{value}</span>
    </div>
  );
}

function Big({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${hero ? "border-brand-300 bg-brand-50/60" : "border-line bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${hero ? "text-2xl text-brand-700" : "text-xl text-ink"}`}>{value}</div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
