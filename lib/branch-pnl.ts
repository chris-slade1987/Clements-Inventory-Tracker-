import { cell, branchLabel, trend, BRANCHES } from "@/lib/management";
import { fuelByBranch } from "@/lib/fuel";
import type { Payload, Metric, PSeries } from "@/app/(app)/management/branch-pnl/BranchPnlClient";

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
