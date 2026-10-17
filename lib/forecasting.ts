import "server-only";
import { BRANCHES, branchLabel, bookForecast } from "@/lib/management";
import {
  branchKpiMonthly,
  BRANCH_KPI_KEYS,
  BRANCH_KPI_LABEL,
  type BranchKpiKey,
} from "@/lib/branch-kpis";

// ===========================================================================
// Forecasting — FIRST SLICE  (CanopyOS vision Theme 10)
// ===========================================================================
//
// A small, HONEST pacing/forecast helper. Everything it returns is a labeled
// ESTIMATE/PROJECTION derived from already-posted actuals vs. the budget shape —
// never presented as an actual. It does not boil the ocean: this first slice
// projects the three headline branch KPIs (production, new sales, cancellations)
// to year-end from run-rate, and surfaces the company forward-book estimate that
// lib/management.ts#bookForecast already computes.
//
// Method (per KPI, per scope): read the 12-month budget-vs-actual series from the
// 2026 Branch KPIs workbook + live MBR (lib/branch-kpis.ts). "Posted" months are
// those with a real actual. We compute the YTD attainment (Σ actual ÷ Σ budget of
// the posted months) and carry that run-rate across the REMAINING budgeted months
// — so seasonality baked into the monthly budget is respected — to estimate the
// full-year figure. Status compares the projected full-year attainment to budget,
// direction-aware (cancellations are lower-is-better). No writes, pure read.
// ===========================================================================

export type PaceStatus = "ahead" | "on_pace" | "behind" | "no_data";

export type Projection = {
  kpi: BranchKpiKey;
  label: string;
  /** For cancellations this is false (coming in UNDER budget is good). */
  higherIsBetter: boolean;
  /** The canonical metrics-registry key for this KPI (production/new_sales/attrition). */
  registryKey: string;
  postedMonths: number;
  ytdActual: number | null;
  /** Budget summed over the SAME posted months (the honest YTD comparison base). */
  ytdBudget: number | null;
  fullYearBudget: number | null;
  /** Labeled estimate: YTD actual + remaining budgeted months × YTD attainment. */
  projectedFullYear: number | null;
  /** YTD attainment %, Σactual ÷ Σbudget over posted months. */
  attainmentPct: number | null;
  /** Projected full-year attainment % vs the full-year budget. */
  projectedAttainmentPct: number | null;
  status: PaceStatus;
};

export type BranchForecast = {
  scope: string; // "company" | branch key
  label: string;
  projections: Projection[];
};

// cancellations ("attrition" in the registry) is the one lower-is-better KPI.
const REGISTRY_KEY: Record<BranchKpiKey, string> = {
  production: "production",
  new_sales: "new_sales",
  cancellations: "attrition",
};
const HIGHER_IS_BETTER: Record<BranchKpiKey, boolean> = {
  production: true,
  new_sales: true,
  cancellations: false,
};

const AHEAD = 102; // projected ≥102% of budget (for a higher-is-better KPI)
const BEHIND = 98; //              <98% of budget

function statusFor(projectedAttainmentPct: number | null, higherIsBetter: boolean): PaceStatus {
  if (projectedAttainmentPct == null) return "no_data";
  const p = projectedAttainmentPct;
  if (higherIsBetter) {
    if (p >= AHEAD) return "ahead";
    if (p < BEHIND) return "behind";
    return "on_pace";
  }
  // lower-is-better (cancellations): coming in UNDER budget is good.
  if (p <= BEHIND) return "ahead";
  if (p > AHEAD) return "behind";
  return "on_pace";
}

/**
 * Pure projection from a 12-month {target, actual} series. Exported so it can be
 * unit-reasoned about and reused. Returns a Projection with all nulls when there
 * is nothing posted yet or no budget to compare against.
 */
