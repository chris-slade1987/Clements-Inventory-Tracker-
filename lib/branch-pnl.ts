import { cell, branchLabel, trend, BRANCHES, lobRevenue } from "@/lib/management";
import { fuelByBranch } from "@/lib/fuel";
import type { Payload, Metric, PSeries } from "@/app/(app)/management/branch-pnl/BranchPnlClient";
import type { DashboardPayload, DMetric, DSeries, DBasis, MonthlyChart, FunnelSummary } from "@/components/BranchDashboard";

// Builds the Branch P&L (budget-vs-actual) payload for one branch from a loaded
// period's KpiValue map. Extracted so BOTH the (now-consolidated) branch view of
// the Management dashboard and the legacy /management/branch-pnl route can share
// one source of truth. Company-only lines (new sales, chemical, fuel) are passed
// through tagged company-wide rather than faked at branch level.
type Values = Parameters<typeof cell>[0];

/** A branch's share of YTD production (for allocating company-only budgets). */
function productionShare(values: Values, branch: string): number | null {
  let company = 0;
  let mine: number | null = null;
  for (const b of BRANCHES) {
    const p = cell(values, "production", b.key as never, "ytd").actual;
    if (p != null) {
      company += p;
      if (b.key === branch) mine = p;
    }
  }
  return company && mine != null ? mine / company : null;
}

export async function buildBranchPnlPayload(
  values: Values,
  branch: string,
  locked: boolean,
  period: { year: number; month: number },
): Promise<Payload> {
  const series = (kpiKey: string, scope: string): PSeries => {
    const c = (basis: "month" | "ytd" | "cy_forecast") => cell(values, kpiKey, scope as never, basis);
    const m = c("month"), y = c("ytd"), f = c("cy_forecast");
    return {
      month: { actual: m.actual, budget: m.budget },
      ytd: { actual: y.actual, budget: y.budget },
      fy: { actual: f.actual, budget: f.budget },
    };
  };

  // Fuel: prefer REAL per-branch spend (actual Coast transactions for the same
  // YTD window as the MBR); the company fuel budget is allocated to the branch by
  // its production share so the tile stays a budget-vs-actual. Fall back to the
  // company-only model line when a branch has no real fuel data loaded.
  const fuelMap = await fuelByBranch(period.year, period.month);
  const bf = fuelMap[branch];
  let fuelMetric: Metric;
  if (bf && bf.ytd > 0) {
    const share = productionShare(values, branch);
    const alloc = (basis: "month" | "ytd" | "cy_forecast") => {
      const cb = cell(values, "fuel", "company", basis).budget;
      return cb != null && share != null ? Math.round(cb * share) : null;
    };
    fuelMetric = {
      key: "fuel", label: "Fuel", group: "cost", unit: "usd", higherIsBetter: false, companyWide: false, pctOfRev: true, revDenom: "branch",
      series: {
        month: { actual: Math.round(bf.month), budget: alloc("month") },
        ytd: { actual: Math.round(bf.ytd), budget: alloc("ytd") },
        fy: { actual: null, budget: alloc("cy_forecast") },
      },
    };
  } else {
    fuelMetric = { key: "fuel", label: "Fuel", group: "cost", unit: "usd", higherIsBetter: false, companyWide: true, pctOfRev: true, revDenom: "company", series: series("fuel", "company") };
  }

  const metrics: Metric[] = [
    { key: "production", label: "Production Revenue", group: "rev", unit: "usd", higherIsBetter: true, companyWide: false, pctOfRev: false, revDenom: null, series: series("production", branch) },
    { key: "net_after_labor", label: "Net after Labor", group: "rev", unit: "usd", higherIsBetter: true, companyWide: false, pctOfRev: false, revDenom: null, series: series("net_after_labor", branch), sub: { label: "Margin %", unit: "pct", series: series("margin_pct", branch) } },
    { key: "stops", label: "Stops Completed", group: "rev", unit: "count", higherIsBetter: true, companyWide: false, pctOfRev: false, revDenom: null, series: series("stops", branch) },
    { key: "new_sales", label: "New Sales", group: "rev", unit: "usd", higherIsBetter: true, companyWide: true, pctOfRev: false, revDenom: null, series: series("new_sales", "company") },
    { key: "tech_wages", label: "Technician Wages", group: "cost", unit: "usd", higherIsBetter: false, companyWide: false, pctOfRev: true, revDenom: "branch", series: series("tech_wages", branch) },
    { key: "chemical_expense", label: "Chemical Expense", group: "cost", unit: "usd", higherIsBetter: false, companyWide: true, pctOfRev: true, revDenom: "company", series: series("chemical_expense", "company") },
    fuelMetric,
  ];
  const present = metrics.filter((m) => [m.series.month, m.series.ytd, m.series.fy].some((c) => c.actual != null));

  const monthly = async (kpi: string, scope: string) =>
    (await trend(kpi, scope as never, "month"))
      .filter((r) => r.actual != null)
      .map((r) => ({ label: r.label.replace(/ 20\d\d$/, ""), m: r.month, value: r.actual as number }));

  let sales = await monthly("new_sales", branch);
  let cancels = await monthly("attrition", branch);
  let bookCompanyWide = false;
  if (sales.length === 0 || cancels.length === 0) {
    sales = await monthly("new_sales", "company");
    cancels = await monthly("attrition", "company");
    bookCompanyWide = true;
  }
  const bScope = bookCompanyWide ? "company" : branch;

  return {
    branchLabel: branchLabel(branch),
    locked,
    metrics: present,
    revBranch: series("production", branch),
    revCompany: series("net_revenue", "company"),
    bookGrowth: {
      scopeLabel: bookCompanyWide ? "Company-wide" : branchLabel(branch),
      companyWide: bookCompanyWide,
      sales,
      cancels,
      salesYtd: cell(values, "new_sales", bScope as never, "ytd").actual,
      cancelsYtd: cell(values, "attrition", bScope as never, "ytd").actual,
    },
  };
}

