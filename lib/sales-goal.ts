// Monthly sales goal planner — a faithful port of the Sales Director's
// "Clements Monthly Sales Goal Sheet" (Excel). A service advisor enters last
// month's recap and this month's sales goal + workdays; we derive their
// personal conversion rates and the daily activity targets needed to hit goal.
//
// Terminology (pest-control sales):
//   ReI = real-estate re-inspection · Appt = appointment · Prospect = ReI+Appt
//   PC = pest control · TC = termite control · Exposure = $ presented/proposed
//
// Every ratio matches the workbook's IFERROR(…,0): divide-by-zero yields 0.

/** Safe divide — mirrors Excel IFERROR(a/b, 0). */
function div(a: number, b: number): number {
  if (!b || !Number.isFinite(a / b)) return 0;
  return a / b;
}

/** Prior-month recap — the light-green input cells (row 10). */
export type RecapInputs = {
  leads: number;         // total leads/opportunities worked (top of the funnel)
  reis: number;          // A10 — Total Number of ReIs
  appts: number;         // C10 — Total number of Appts
  proposals: number;     // E10 — Total number of Proposals
  pcExposed: number;     // G10 — Total $ PC Exposed
  pcSold: number;        // I10 — Total $ PC Sold
  tcSold: number;        // K10 — Total $ TC Sold
  totalExposure: number; // M10 — Total Exposure $
  tcUnits: number;       // O10 — TC Units sold
};

/** This month's goal inputs. */
export type GoalInputs = {
  salesGoal: number;     // E19 — Total sales needed this month ($)
  workdays: number;      // I19 — # workdays in the month
};

/** Everything a goal sheet stores (recap + goal). */
export type GoalSheetInput = RecapInputs & GoalInputs;

/** Derived personal rates (row 14). */
export type DerivedRates = {
  prospects: number;            // A14 = reis + appts
  proposalsPerProspect: number; // C14 = proposals / prospects
  reiGoalPct: number;           // E14 = reis / 40 (target of 40 ReIs)
  avgTcJobPrice: number;        // G14 = tcSold / tcUnits
  exposurePerProposal: number;  // I14 = (totalExposure - pcExposed) / proposals
  totalClosingPct: number;      // K14 = (pcSold + tcSold) / totalExposure
  pcClosingPct: number;         // M14 = pcSold / pcExposed
  tcClosingPct: number;         // O14 = tcSold / (totalExposure - pcExposed)
};

/** The activity plan the advisor works to (rows 19–43). */
export type GoalPlan = {
  salesPerDay: number;          // K19 = salesGoal / workdays
  tcDollarsNeeded: number;      // E23 = salesGoal
  exposureDollarsNeeded: number;// K23 = tcDollarsNeeded / tcClosingPct
  exposurePerDay: number;       // K27 = exposureDollarsNeeded / workdays
  totalProposals: number;       // K31 = exposureDollarsNeeded / exposurePerProposal
  proposalsPerDay: number;      // K35 = totalProposals / workdays
  prospectsNeeded: number;      // K39 = totalProposals / proposalsPerProspect
  prospectsPerDay: number;      // K43 = prospectsNeeded / workdays
};

/** Personal conversion rates from last month's recap (row 14 of the sheet). */
export function deriveRates(r: RecapInputs): DerivedRates {
  const prospects = (r.reis || 0) + (r.appts || 0);
  const tcExposure = (r.totalExposure || 0) - (r.pcExposed || 0);
  return {
    prospects,
    proposalsPerProspect: div(r.proposals, prospects),
    reiGoalPct: div(r.reis, 40),
    avgTcJobPrice: div(r.tcSold, r.tcUnits),
    exposurePerProposal: div(tcExposure, r.proposals),
    totalClosingPct: div((r.pcSold || 0) + (r.tcSold || 0), r.totalExposure),
    pcClosingPct: div(r.pcSold, r.pcExposed),
    tcClosingPct: div(r.tcSold, tcExposure),
  };
}

