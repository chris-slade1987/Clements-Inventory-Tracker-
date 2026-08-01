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

/** The period immediately before the given one (by year/month), or null. */
export async function priorPeriod(period: PeriodRef): Promise<PeriodRef | null> {
  const periods = await listPeriods();
  const idx = periods.findIndex((p) => p.id === period.id);
  return idx >= 0 && idx + 1 < periods.length ? periods[idx + 1] : null;
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

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type BookForecast = {
  current: number | null; // latest actual book value
  momLatest: number | null; // most recent month-over-month growth %
  momAvg3: number | null; // trailing-average MoM growth % (last min(3,n) months)
  netAvg3: number | null; // trailing-average net $ change (last min(3,n) months)
  projected12mo: number | null; // book value 12 months forward
  impliedAnnualGrowthPct: number | null; // projected12mo vs current, %
  historical: { label: string; value: number }[];
  forecast: { label: string; value: number }[];
  mom: { label: string; pct: number }[]; // per-month MoM growth %, ascending
};

/**
 * Forward 12-month recurring-book forecast, built entirely from real
 * `book_value` history (company scope, month basis) — no invented figures.
 *
 * Method: compound the current book forward 12 months at the trailing-average
 * MoM growth RATE (last min(3,n) months). A percentage run-rate keeps a growing
 * book compounding rather than adding a fixed dollar step, which best matches a
 * recurring book that grows proportionally. If a percentage rate can't be
 * computed (e.g. a zero prior-month book), it falls back to adding the
 * trailing-average net $ change each month. Null-safe: returns nulls / empty
 * arrays when there are fewer than 2 book data points.
 */
export async function bookForecast(): Promise<BookForecast> {
  const rows = await trend("book_value", "company", "month");
  const points = rows
    .filter((r) => r.actual != null)
    .map((r) => ({ label: r.label, year: r.year, month: r.month, value: r.actual as number }));

  const empty: BookForecast = {
    current: null, momLatest: null, momAvg3: null, netAvg3: null,
    projected12mo: null, impliedAnnualGrowthPct: null,
    historical: [], forecast: [], mom: [],
  };
  if (points.length === 0) return empty;
  if (points.length < 2) {
    // A single point can't produce a trend — surface the current book only.
    return { ...empty, current: points[0].value, historical: [{ label: points[0].label, value: points[0].value }] };
  }

  const historical = points.map((p) => ({ label: p.label, value: p.value }));

  // Per-month MoM growth % and net $ change, aligned to the later month.
  const mom: { label: string; pct: number }[] = [];
  const nets: number[] = [];
  const growths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    nets.push(cur - prev);
    if (prev !== 0) {
      const g = ((cur - prev) / prev) * 100;
      growths.push(g);
      mom.push({ label: points[i].label, pct: g });
    }
  }

  const current = points[points.length - 1].value;
  const momLatest = mom.length ? mom[mom.length - 1].pct : null;

  const gk = Math.min(3, growths.length);
  const momAvg3 = gk > 0 ? growths.slice(-gk).reduce((s, g) => s + g, 0) / gk : null;
  const nk = Math.min(3, nets.length);
  const netAvg3 = nk > 0 ? nets.slice(-nk).reduce((s, n) => s + n, 0) / nk : null;

  // Roll year/month forward without Date math; compound (or add) each step.
  const rate = momAvg3 != null ? momAvg3 / 100 : null;
  const forecast: { label: string; value: number }[] = [];
  let running = current;
  let y = points[points.length - 1].year;
  let m = points[points.length - 1].month; // 1-12
  for (let i = 0; i < 12; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (rate != null) running = running * (1 + rate);
    else if (netAvg3 != null) running = running + netAvg3;
    forecast.push({ label: `${MONTH_NAMES[m - 1]} ${String(y).slice(-2)}`, value: running });
  }

  const projected12mo = forecast.length ? forecast[forecast.length - 1].value : null;
  const impliedAnnualGrowthPct =
    projected12mo != null && current !== 0 ? ((projected12mo - current) / current) * 100 : null;

  return { current, momLatest, momAvg3, netAvg3, projected12mo, impliedAnnualGrowthPct, historical, forecast, mom };
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