// ===========================================================================
// Dashboard payload — the richer, scope-aware backbone for the Branch & Company
// KPIs dashboard (components/BranchDashboard). Builds a fully serializable mix of
// budget / actual / full-year-forecast for EVERY available category, reading real
// MBR figures (KpiValue), the branch budget model, real per-branch fuel, monthly
// trends, line-of-business revenue, and the per-branch split. Nothing is
// fabricated: a KPI with no branch-level split is pulled at company scope and
// tagged company-wide; a KPI with no data for the period is omitted. Reuses the
// same real-per-branch fuel logic as buildBranchPnlPayload above.
// ===========================================================================

const DSERIES_BASES: DBasis[] = ["month", "ytd", "fy"];

type Def = {
  key: string;
  label: string;
  group: "rev" | "profit" | "cost";
  unit: "usd" | "pct" | "count";
  hib: boolean;
  branch: boolean; // whether this KPI can carry a branch-level split
  pctOfRev?: boolean;
  fuel?: boolean;
  sub?: { key: string; label: string };
};

const DASH_DEFS: Def[] = [
  { key: "production", label: "Production", group: "rev", unit: "usd", hib: true, branch: true },
  { key: "new_sales", label: "New Sales", group: "rev", unit: "usd", hib: true, branch: true },
  { key: "attrition", label: "Cancellations", group: "rev", unit: "usd", hib: false, branch: true },
  { key: "attrition_rate", label: "Attrition Rate", group: "rev", unit: "pct", hib: false, branch: true },
  { key: "book_value", label: "Book Value", group: "rev", unit: "usd", hib: true, branch: true },
  { key: "net_revenue", label: "Net Revenue", group: "rev", unit: "usd", hib: true, branch: false },
  { key: "route_contrib", label: "Route Contribution", group: "profit", unit: "usd", hib: true, branch: true, sub: { key: "route_contrib_pct", label: "Route contrib %" } },
  { key: "net_after_labor", label: "Net after Labor", group: "profit", unit: "usd", hib: true, branch: true, sub: { key: "margin_pct", label: "Margin %" } },
  { key: "ebitda", label: "EBITDA", group: "profit", unit: "usd", hib: true, branch: false, sub: { key: "ebitda_pct", label: "EBITDA %" } },
  { key: "tech_wages", label: "Technician Wages", group: "cost", unit: "usd", hib: false, branch: true, pctOfRev: true },
  { key: "fuel", label: "Fuel", group: "cost", unit: "usd", hib: false, branch: true, pctOfRev: true, fuel: true },
  { key: "chemical_expense", label: "Chemical Expense", group: "cost", unit: "usd", hib: false, branch: true, pctOfRev: true },
  { key: "sga", label: "SG&A", group: "cost", unit: "usd", hib: false, branch: false, pctOfRev: true },
];