/** The daily/monthly activity plan needed to hit this month's goal. */
export function buildPlan(rates: DerivedRates, goal: GoalInputs): GoalPlan {
  const salesGoal = goal.salesGoal || 0;
  const workdays = goal.workdays || 0;
  const tcDollarsNeeded = salesGoal;
  const exposureDollarsNeeded = div(tcDollarsNeeded, rates.tcClosingPct);
  const totalProposals = div(exposureDollarsNeeded, rates.exposurePerProposal);
  const prospectsNeeded = div(totalProposals, rates.proposalsPerProspect);
  return {
    salesPerDay: div(salesGoal, workdays),
    tcDollarsNeeded,
    exposureDollarsNeeded,
    exposurePerDay: div(exposureDollarsNeeded, workdays),
    totalProposals,
    proposalsPerDay: div(totalProposals, workdays),
    prospectsNeeded,
    prospectsPerDay: div(prospectsNeeded, workdays),
  };
}

export function computeGoalSheet(recap: RecapInputs, goal: GoalInputs) {
  const rates = deriveRates(recap);
  return { rates, plan: buildPlan(rates, goal) };
}

export const EMPTY_RECAP: RecapInputs = {
  leads: 0, reis: 0, appts: 0, proposals: 0, pcExposed: 0, pcSold: 0, tcSold: 0, totalExposure: 0, tcUnits: 0,
};

// ---------------------------------------------------------------------------
// On-track PACE — project the month-end close from real actuals, so the goal
// sheet colors by whether the plan is realistically on pace (projected vs goal)
// rather than by where the goal slider's thumb happens to sit. Pure + testable.
// ---------------------------------------------------------------------------

/** The live signal needed to project a month-end close. */
export type PaceInput = {
  closedSoFar: number; // $ closed so far this month (actuals-to-date)
  priorClose: number;  // $ closed last month (a prior anchor; 0 if unknown)
  paceFrac: number;    // fraction of the month elapsed (0..1); 1 = month over
};

/**
 * Project this month's final closed $ by blending the current run-rate with
 * last month's close as a prior. Early in the month the run-rate is noisy, so we
 * lean on last month; as the month fills in we trust the run-rate. Weight on the
 * run-rate = fraction of the month elapsed.
 *   runRate   = closedSoFar / paceFrac          (linear extrapolation)
 *   projected = paceFrac·runRate + (1−paceFrac)·priorClose
 * With no prior to blend, the run-rate stands alone; a completed month returns
 * the actual close; a not-yet-started month returns the prior.
 */
export function projectMonthEndClose(input: PaceInput): number {
  const pace = Math.min(1, Math.max(0, input.paceFrac || 0));
  const closed = Math.max(0, input.closedSoFar || 0);
  const prior = Math.max(0, input.priorClose || 0);
  if (pace >= 0.999) return closed;   // month complete — the actual is the result
  if (pace <= 0) return prior;        // month not started — last month is the best estimate
  const runRate = closed / pace;      // extrapolate today's rate across the month
  if (prior <= 0) return runRate;     // nothing to blend against
  return pace * runRate + (1 - pace) * prior;
}

/** Projected close as a fraction of the goal (projected ÷ goal). 0 if no goal. */
export function paceRatio(projected: number, goal: number): number {
  return goal > 0 ? Math.max(0, projected) / goal : 0;
}

/**
 * A truthful, encouraging word for an on-track pace ratio (projected ÷ goal).
 * The color ramp carries the behind/watch/on signal; the words stay positive
 * (brand kit §12: encourage, don't guilt).
 */
export function paceStatusWord(ratio: number): string {
  if (ratio >= 1.05) return "Ahead of goal";
  if (ratio >= 0.98) return "On track";
  if (ratio >= 0.85) return "Nearly on pace";
  if (ratio >= 0.6) return "Climbing";
  if (ratio >= 0.3) return "Building momentum";
  if (ratio > 0) return "Getting started";
  return "Awaiting results";
}

// Clements service lines (from the Pre-list), for goal breakdowns + future
// actual-vs-target once the sales API is connected.
export const PC_SERVICES = [
  "Standard Pest Control", "Mosquito Misting", "Mosquito Spraying", "Wildlife Trapping", "Exclusion", "Lawn",
] as const;
export const TC_SERVICES = [
  "Drywood Alternative", "Sentricon", "Full Liquid", "Fumigation", "Insulation",
] as const;
