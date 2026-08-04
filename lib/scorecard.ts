import { prisma } from "@/lib/prisma";
import { cell, periodValues, type Cell } from "@/lib/management";
import { quarterInspectionCompliance } from "@/lib/inspection";
import { quarterWarehouseCompliance } from "@/lib/warehouse";
import { quarterTrainingCompliance } from "@/lib/training";
import { matchEmployeeByName } from "@/lib/people";

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
  ratioOf?: string; // if set, metric = kpi / ratioOf (e.g. tech wages / production)
  unit?: "usd" | "pct" | "count";
  // A fixed target that overrides the MBR budget (e.g. the attrition ceiling is
  // a company policy of 2.5% of revenue, not a per-branch budget line).
  fixedTarget?: number;
  // A per-quarter target that pro-rates against the YTD actual: the effective
  // target is `perQuarterTarget × quarter` (e.g. attrition 2.5%/qtr → Q1 2.5%,
  // Q2 YTD 5.0%, Q3 7.5%, full year 10%). Overrides fixedTarget when set.
  perQuarterTarget?: number;
  // Explanatory hint rendered under a placeholder metric.
  placeholderHint?: string;
  // A "verify before you rely on this" flag shown on the row; also suppresses the
  // auto Met/Not suggestion so a reviewer must consciously confirm it.
  todo?: string;
};

// The quarterly manager scorecard — 8 weighted KPIs mirroring the Q1 2026
// template (e.g. Adam Goetz / Stuart). Auto metrics read the branch's YTD
// figure (actual + budget) from the canonical budget model (Branch Frcst),
// which reconciles to the MBR. "Net after Labor (Margin %)" uses the model's
// definition. Scoring = binary Met/Not, weighted to 100.
export const SCORECARD_METRICS: ScorecardMetric[] = [
  { key: "production", label: "Total Production Revenue", weight: 20, type: "auto", direction: "higher", kpi: "production", unit: "usd" },
  { key: "net_after_labor_margin", label: "Net after Labor (Margin %)", weight: 15, type: "auto", direction: "higher", kpi: "margin_pct", unit: "pct" },
  { key: "tech_wages_pct", label: "Technician Wages % of Revenue", weight: 10, type: "auto", direction: "lower", kpi: "tech_wages", ratioOf: "production", unit: "pct" },
  { key: "stops", label: "Stops Completed", weight: 10, type: "auto", direction: "higher", kpi: "stops", unit: "count" },
  { key: "new_sales", label: "New Sales (Annual Value)", weight: 15, type: "auto", direction: "higher", kpi: "new_sales", unit: "usd" },
  { key: "cancellations", label: "Cancellations (Annual Value)", weight: 15, type: "auto", direction: "lower", kpi: "attrition", unit: "usd" },
  // Chemical is purchase-based per branch (MMR) but only company-wide in the
  // model — a known gap the Q1 card itself flagged. Placeholder until branch
  // chemical is wired; reviewer marks it manually.
  { key: "chemical_pct", label: "Chemical Cost % of Revenue", weight: 5, type: "placeholder", direction: "lower", unit: "pct", placeholderHint: "Per-branch chemical is purchase-based (MMR); the model carries chemical company-wide only — mark manually until branch chemical is wired." },
  { key: "attrition_rate", label: "Attrition Rate (YTD)", weight: 10, type: "auto", direction: "lower", kpi: "attrition_rate", unit: "pct", perQuarterTarget: 2.5 },
];

export const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

export type AutoActual = { actual: number | null; budget: number | null; unit: "usd" | "pct" | "count" };

/**
 * Actual + budget for the auto metrics at a branch scope, read as the **YTD**
 * figure from the quarter-end month's period (e.g. Q2 → the June 2026 period's
 * `ytd` basis). This uses the canonical budget model's verified YTD numbers
 * (Branch Frcst), which reconcile to the MBR — rather than summing individual
 * months, which aren't loaded per branch. Ratio metrics (tech wages %, etc.)
 * are computed as YTD-numerator ÷ YTD-denominator so they aggregate correctly.
 * Percent KPIs already stored as a percentage (e.g. margin_pct) are read directly.
 */