export function projectToYearEnd(
  kpi: BranchKpiKey,
  points: { target: number | null; actual: number | null }[],
): Projection {
  const base: Projection = {
    kpi,
    label: BRANCH_KPI_LABEL[kpi],
    higherIsBetter: HIGHER_IS_BETTER[kpi],
    registryKey: REGISTRY_KEY[kpi],
    postedMonths: 0,
    ytdActual: null,
    ytdBudget: null,
    fullYearBudget: null,
    projectedFullYear: null,
    attainmentPct: null,
    projectedAttainmentPct: null,
    status: "no_data",
  };

  const posted = points.filter((p) => p.actual != null);
  const fullYearBudget = points.reduce<number | null>((s, p) => (p.target != null ? (s ?? 0) + p.target : s), null);
  if (posted.length === 0) return { ...base, fullYearBudget };

  const ytdActual = posted.reduce((s, p) => s + (p.actual as number), 0);
  const ytdBudget = posted.reduce<number | null>((s, p) => (p.target != null ? (s ?? 0) + p.target : s), null);
  // Budget for the months NOT yet posted (the forward runway).
  const remainingBudget = points
    .filter((p) => p.actual == null)
    .reduce<number | null>((s, p) => (p.target != null ? (s ?? 0) + p.target : s), null);

  const attainmentPct = ytdBudget != null && ytdBudget !== 0 ? (ytdActual / ytdBudget) * 100 : null;
  const paceRatio = attainmentPct != null ? attainmentPct / 100 : null;

  // Estimate: lock in what's posted; project the remaining budgeted months at the
  // YTD attainment run-rate. If we somehow have no remaining-budget figure, fall
  // back to scaling the full-year budget by the run-rate.
  let projectedFullYear: number | null = null;
  if (paceRatio != null) {
    if (remainingBudget != null) projectedFullYear = ytdActual + remainingBudget * paceRatio;
    else if (fullYearBudget != null) projectedFullYear = fullYearBudget * paceRatio;
  }

  const projectedAttainmentPct =
    projectedFullYear != null && fullYearBudget != null && fullYearBudget !== 0
      ? (projectedFullYear / fullYearBudget) * 100
      : null;

  return {
    ...base,
    postedMonths: posted.length,
    ytdActual,
    ytdBudget,
    fullYearBudget,
    projectedFullYear,
    attainmentPct,
    projectedAttainmentPct,
    status: statusFor(projectedAttainmentPct, HIGHER_IS_BETTER[kpi]),
  };
}

/**
 * Year-end pacing for the company and each branch, across the three headline
 * KPIs. One batched read of the workbook + MBR actuals (branchKpiMonthly caches
 * nothing but is cheap; we call it per scope/kpi). Company first, then branches.
 */
export async function branchForecasts(year: number): Promise<BranchForecast[]> {
  const scopes = ["company", ...BRANCHES.map((b) => b.key)];
  const out: BranchForecast[] = [];
  for (const scope of scopes) {
    const projections: Projection[] = [];
    for (const kpi of BRANCH_KPI_KEYS) {
      const points = await branchKpiMonthly(scope, year, kpi);
      projections.push(projectToYearEnd(kpi, points));
    }
    out.push({
      scope,
      label: scope === "company" ? "All branches" : branchLabel(scope),
      projections,
    });
  }
  return out;
}

export type BookOutlook = {
  current: number | null;
  projected12mo: number | null;
  impliedAnnualGrowthPct: number | null;
};

/**
 * The company forward recurring-book estimate — a thin wrapper over the existing
 * bookForecast() (lib/management.ts), surfaced on the benchmarking page so the
 * pacing panel also carries the one labeled longer-horizon projection we already
 * compute. Read-only; clearly an estimate.
 */
export async function companyBookOutlook(): Promise<BookOutlook> {
  const f = await bookForecast();
  return {
    current: f.current,
    projected12mo: f.projected12mo,
    impliedAnnualGrowthPct: f.impliedAnnualGrowthPct,
  };
}
