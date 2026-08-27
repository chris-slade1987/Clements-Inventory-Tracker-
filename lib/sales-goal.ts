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
  reis: 0, appts: 0, proposals: 0, pcExposed: 0, pcSold: 0, tcSold: 0, totalExposure: 0, tcUnits: 0,
};

// Clements service lines (from the Pre-list), for goal breakdowns + future
// actual-vs-target once the sales API is connected.
export const PC_SERVICES = [
  "Standard Pest Control", "Mosquito Misting", "Mosquito Spraying", "Wildlife Trapping", "Exclusion", "Lawn",
] as const;
export const TC_SERVICES = [
  "Drywood Alternative", "Sentricon", "Full Liquid", "Fumigation", "Insulation",
] as const;