export async function buildDashboardPayload(
  values: Values,
  scope: string, // "company" | branch key
  locked: boolean,
  period: { id: string; year: number; month: number; label: string },
  basis: DBasis,
  funnel: FunnelSummary,
): Promise<DashboardPayload> {
  const isCompany = scope === "company";
  const branch = isCompany ? null : scope;

  const dseries = (kpiKey: string, s: string): DSeries => {
    const c = (basis: DBasis) => {
      const v = cell(values, kpiKey, s as never, basis === "fy" ? "cy_forecast" : basis);
      return { actual: v.actual, budget: v.budget };
    };
    return { month: c("month"), ytd: c("ytd"), fy: c("fy") };
  };
  const hasAny = (kpiKey: string, s: string) =>
    DSERIES_BASES.some((b) => cell(values, kpiKey, s as never, b === "fy" ? "cy_forecast" : b).actual != null);

  // Real per-branch fuel (Coast transactions), allocated budget by production share.
  const fuelMap = await fuelByBranch(period.year, period.month);

  const metrics: DMetric[] = [];
  for (const d of DASH_DEFS) {
    // Pick the source scope + whether the figure is company-wide context.
    let srcScope: string;
    let companyWide: boolean;
    if (isCompany) {
      srcScope = "company";
      companyWide = false;
    } else if (d.branch && hasAny(d.key, branch!)) {
      srcScope = branch!;
      companyWide = false;
    } else if (hasAny(d.key, "company")) {
      srcScope = "company";
      companyWide = true;
    } else {
      continue; // no data anywhere for this period → omit (graceful)
    }

    let series: DSeries;
    if (d.fuel && !isCompany) {
      const bf = fuelMap[branch!];
      if (bf && bf.ytd > 0) {
        const share = productionShare(values, branch!);
        const alloc = (basis: "month" | "ytd" | "cy_forecast") => {
          const cb = cell(values, "fuel", "company", basis).budget;
          return cb != null && share != null ? Math.round(cb * share) : null;
        };
        series = {
          month: { actual: Math.round(bf.month), budget: alloc("month") },
          ytd: { actual: Math.round(bf.ytd), budget: alloc("ytd") },
          fy: { actual: null, budget: alloc("cy_forecast") },
        };
        companyWide = false;
      } else {
        series = dseries("fuel", "company");
        companyWide = true;
      }
    } else {
      series = dseries(d.key, srcScope);
    }

    const pctOfRev = !!d.pctOfRev;
    const revDenom = pctOfRev ? (companyWide || isCompany ? "company" : "branch") : null;
    const sub = d.sub && hasAny(d.sub.key, srcScope)
      ? { label: d.sub.label, unit: "pct" as const, series: dseries(d.sub.key, srcScope) }
      : null;

    metrics.push({
      key: d.key, label: d.label, group: d.group, unit: d.unit,
      higherIsBetter: d.hib, companyWide, pctOfRev, revDenom, series, sub,
    });
  }

  // Headline revenue: company → net revenue; branch → production.
  const revKey = isCompany ? "net_revenue" : "production";
  const revLabel = isCompany ? "Net Revenue" : "Production";
  const revSeries = dseries(revKey, isCompany ? "company" : branch!);

  // Monthly budget-vs-actual (real posted months) for the headline categories.
  const monthScope = isCompany ? "company" : branch!;
  const monthlyDefs: { key: string; label: string; unit: "usd" | "count" }[] = [
    { key: "production", label: "Production", unit: "usd" },
    { key: "new_sales", label: "New Sales", unit: "usd" },
    { key: "attrition", label: "Cancellations", unit: "usd" },
  ];
  const monthly: MonthlyChart[] = [];
  for (const md of monthlyDefs) {
    let rows = await trend(md.key, monthScope as never, "month");
    if (rows.filter((r) => r.actual != null).length === 0 && !isCompany) {
      rows = await trend(md.key, "company" as never, "month");
    }
    const points = rows.map((r) => ({
      label: r.label.replace(/ 20\d\d$/, ""),
      actual: r.actual,
      target: r.budget,
    }));
    if (points.some((p) => p.actual != null || p.target != null)) {
      monthly.push({ key: md.key, label: md.label, unit: md.unit, points });
    }
  }

  // Book growth — new sales vs cancellations monthly (real actuals).
  const monthlyActual = async (kpi: string, s: string) =>
    (await trend(kpi, s as never, "month"))
      .filter((r) => r.actual != null)
      .map((r) => ({ label: r.label.replace(/ 20\d\d$/, ""), value: r.actual as number }));
  let salesMonthly = branch ? await monthlyActual("new_sales", branch) : await monthlyActual("new_sales", "company");
  let cancelsMonthly = branch ? await monthlyActual("attrition", branch) : await monthlyActual("attrition", "company");
  let bookCompanyWide = false;
  if (branch && (salesMonthly.length === 0 || cancelsMonthly.length === 0)) {
    salesMonthly = await monthlyActual("new_sales", "company");
    cancelsMonthly = await monthlyActual("attrition", "company");
    bookCompanyWide = true;
  }
  const bScope = branch && !bookCompanyWide ? branch : "company";

  // Line-of-business revenue mix for this scope (real per-scope rows).
  const lobRows = await lobRevenue(period.id, scope as never);
  let lob = lobRows.map((r) => ({ label: r.lob, value: r.revenue }));
  if (lob.length > 8) {
    const top = lob.slice(0, 7);
    const other = lob.slice(7).reduce((s, r) => s + r.value, 0);
    lob = [...top, { label: "Other", value: other }];
  }

  // Company scope: per-branch production (YTD) drill cards.
  const perBranch = isCompany
    ? BRANCHES.map((b) => {
        const c = cell(values, "production", b.key, "ytd");
        return { key: b.key, label: b.label, actual: c.actual, budget: c.budget };
      })
    : null;

  return {
    scopeKey: scope,
    scopeLabel: isCompany ? "All branches" : branchLabel(branch!),
    isCompany,
    locked,
    basis,
    periodLabel: period.label,
    ytdLabel: `YTD · Jan–${period.label.replace(/ 20\d\d$/, "")}`,
    revenue: { label: revLabel, series: revSeries, companyWide: false },
    metrics,
    revBranch: dseries("production", isCompany ? "company" : branch!),
    revCompany: dseries("net_revenue", "company"),
    monthly,
    book: {
      salesMonthly,
      cancelsMonthly,
      salesYtd: cell(values, "new_sales", bScope as never, "ytd").actual,
      cancelsYtd: cell(values, "attrition", bScope as never, "ytd").actual,
      companyWide: bookCompanyWide,
      scopeLabel: bookCompanyWide ? "Company-wide" : isCompany ? "All branches" : branchLabel(branch!),
    },
    lob,
    perBranch,
    funnel,
  };
}
