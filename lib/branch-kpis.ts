import { prisma } from "@/lib/prisma";
import { BRANCHES } from "@/lib/management";

// Branch KPI targets/actuals for the three headline scorecard categories, from
// the CEO's 2026 Branch KPIs workbook (BranchKpiTarget). Targets are the budget;
// actuals prefer the live MBR figure (KpiValue, month basis) and fall back to the
// workbook's own actual (Q1) when the app has none for that month.

export const BRANCH_KPI_KEYS = ["production", "new_sales", "cancellations"] as const;
export type BranchKpiKey = (typeof BRANCH_KPI_KEYS)[number];

export const BRANCH_KPI_LABEL: Record<BranchKpiKey, string> = {
  production: "Total Production",
  new_sales: "New Sales",
  cancellations: "Cancellations",
};

// cancellations in the workbook == the "attrition" KpiValue key in the app.
const APP_KEY: Record<BranchKpiKey, string> = {
  production: "production",
  new_sales: "new_sales",
  cancellations: "attrition",
};

export const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BRANCH_KEYS = BRANCHES.map((b) => b.key);

type MonthPoint = { m: number; label: string; target: number | null; actual: number | null };

// ---- internal batch loaders ------------------------------------------------

// Workbook targets + actuals: `${branch}:${kpiKey}:${month}` → {target, actual}.
async function loadWorkbook(year: number) {
  const rows = await prisma.branchKpiTarget.findMany({ where: { year } });
  const map = new Map<string, { target: number | null; actual: number | null }>();
  for (const r of rows) map.set(`${r.branch}:${r.kpiKey}:${r.month}`, { target: r.target, actual: r.actual });
  return map;
}

// Live MBR monthly actuals: `${branch}:${kpiKey}:${month}` → actual (kpiKey is
// the workbook key, e.g. cancellations mapped from the app's `attrition`).
async function loadAppActuals(year: number) {
  const periods = await prisma.reportPeriod.findMany({ where: { year }, select: { id: true, month: true } });
  const monthOf = new Map(periods.map((p) => [p.id, p.month]));
  const rows = await prisma.kpiValue.findMany({
    where: {
      periodId: { in: periods.map((p) => p.id) },
      basis: "month",
      scope: { in: BRANCH_KEYS },
      kpiKey: { in: Object.values(APP_KEY) },
    },
    select: { periodId: true, kpiKey: true, scope: true, actual: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.actual == null) continue;
    const month = monthOf.get(r.periodId);
    if (!month) continue;
    const wbKey = (Object.keys(APP_KEY) as BranchKpiKey[]).find((k) => APP_KEY[k] === r.kpiKey);
    if (!wbKey) continue;
    map.set(`${r.scope}:${wbKey}:${month}`, r.actual);
  }
  return map;
}

// The best available actual for a branch/kpi/month: live MBR first, workbook next.
function monthActual(
  branch: string,
  kpi: BranchKpiKey,
  month: number,
  app: Map<string, number>,
  wb: Map<string, { target: number | null; actual: number | null }>,
): number | null {
  const a = app.get(`${branch}:${kpi}:${month}`);
  if (a != null) return a;
  return wb.get(`${branch}:${kpi}:${month}`)?.actual ?? null;
}

// ---- public API ------------------------------------------------------------

export type QuarterCell = { target: number | null; actual: number | null };

/**
 * Quarterly target + actual for one branch/kpi = the sum of that quarter's three
 * monthly figures. Target from the workbook; actual = Σ best-available monthly
 * actual (live MBR, else workbook). Returns null for a side with no data at all
 * (e.g. a future quarter has a target but no actual yet).
 */
export async function branchQuarterKpi(
  branch: string,
  year: number,
  quarter: number,
  kpi: BranchKpiKey,
): Promise<QuarterCell> {
  const [wb, app] = await Promise.all([loadWorkbook(year), loadAppActuals(year)]);
  return sumQuarter(branch, year, quarter, kpi, wb, app);
}

/** Same as branchQuarterKpi but for all three KPIs at once (one pair of loads). */
export async function branchQuarterAll(
  branch: string,
  year: number,
  quarter: number,
): Promise<Record<BranchKpiKey, QuarterCell>> {
  const [wb, app] = await Promise.all([loadWorkbook(year), loadAppActuals(year)]);
  const out = {} as Record<BranchKpiKey, QuarterCell>;
  for (const kpi of BRANCH_KPI_KEYS) out[kpi] = sumQuarter(branch, year, quarter, kpi, wb, app);
  return out;
}

function sumQuarter(
  branch: string,
  _year: number,
  quarter: number,
  kpi: BranchKpiKey,
  wb: Map<string, { target: number | null; actual: number | null }>,
  app: Map<string, number>,
): QuarterCell {
  const months = QUARTER_MONTHS[quarter] ?? [];
  let target: number | null = null;
  let actual: number | null = null;
  for (const m of months) {
    const t = wb.get(`${branch}:${kpi}:${m}`)?.target ?? null;
    if (t != null) target = (target ?? 0) + t;
    const a = monthActual(branch, kpi, m, app, wb);
    if (a != null) actual = (actual ?? 0) + a;
  }
  return { target, actual };
}

/**
 * Monthly budget-vs-actual series for a scope (a branch key or "company" = Σ
 * branches) across all 12 months of the year. `actual` is null for months with
 * no recorded actual (i.e. future/forecast months), so the chart can draw the
 * actual solid up to "today" and the target as the forward forecast line.
 */
export async function branchKpiMonthly(
  scope: string,
  year: number,
  kpi: BranchKpiKey,
): Promise<MonthPoint[]> {
  const [wb, app] = await Promise.all([loadWorkbook(year), loadAppActuals(year)]);
  const scopes = scope === "company" ? BRANCH_KEYS : [scope];
  const out: MonthPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    let target: number | null = null;
    let actual: number | null = null;
    for (const b of scopes) {
      const t = wb.get(`${b}:${kpi}:${m}`)?.target ?? null;
      if (t != null) target = (target ?? 0) + t;
      const a = monthActual(b, kpi, m, app, wb);
      if (a != null) actual = (actual ?? 0) + a;
    }
    out.push({ m, label: MONTH_ABBR[m - 1], target, actual });
  }
  return out;
}
