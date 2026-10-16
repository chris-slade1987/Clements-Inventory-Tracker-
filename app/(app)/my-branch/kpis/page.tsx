import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods, resolvePeriod, periodValues, cell, type Scope } from "@/lib/management";
import { buildBranchPnlPayload } from "@/lib/branch-pnl";
import BranchPnlClient, { type Metric } from "@/app/(app)/management/branch-pnl/BranchPnlClient";
import { Gauge, KpiMeter } from "@/components/motivation";
import { KpiTile } from "@/components/kpi-tiles";
import { money } from "@/lib/format";
import MyBranchViewToggle from "../MyBranchViewToggle";
import KpiSummaryButton from "@/components/KpiSummaryButton";

export const dynamic = "force-dynamic";

// KPIs inside My Branch. Scope-aware:
//   • Branch managers (branch-locked) → pinned to THEIR OWN branch.
//   • Admins / super admins / exec → COMPANY-WIDE by default (all branches), with
//     a selector to drill into any one branch. They are never pinned to a single
//     branch — the company is the default perspective.
// Reuses the same `buildBranchPnlPayload` + `BranchPnlClient` as the Executive
// dashboard for the per-branch view, and company KPI cells for the company view.
export default async function MyBranchKpisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const locked = branchLocked(user);
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  // Locked managers: always their own branch. Non-locked: a branch only if they
  // explicitly picked one; otherwise the company-wide view.
  const branch = locked ? (user.branch ?? BRANCHES[0].key) : requested;
  const isCompany = branch === null;
  const branchQuery = branch ? `?branch=${branch}` : "";

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title={isCompany ? "Company KPIs" : "Branch KPIs"} subtitle={isCompany ? "All branches" : branchLabel(branch!)} />
        <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
        <EmptyState title="No report data yet" hint="KPIs populate once a Monthly Board Report is uploaded." />
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const values = await periodValues(period.id);

  // Branch selector — non-locked users get "All branches" (company) + each branch.
  const selector = !locked ? (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1 w-fit">
      <Link
        href="/my-branch/kpis"
        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isCompany ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}
      >
        All branches
      </Link>
      {BRANCHES.map((b) => (
        <Link
          key={b.key}
          href={`/my-branch/kpis?branch=${b.key}`}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${branch === b.key ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}
        >
          {b.label}
        </Link>
      ))}
    </div>
  ) : null;

  // ---- Company-wide view (admins/exec, no branch selected) ------------------
  if (isCompany) {
    const c = (kpi: string) => cell(values, kpi, "company" as Scope, "ytd");
    const netRev = c("net_revenue");
    const production = c("production");
    const netAfterLabor = c("net_after_labor");
    const newSales = c("new_sales");
    // More headline + cost KPIs so the company view is rich on its own.
    const routeContribPct = c("route_contrib_pct");
    const marginPct = c("margin_pct");
    const attrition = c("attrition");
    const techWages = c("tech_wages");
    const fuel = c("fuel");
    const chemical = c("chemical_expense");
    const revActual = netRev.actual ?? 0;
    const pOfRev = (x: typeof netRev) => (revActual > 0 && x.actual != null ? (x.actual / revActual) * 100 : null);
    const headlineDefs: { label: string; c: typeof netRev; unit: "usd" | "pct" | "count" }[] = [
      { label: "Net revenue", c: netRev, unit: "usd" },
      { label: "Production", c: production, unit: "usd" },
      { label: "Net after labor", c: netAfterLabor, unit: "usd" },
      { label: "New sales", c: newSales, unit: "usd" },
      { label: "Margin %", c: marginPct, unit: "pct" },
      { label: "Route contribution %", c: routeContribPct, unit: "pct" },
      { label: "Attrition", c: attrition, unit: "usd" },
    ];
    const headlineTiles = headlineDefs.filter((t) => t.c.actual != null || t.c.budget != null);
    const costTiles = [
      { label: "Technician wages", c: techWages },
      { label: "Fuel", c: fuel },
      { label: "Chemical expense", c: chemical },
    ].filter((t) => t.c.actual != null || t.c.budget != null);

    return (
      <>
        <PageHeader title="Company KPIs" subtitle={`All branches · ${period.label} · budget vs actual`} />
        <MyBranchViewToggle view="kpis" branchQuery="" />
        {selector}

        <KpiSummaryButton scope="company" p={periodKey} basis="ytd" label="AI company summary" />

        {/* Company headline — net revenue speedometer + YTD $ meters. */}
        <Card className="p-5 mb-5">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-around">
            {netRev.budget ? (
              <div className="flex flex-col items-center">
                <Gauge value={netRev.actual ?? 0} target={netRev.budget ?? 0} label="Net revenue vs budget · YTD" size={210} />
                <div className="mt-1 text-xs text-muted tabular-nums">
                  {money(netRev.actual)} of {money(netRev.budget)} budget
                </div>
              </div>
            ) : null}
            <div className="grid w-full max-w-sm gap-4 sm:w-auto">
              {production.budget ? <KpiMeter label="Production · YTD" value={production.actual ?? 0} target={production.budget ?? 0} format={(n) => money(n)} /> : null}
              {netAfterLabor.budget ? <KpiMeter label="Net after labor · YTD" value={netAfterLabor.actual ?? 0} target={netAfterLabor.budget ?? 0} format={(n) => money(n)} /> : null}
              {newSales.budget ? <KpiMeter label="New sales · YTD" value={newSales.actual ?? 0} target={newSales.budget ?? 0} format={(n) => money(n)} /> : null}
            </div>
          </div>
        </Card>

        {/* Company KPI tiles — actual vs budget with variance + budget bars. */}
        {headlineTiles.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
              <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> Company KPIs · YTD
            </h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {headlineTiles.map((t) => (
                <KpiTile key={t.label} label={t.label} c={t.c} unit={t.unit} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Break it down by branch — production YTD per branch, click to drill in. */}
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> By branch · production YTD
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
          {BRANCHES.map((b) => {
            const prod = cell(values, "production", b.key as Scope, "ytd");
            return (
              <Link key={b.key} href={`/my-branch/kpis?branch=${b.key}`} className="block">
                <Card className="p-4 overflow-hidden transition hover:ring-1 hover:ring-brand-300">
                  <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
                  <div className="text-xs font-medium uppercase tracking-wider text-muted">{b.label}</div>
                  <div className="mt-2 text-2xl font-light tabular-nums">{money(prod.actual)}</div>
                  <div className="text-[11px] text-muted">production · YTD</div>
                  {prod.budget ? (
                    <div className={`mt-1 text-[11px] ${(prod.actual ?? 0) >= prod.budget ? "text-brand-700" : "text-amber-600"}`}>
                      {Math.round(((prod.actual ?? 0) / prod.budget) * 100)}% of budget
                    </div>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
        {/* Cost lines — actual vs budget, each as % of revenue. */}
        {costTiles.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
              <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> Costs · YTD
            </h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
              {costTiles.map((t) => (
                <KpiTile key={t.label} label={t.label} c={t.c} unit="usd" pctOfRev={pOfRev(t.c)} />
              ))}
            </div>
          </section>
        ) : null}

        <p className="mb-6 text-xs text-muted">
          Need the full P&amp;L, charts, waterfall and board view?{" "}
          <Link href="/management" className="font-medium text-brand-700 hover:underline">Open the Executive dashboard →</Link>
        </p>
      </>
    );
  }

  // ---- Single-branch view (a branch manager, or an admin who picked one) -----
  const payload = await buildBranchPnlPayload(values, branch!, locked, { year: period.year, month: period.month });
  const metric = (key: string): Metric | undefined => payload.metrics.find((m) => m.key === key);
  const production = metric("production");
  const netAfterLabor = metric("net_after_labor");
  const newSales = metric("new_sales");
  const stops = metric("stops");
  const ytdActual = (m?: Metric) => m?.series.ytd.actual ?? null;
  const ytdBudget = (m?: Metric) => m?.series.ytd.budget ?? null;

  return (
    <>
      <PageHeader title="Branch KPIs" subtitle={`${branchLabel(branch!)} · ${period.label} · budget vs actual`} />
      <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
      {selector}

      <KpiSummaryButton scope={branch!} p={periodKey} basis="ytd" label="AI branch summary" />

      <Card className="p-5 mb-5">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-around">
          {production && ytdBudget(production) ? (
            <div className="flex flex-col items-center">
              <Gauge value={ytdActual(production) ?? 0} target={ytdBudget(production) ?? 0} label="Production vs budget · YTD" size={210} />
              <div className="mt-1 text-xs text-muted tabular-nums">
                {money(ytdActual(production))} of {money(ytdBudget(production))} budget
              </div>
            </div>
          ) : null}
          <div className="grid w-full max-w-sm gap-4 sm:w-auto">
            {netAfterLabor && ytdBudget(netAfterLabor) ? (
              <KpiMeter label="Net after labor · YTD" value={ytdActual(netAfterLabor) ?? 0} target={ytdBudget(netAfterLabor) ?? 0} format={(n) => money(n)} />
            ) : null}
            {newSales && ytdBudget(newSales) ? (
              <KpiMeter label="New sales · YTD" value={ytdActual(newSales) ?? 0} target={ytdBudget(newSales) ?? 0} format={(n) => money(n)} />
            ) : null}
            {stops && ytdBudget(stops) ? (
              <KpiMeter label="Stops completed · YTD" value={ytdActual(stops) ?? 0} target={ytdBudget(stops) ?? 0} format={(n) => n.toLocaleString()} />
            ) : null}
          </div>
        </div>
      </Card>

      <BranchPnlClient payload={payload} />
    </>
  );
}