export async function autoActuals(
  year: number,
  quarter: number,
  branch: string
): Promise<Record<string, AutoActual>> {
  const months = QUARTER_MONTHS[quarter] ?? [];
  const endMonth = months.length ? months[months.length - 1] : 12;
  const period = await prisma.reportPeriod.findFirst({ where: { year, month: endMonth } });
  const vm = period ? await periodValues(period.id) : null;

  // Read a KPI's YTD actual/budget for the branch.
  const read = (kpi: string): { actual: number | null; budget: number | null } => {
    if (!vm) return { actual: null, budget: null };
    const c: Cell = cell(vm, kpi, branch as never, "ytd");
    return { actual: c.actual, budget: c.budget };
  };

  const out: Record<string, AutoActual> = {};
  for (const m of SCORECARD_METRICS) {
    if (m.type !== "auto" || !m.kpi) continue;
    if (m.ratioOf) {
      const num = read(m.kpi);
      const den = read(m.ratioOf);
      const pct = (n: number | null, d: number | null) => (n != null && d && d !== 0 ? (n / d) * 100 : null);
      out[m.key] = { actual: pct(num.actual, den.actual), budget: pct(num.budget, den.budget), unit: "pct" };
    } else {
      const s = read(m.kpi);
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

/** Weighted score straight from the saved ScorecardResult rows for a period. */
export async function scoreFromSaved(year: number, quarter: number, branch: string): Promise<number> {
  const saved = await savedResults(year, quarter, branch);
  const metState: Record<string, boolean | null> = {};
  for (const m of SCORECARD_METRICS) metState[m.key] = saved[m.key]?.met ?? null;
  return weightedScore(metState);
}

// ---- Review completion lifecycle -----------------------------------------
// The ScorecardReview wraps the per-metric ScorecardResult rows with a header,
// four narrative reviewer-comment fields, and a three-signer sign-off, then
// archives to the manager's personnel file. See prisma/schema.prisma.

export type SignatureLite = { id: string; role: string; typedName: string; title: string | null; signedAt: Date };
export type ReviewLite = {
  id: string;
  year: number;
  quarter: number;
  branch: string;
  status: string; // "draft" | "signed" | "archived"
  managerName: string | null;
  reviewerName: string | null;
  reviewDate: Date | null;
  overallNotes: string | null;
  strengths: string | null;
  areas: string | null;
  goals: string | null;
  score: number | null;
  employeeId: string | null;
  personnelRecordId: string | null;
  finalizedAt: Date | null;
  archivedAt: Date | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  signatures: SignatureLite[];
};

/** Load (never create) the review document for a period, with its signatures. */
export async function getScorecardReview(year: number, quarter: number, branch: string): Promise<ReviewLite | null> {
  const r = await prisma.scorecardReview.findUnique({
    where: { year_quarter_branch: { year, quarter, branch } },
    include: { signatures: { orderBy: { signedAt: "asc" } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    year: r.year,
    quarter: r.quarter,
    branch: r.branch,
    status: r.status,
    managerName: r.managerName,
    reviewerName: r.reviewerName,
    reviewDate: r.reviewDate,
    overallNotes: r.overallNotes,
    strengths: r.strengths,
    areas: r.areas,
    goals: r.goals,
    score: r.score,
    employeeId: r.employeeId,
    personnelRecordId: r.personnelRecordId,
    finalizedAt: r.finalizedAt,
    archivedAt: r.archivedAt,
    reopenedAt: r.reopenedAt,
    reopenedBy: r.reopenedBy,
    signatures: r.signatures.map((s) => ({ id: s.id, role: s.role, typedName: s.typedName, title: s.title, signedAt: s.signedAt })),
  };
}

/** Whether a review has the three required signatures: ≥2 reviewer + ≥1 manager. */
export function hasRequiredSignatures(signatures: { role: string }[]): boolean {
  const reviewers = signatures.filter((s) => s.role === "reviewer").length;
  const managers = signatures.filter((s) => s.role === "manager").length;
  return reviewers >= 2 && managers >= 1;
}

/**
 * Match a branch's manager to an Employee profile — by branch + a "Manager"
 * role. If a manager name is supplied (from the review header) it's used to
 * disambiguate when a branch has more than one Manager-role employee.
 */
export async function matchBranchManagerEmployee(branch: string, managerName?: string | null): Promise<{ id: string; name: string } | null> {
  const managers = await prisma.employee.findMany({
    where: { status: "active", branch, role: { contains: "Manager" } },
    select: { id: true, name: true },
  });
  if (managers.length === 0) return null;
  if (managerName && managers.length > 1) {
    const m = matchEmployeeByName(managerName, managers.map((e) => ({ id: e.id, name: e.name, role: null, division: null, branch })));
    if (m) { const hit = managers.find((e) => e.id === m); if (hit) return hit; }
  }
  return managers[0];
}

/** Archived reviews across the given branches, newest first (for the archive list). */
export async function listArchivedReviews(branches: string[]) {
  return prisma.scorecardReview.findMany({
    where: { status: "archived", branch: { in: branches } },
    orderBy: [{ year: "desc" }, { quarter: "desc" }, { branch: "asc" }],
    include: { signatures: { orderBy: { signedAt: "asc" } } },
  });
}

export type ScorecardRow = {
  key: string;
  label: string;
  weight: number;
  type: MetricType;
  unit: "usd" | "pct" | "count" | null;
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
    // A per-quarter target pro-rates against the YTD actual (attrition 2.5%/qtr);
    // a fixed policy target overrides the MBR budget; otherwise use the budget.
    const budgetTarget = m.perQuarterTarget != null ? m.perQuarterTarget * quarter : (m.fixedTarget ?? a?.budget ?? null);
    let suggested = m.type === "auto" ? suggestMet(m.direction, a?.actual ?? null, budgetTarget) : null;
    let detail: string | null = m.type === "placeholder" ? (m.placeholderHint ?? "Placeholder — data pending") : null;
    if (m.perQuarterTarget != null) detail = `Pro-rated YTD ceiling: ${m.perQuarterTarget}%/quarter × Q${quarter} = ${(m.perQuarterTarget * quarter).toFixed(1)}% (lower is better)`;
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
