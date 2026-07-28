import { prisma } from "@/lib/prisma";
import { cell, periodValues, type Cell } from "@/lib/management";
import { quarterInspectionCompliance } from "@/lib/inspection";
import { quarterWarehouseCompliance } from "@/lib/warehouse";
import { quarterTrainingCompliance } from "@/lib/training";

// The quarterly branch-manager bonus scorecard. Binary Met/Not-Met, weighted to
// 100%, per the company template. Five metrics can be auto-computed from the
// MBR budget data already in the app; the rest are reviewer Y/N (compliance) or
// a manual figure until a data source is wired up.

// "placeholder" = a metric shown on the scorecard but not yet auto-computed (no
// per-branch data source wired up); the reviewer marks it manually for now.
export type MetricType = "auto" | "manual" | "compliance" | "placeholder";
export type Direction = "higher" | "lower";

export type ScorecardMetric = {
  key: string;
  label: string;
  weight: number; // percent
  type: MetricType;
  direction?: Direction; // for auto/manual numeric metrics
  kpi?: string; // KpiValue key for auto metrics
  ratioOf?: string; // if set, metric = kpi / ratioOf (e.g. fuel / production)
  unit?: "usd" | "pct";
  // A fixed target that overrides the MBR budget (e.g. the attrition ceiling is
  // a company policy of 2.5% of revenue, not a per-branch budget line).
  fixedTarget?: number;
  // Explanatory hint rendered under a placeholder metric.
  placeholderHint?: string;
  // A "verify before you rely on this" flag shown on the row; also suppresses the
  // auto Met/Not suggestion so a reviewer must consciously confirm it.
  todo?: string;
};

export const SCORECARD_METRICS: ScorecardMetric[] = [
  { key: "production", label: "Production", weight: 15, type: "auto", direction: "higher", kpi: "production", unit: "usd" },
  { key: "unserviced_pct", label: "Unserviced %", weight: 15, type: "manual", direction: "lower", unit: "pct" },
  { key: "sales_value", label: "Annual Value of Total Sales", weight: 15, type: "auto", direction: "higher", kpi: "new_sales", unit: "usd" },
  // Attrition ceiling: the MBR's own attrition RATE (% of book value), summed
  // across the quarter's months — NOT cancellation$ ÷ production. Fixed 2.5%
  // policy target (basis pending CEO confirmation), lower is better.
  { key: "cancellations_value", label: "Attrition % of Revenue", weight: 15, type: "auto", direction: "lower", kpi: "attrition_rate", unit: "pct", fixedTarget: 2.5, todo: "⚠ TO-DO: verify against the MBR — confirm the 2.5% basis (monthly / quarterly / annual) and that April's per-branch attrition rate is loaded before finalizing the bonus." },
  // Fuel is company-only in the MBR (no per-branch split yet). Flagged as a
  // placeholder for now — the CEO is fetching per-branch fuel; wire it to
  // { type:"auto", kpi:"fuel", ratioOf:"production" } once that data lands.
  { key: "fuel_pct", label: "Fuel Cost % of Revenue", weight: 10, type: "placeholder", direction: "lower", unit: "pct", placeholderHint: "Placeholder — per-branch fuel data pending" },
  // Chemical cost % is a PLACEHOLDER for now — per-branch chemical spend isn't in
  // the MBR yet; the reviewer marks it manually until that data source is wired.
  { key: "chemical_pct", label: "Chemical Cost % of Revenue", weight: 10, type: "placeholder", direction: "lower", unit: "pct", placeholderHint: "Placeholder — per-branch chemical cost data pending" },
  { key: "vehicle_inspections", label: "Vehicle Inspection Reports", weight: 5, type: "compliance" },
  { key: "warehouse_inspections", label: "Warehouse Inspection Reports", weight: 5, type: "compliance" },
  { key: "qc_reports", label: "Quality Control Reports", weight: 5, type: "compliance" },
  { key: "training_ceu", label: "Onboarding / CEU Training", weight: 5, type: "compliance" },
];

export const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

export type AutoActual = { actual: number | null; budget: number | null; unit: "usd" | "pct" };

/**
 * Quarterly actual + budget for the auto metrics, at a branch scope, summed
 * across the quarter's months that exist. Ratio metrics (fuel/chemical %) are
 * computed as sum(numerator)/sum(production) so they aggregate correctly.
 */
