import { prisma } from "@/lib/prisma";

// Query helpers for the management (board / KPI) dashboard. All read-only.
// Manager compensation is never queried or returned here.

export const BRANCHES = [
  { key: "vero", label: "Vero Beach" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
] as const;

export type Scope = "company" | (typeof BRANCHES)[number]["key"];
export type Basis = "month" | "ytd" | "cy_forecast";

export function branchLabel(key: string): string {
  return BRANCHES.find((b) => b.key === key)?.label ?? key;
}

export type KpiMeta = { key: string; label: string; group: string; unit: string; higherIsBetter: boolean };

export async function kpiCatalog(): Promise<Map<string, KpiMeta>> {
  const kpis = await prisma.kpi.findMany({ orderBy: { sortOrder: "asc" } });
  return new Map(kpis.map((k) => [k.key, k]));
}

export type PeriodRef = { id: string; year: number; month: number; label: string };

export async function listPeriods(): Promise<PeriodRef[]> {
  return prisma.reportPeriod.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true, year: true, month: true, label: true },
  });
}

/** Resolve a period by "YYYY-MM"; falls back to the latest available. */
export async function resolvePeriod(key?: string): Promise<PeriodRef | null> {
  const periods = await listPeriods();
  if (periods.length === 0) return null;
  if (key) {
    const [y, m] = key.split("-").map(Number);
    const found = periods.find((p) => p.year === y && p.month === m);
    if (found) return found;
  }
  return periods[0];
}

export type Cell = { actual: number | null; budget: number | null; variance: number | null; favorable: boolean | null };

/** All KPI values for one period, keyed `${kpiKey}:${scope}:${basis}`. */
export async function periodValues(periodId: string): Promise<Map<string, Cell>> {
  const [rows, cat] = await Promise.all([
    prisma.kpiValue.findMany({ where: { periodId } }),
    kpiCatalog(),
  ]);
  const m = new Map<string, Cell>();
  for (const r of rows) {
    const meta = cat.get(r.kpiKey);
    const variance = r.actual != null && r.budget != null ? r.actual - r.budget : null;
    let favorable: boolean | null = null;
    if (variance != null && meta) favorable = meta.higherIsBetter ? variance >= 0 : variance <= 0;
    m.set(`${r.kpiKey}:${r.scope}:${r.basis}`, { actual: r.actual, budget: r.budget, variance, favorable });
  }
  return m;
}

export function cell(values: Map<string, Cell>, kpi: string, scope: Scope = "company", basis: Basis = "month"): Cell {
  return values.get(`${kpi}:${scope}:${basis}`) ?? { actual: null, budget: null, variance: null, favorable: null };
}

/** A KPI's actual across all periods (ascending) for trend charts. */
export async function trend(kpi: string, scope: Scope = "company", basis: Basis = "month") {
  const rows = await prisma.kpiValue.findMany({
    where: { kpiKey: kpi, scope, basis },
    include: { period: { select: { year: true, month: true, label: true } } },
  });
  return rows
    .map((r) => ({ label: r.period.label, year: r.period.year, month: r.period.month, actual: r.actual, budget: r.budget }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

export async function lobRevenue(periodId: string, scope: Scope = "company") {
  const rows = await prisma.lobRevenue.findMany({ where: { periodId, scope } });
  return rows
    .map((r) => ({ lob: r.lob, revenue: r.revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

export async function leadSources(periodId: string, scope: Scope = "company") {
  const rows = await prisma.leadSource.findMany({ where: { periodId, scope } });
  return rows
    .map((r) => ({
      source: r.source,
      revenueMonth: r.revenueMonth,
      revenueYtd: r.revenueYtd,
      leads: r.leads,
      won: r.won,
      closeRate: r.leads && r.leads > 0 && r.won != null ? (r.won / r.leads) * 100 : null,
    }))
    .sort((a, b) => b.revenueMonth - a.revenueMonth);
}

export async function techProduction(periodId: string, scope: string) {
  const rows = await prisma.techProduction.findMany({ where: { periodId, scope }, orderBy: { actual: "desc" } });
  return rows.map((r) => ({
    name: r.techName,
    lob: r.lob,
    actual: r.actual,
    budget: r.budget,
    variance: r.actual - r.budget,
  }));
}
