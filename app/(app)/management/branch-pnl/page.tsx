import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel, cell, listPeriods, periodValues, resolvePeriod, trend, type Cell } from "@/lib/management";
import BranchPnlClient, { type Metric, type PSeries } from "./BranchPnlClient";

export const dynamic = "force-dynamic";

// Per-branch Budget vs Actual, ported from the approved scorecard mockup. Reads
// real branch-scoped KpiValue rows for the loaded period; company-only lines are
// passed through as "company-wide" rather than faked at branch level.
export default async function BranchPnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  const sp = await searchParams;

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Branch P&L — Budget vs Actual" subtitle="Per-branch reading of the budget model" />
        <EmptyState title="No report data yet" hint="Upload a Monthly Board Report so branch budget-vs-actual can populate." />
      </>
    );
  }

  const period = (await resolvePeriod())!;
  const values = await periodValues(period.id);

  // Admins pick a branch; branch managers are pinned to their own.
  const locked = branchLocked(user);
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested) ?? BRANCHES[0].key;
  const visibleBranches = locked ? BRANCHES.filter((b) => b.key === branch) : BRANCHES;

  // Build a 3-basis series for a KPI at a given scope.
  const series = (kpiKey: string, scope: string): PSeries => {
    const c = (basis: "month" | "ytd" | "cy_forecast"): Cell => cell(values, kpiKey, scope as never, basis);
    const m = c("month"), y = c("ytd"), f = c("cy_forecast");
    return {
      month: { actual: m.actual, budget: m.budget },
      ytd: { actual: y.actual, budget: y.budget },
      fy: { actual: f.actual, budget: f.budget },
    };
  };

  const metrics: Metric[] = [
    { key: "production", label: "Production Revenue", group: "rev", unit: "usd", higherIsBetter: true, companyWide: false, pctOfRev: false, revDenom: null, series: series("production", branch) },
    {
      key: "net_after_labor",
      label: "Net after Labor",
      group: "rev",
      unit: "usd",
      higherIsBetter: true,
      companyWide: false,
      pctOfRev: false,
      revDenom: null,
      series: series("net_after_labor", branch),
      sub: { label: "Margin %", unit: "pct", series: series("margin_pct", branch) },
    },
    { key: "stops", label: "Stops Completed", group: "rev", unit: "count", higherIsBetter: true, companyWide: false, pctOfRev: false, revDenom: null, series: series("stops", branch) },
    { key: "new_sales", label: "New Sales", group: "rev", unit: "usd", higherIsBetter: true, companyWide: true, pctOfRev: false, revDenom: null, series: series("new_sales", "company") },
    { key: "tech_wages", label: "Technician Wages", group: "cost", unit: "usd", higherIsBetter: false, companyWide: false, pctOfRev: true, revDenom: "branch", series: series("tech_wages", branch) },
    { key: "chemical_expense", label: "Chemical Expense", group: "cost", unit: "usd", higherIsBetter: false, companyWide: true, pctOfRev: true, revDenom: "company", series: series("chemical_expense", "company") },
    { key: "fuel", label: "Fuel", group: "cost", unit: "usd", higherIsBetter: false, companyWide: true, pctOfRev: true, revDenom: "company", series: series("fuel", "company") },
  ];

  // Drop any metric with no data at all (keeps the board honest if the model changes).
  const present = metrics.filter((m) => [m.series.month, m.series.ytd, m.series.fy].some((c) => c.actual != null));

  // Book-growth chart: real monthly actuals for New Sales vs Cancellations.
  // Prefer branch-level monthly data; fall back to company if a branch has none.
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

  const payload = {
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

  const branchHref = (key: string) => {
    const params = new URLSearchParams();
    params.set("branch", key);
    return `/management/branch-pnl?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Branch P&L — Budget vs Actual"
        subtitle={`${branchLabel(branch)} · ${period.label}`}
      />

      {/* Branch selector (admins / exec only; branch managers are pinned) */}
      {!locked && (
        <div className="mb-5 flex flex-wrap gap-2">
          {visibleBranches.map((b) => {
            const sel = b.key === branch;
            return (
              <Link
                key={b.key}
                href={branchHref(b.key)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                  sel ? "border-transparent bg-emerald-grad text-white shadow" : "border-line bg-white text-ink hover:border-brand-300"
                }`}
              >
                {b.label}
              </Link>
            );
          })}
        </div>
      )}

      <BranchPnlClient payload={payload} />
    </>
  );
}