export async function autoActuals(
  year: number,
  quarter: number,
  branch: string
): Promise<Record<string, AutoActual>> {
  const months = QUARTER_MONTHS[quarter] ?? [];
  const periods = await prisma.reportPeriod.findMany({ where: { year, month: { in: months } } });
  const valueMaps = await Promise.all(periods.map((p) => periodValues(p.id)));

  // Sum a KPI's actual/budget across the quarter's periods for the branch.
  const sum = (kpi: string): { actual: number | null; budget: number | null } => {
    let a: number | null = null, b: number | null = null;
    for (const vm of valueMaps) {
      const c: Cell = cell(vm, kpi, branch as never, "month");
      if (c.actual != null) a = (a ?? 0) + c.actual;
      if (c.budget != null) b = (b ?? 0) + c.budget;
    }
    return { actual: a, budget: b };
  };

  const out: Record<string, AutoActual> = {};
  for (const m of SCORECARD_METRICS) {
    if (m.type !== "auto" || !m.kpi) continue;
    if (m.ratioOf) {
      const num = sum(m.kpi);
      const den = sum(m.ratioOf);
      const pct = (n: number | null, d: number | null) => (n != null && d && d !== 0 ? (n / d) * 100 : null);
      out[m.key] = { actual: pct(num.actual, den.actual), budget: pct(num.budget, den.budget), unit: "pct" };
    } else {
      const s = sum(m.kpi);
      out[m.key] = { actual: s.actual, budget: s.budget, unit: m.unit ?? "usd" };
    }
  }
  return out;
}

/** Suggested Met/Not-Met from an auto metric's actual vs budget target. */
export function suggestMet(direction: Direction | undefined, actual: number | null, target: number | null): boolean | null {
  if (actual == null || target == null || !direction) return null;
  return direction === "higher" ? actual >= target : actual <= target;
}

export type SavedResult = { target: string | null; met: boolean | null; note: string | null };

export async function savedResults(year: number, quarter: number, branch: string): Promise<Record<string, SavedResult>> {
  const rows = await prisma.scorecardResult.findMany({ where: { year, quarter, branch } });
  const out: Record<string, SavedResult> = {};
  for (const r of rows) out[r.metricKey] = { target: r.target, met: r.met, note: r.note };
  return out;
}

/** Weighted score: sum of weights of metrics marked Met (out of 100). */
export function weightedScore(metState: Record<string, boolean | null>): number {
  let earned = 0;
  for (const m of SCORECARD_METRICS) if (metState[m.key] === true) earned += m.weight;
  return earned;
}

export type ScorecardRow = {
  key: string;
  label: string;
  weight: number;
  type: MetricType;
  unit: "usd" | "pct" | null;
  actual: number | null;
  budgetTarget: number | null;
  target: string | null;
  met: boolean | null;
  note: string | null;
  suggested: boolean | null;
  detail: string | null;
};

/**
 * Build the scorecard rows for a branch/quarter — auto actuals + budget targets,
 * saved Met/Not, and the vehicle-inspection auto-suggestion from real
 * completion. Shared by the admin scorecard and a manager's own scorecard view.
 */
export async function buildScorecardRows(year: number, quarter: number, branch: string): Promise<ScorecardRow[]> {
  const [auto, saved, inspComp, whComp, trComp] = await Promise.all([
    autoActuals(year, quarter, branch),
    savedResults(year, quarter, branch),
    quarterInspectionCompliance(year, quarter, branch),
    quarterWarehouseCompliance(year, quarter, branch),
    quarterTrainingCompliance(year, quarter, branch),
  ]);
  return SCORECARD_METRICS.map((m) => {
    const a = auto[m.key];
    const savedRow = saved[m.key] ?? { target: null, met: null, note: null };
    // A fixed policy target (e.g. attrition ≤ 2.5% of revenue) overrides the MBR budget.
    const budgetTarget = m.fixedTarget ?? a?.budget ?? null;
    let suggested = m.type === "auto" ? suggestMet(m.direction, a?.actual ?? null, budgetTarget) : null;
    let detail: string | null = m.type === "placeholder" ? (m.placeholderHint ?? "Placeholder — data pending") : null;
    // A to-do metric shows a verify flag and never auto-suggests Met/Not — the
    // reviewer must confirm the real numbers first (bonus-critical).
    if (m.todo) { detail = m.todo; suggested = null; }
    if (m.key === "vehicle_inspections" && inspComp.expected > 0) {
      suggested = inspComp.complete;
      detail = `${inspComp.done}/${inspComp.expected} inspections this quarter (${inspComp.pct}%)`;
    }
    if (m.key === "warehouse_inspections") {
      suggested = whComp.complete;
      detail = `${whComp.done}/${whComp.expected} monthly warehouse inspections this quarter`;
    }
    if (m.key === "training_ceu" && trComp.total > 0) {
      suggested = trComp.complete;
      detail = `${trComp.completed}/${trComp.total} training assignments completed this quarter (${trComp.pct}%)`;
    }
    return {
      key: m.key,
      label: m.label,
      weight: m.weight,
      type: m.type,
      unit: a?.unit ?? m.unit ?? null,
      actual: a?.actual ?? null,
      budgetTarget,
      target: savedRow.target,
      met: savedRow.met,
      note: savedRow.note,
      suggested,
      detail,
    };
  });
}
