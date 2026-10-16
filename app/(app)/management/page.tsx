import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods, resolvePeriod, periodValues, cell, type Scope, type Cell } from "@/lib/management";
import { buildBranchPnlPayload } from "@/lib/branch-pnl";
import BranchPnlClient from "@/app/(app)/management/branch-pnl/BranchPnlClient";
import { teamFunnel } from "@/lib/sales-funnel";
import { Gauge } from "@/components/motivation";
import { KpiTile } from "@/components/kpi-tiles";
import { money, qty } from "@/lib/format";
import { currentPeriodKey } from "@/lib/sales";
import MyBranchViewToggle from "@/app/(app)/my-branch/MyBranchViewToggle";
import KpiSummaryButton from "@/components/KpiSummaryButton";

export const dynamic = "force-dynamic";

// Company / Branch KPIs — the OPERATIONAL manager metrics: revenue, sales,
// cancels (attrition), activity, and expenses. ONE metric set for everyone; the
// only difference is the default scope:
//   • Branch managers (branch-locked) → pinned to THEIR branch.
//   • Admins / super admins / exec → COMPANY-WIDE by default, with a branch
//     drill-down (and per-branch breakdown cards).
// Financial reporting (P&L, balance sheet, debt ratios, cash flow) is NOT here —
// that lives in the Executive dashboard. This view is rev/sales/cancels/expenses.
export default async function MyBranchKpisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const locked = branchLocked(user);
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = locked ? (user.branch ?? BRANCHES[0].key) : requested;
  const isCompany = branch === null;
  const scope: Scope = (isCompany ? "company" : branch) as Scope;
  const branchQuery = branch ? `?branch=${branch}` : "";
  const scopeLabel = isCompany ? "All branches" : branchLabel(branch!);

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title={isCompany ? "Company KPIs" : "Branch KPIs"} subtitle={scopeLabel} />
        <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
        <EmptyState title="No report data yet" hint="KPIs populate once a Monthly Board Report is uploaded." />
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const values = await periodValues(period.id);
  const c = (kpi: string, s: Scope = scope) => cell(values, kpi, s, "ytd");

  // Revenue headline: company = net revenue; a branch = its production.
  const revKey = isCompany ? "net_revenue" : "production";
  const revLabel = isCompany ? "Net revenue" : "Production";
  const rev = c(revKey);
  const revActual = rev.actual ?? 0;
  const pOfRev = (x: Cell) => (revActual > 0 && x.actual != null ? (x.actual / revActual) * 100 : null);

  // Operational KPI tiles (revenue · sales · cancels · activity) — same set for
  // company and branch, only the scope differs.
  const opDefs: { label: string; c: Cell; unit: "usd" | "pct" | "count" }[] = [
    { label: revLabel, c: rev, unit: "usd" },
    ...(isCompany ? [{ label: "Production", c: c("production"), unit: "usd" as const }] : []),
    { label: "New sales", c: c("new_sales"), unit: "usd" },
    { label: "Cancels (attrition)", c: c("attrition"), unit: "usd" },
    { label: "Stops completed", c: c("stops"), unit: "count" },
  ];
  const opTiles = opDefs.filter((t) => t.c.actual != null || t.c.budget != null);

  // Expenses (operational cost lines) — each as % of revenue.
  const costDefs: { label: string; c: Cell }[] = [
    { label: "Technician wages", c: c("tech_wages") },
    { label: "Fuel", c: c("fuel") },
    { label: "Chemical expense", c: c("chemical_expense") },
  ];
  const costTiles = costDefs.filter((t) => t.c.actual != null || t.c.budget != null);

  // Branch view: the FULL budget-vs-actual board — real per-branch fuel (from fuel
  // transactions), chemical, tech wages, production, net-after-labor/margin, stops,
  // new sales — with monthly charts. This is the operational expense + performance
  // detail managers need (company financials/P&L stay on the Executive dashboard).
  const branchPnl = !isCompany ? await buildBranchPnlPayload(values, scope, locked, { year: period.year, month: period.month }) : null;

  // Sales funnel for this scope — Leads → Proposals → Closed (# and $). Tied to the
  // current sales month (SalesPeriodStat), not the MBR report period.
  const funnelKey = currentPeriodKey();
  const { totals: funnel } = await teamFunnel(funnelKey, branch);
  const funnelStages = [
    { label: "Leads", value: qty(funnel.leads), raw: funnel.leads },
    { label: "Proposals", value: qty(funnel.proposals), raw: funnel.proposals },
    { label: "Closed deals", value: qty(funnel.deals), raw: funnel.deals },
    { label: "Closed $", value: money(funnel.closed), raw: funnel.closed },
  ];
  const funnelHasData = funnel.leads > 0 || funnel.proposals > 0 || funnel.deals > 0 || funnel.closed > 0;
  const funnelMax = Math.max(1, funnel.leads, funnel.proposals, funnel.deals);
  const convLtoP = funnel.leads > 0 ? Math.round((funnel.proposals / funnel.leads) * 100) : null;
  const convPtoD = funnel.proposals > 0 ? Math.round((funnel.deals / funnel.proposals) * 100) : null;

  const selector = !locked ? (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1 w-fit">
      <Link href="/management" className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isCompany ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>All branches</Link>
      {BRANCHES.map((b) => (
        <Link key={b.key} href={`/management?branch=${b.key}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${branch === b.key ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>{b.label}</Link>
      ))}
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        title={isCompany ? "Company KPIs" : "Branch KPIs"}
        subtitle={`${scopeLabel} · ${period.label} · revenue · sales · cancels · expenses`}
      />
      <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
      {selector}

      <KpiSummaryButton scope={scope} p={periodKey} basis="ytd" label={isCompany ? "AI company summary" : "AI branch summary"} />

      {/* Headline speedometer — revenue vs budget YTD. */}
      {rev.budget ? (
        <Card className="p-5 mb-5">
          <div className="flex flex-col items-center gap-2">
            <Gauge value={rev.actual ?? 0} target={rev.budget ?? 0} label={`${revLabel} vs budget · YTD`} size={210} />
            <div className="text-xs text-muted tabular-nums">{money(rev.actual)} of {money(rev.budget)} budget</div>
          </div>
        </Card>
      ) : null}

      {/* Operational KPIs — revenue · sales · cancels · activity. */}
      {opTiles.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> Performance · YTD
          </h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {opTiles.map((t) => <KpiTile key={t.label} label={t.label} c={t.c} unit={t.unit} />)}
          </div>
        </section>
      ) : null}

      {/* Expenses — company cost lines, each as % of revenue (company scope).
          A single branch gets the FULL budget-vs-actual board below, which carries
          real per-branch fuel, chemical and tech-wage detail. */}
      {isCompany && costTiles.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> Expenses · YTD
          </h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
            {costTiles.map((t) => <KpiTile key={t.label} label={t.label} c={t.c} unit="usd" pctOfRev={pOfRev(t.c)} />)}
          </div>
        </section>
      ) : null}

      {/* Branch scope: the FULL budget-vs-actual board — production, net-after-labor
          / margin, stops, new sales, technician wages, fuel (real per-branch) and
          chemical, with monthly charts. The expense detail managers need. */}
      {!isCompany && branchPnl ? (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> Budget vs actual · {scopeLabel}
          </h2>
          <BranchPnlClient payload={branchPnl} />
        </section>
      ) : null}

      {/* Company scope: break it down by branch (click to drill into one). */}
      {isCompany ? (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> By branch · production YTD
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {BRANCHES.map((b) => {
              const prod = cell(values, "production", b.key as Scope, "ytd");
              return (
                <Link key={b.key} href={`/management?branch=${b.key}`} className="block">
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
        </section>
      ) : null}

      {/* Sales funnel — Leads → Proposals → Closed (# and $) for this scope. */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" /> Sales funnel · {scopeLabel}
        </h2>
        <Card className="p-4 sm:p-5">
          {funnelHasData ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {funnelStages.map((s, i) => (
                  <div key={s.label} className="rounded-xl border border-line bg-white p-3 text-center">
                    <div className="text-[11px] uppercase tracking-wide text-muted">{s.label}</div>
                    <div className="mt-1 text-2xl font-light tabular-nums text-ink">{s.value}</div>
                    {i < 3 ? (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                        <div className="h-full rounded-full bg-emerald-grad" style={{ width: `${Math.round((s.raw / funnelMax) * 100)}%` }} />
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-muted">{funnel.goal > 0 ? `${Math.round((funnel.closed / funnel.goal) * 100)}% of goal` : "closed this month"}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                {convLtoP != null ? <span><span className="font-medium text-ink">{convLtoP}%</span> of leads → proposals</span> : null}
                {convPtoD != null ? <span><span className="font-medium text-ink">{convPtoD}%</span> of proposals → closed</span> : null}
                <Link href="/sales" className="font-medium text-brand-700 hover:underline">Open the Sales Team board →</Link>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted">No funnel activity logged for {scopeLabel} this month yet. Leads, proposals and closes appear here as the sales team logs them (or once SmarterLaunch is connected).</p>
              <Link href="/sales" className="text-xs font-medium text-brand-700 hover:underline">Open the Sales Team board →</Link>
            </div>
          )}
        </Card>
      </section>

      {opTiles.length === 0 && costTiles.length === 0 && !branchPnl ? (
        <EmptyState title="No KPIs for this scope yet" hint="Operational KPIs populate once a Monthly Board Report is loaded for this period." />
      ) : null}

      <p className="mb-6 text-xs text-muted">
        Looking for the company financials — P&amp;L, margins, forecast and the board view?{" "}
        {branchLocked(user) ? "Those live in the Executive dashboard (leadership access)." : <Link href="/executive" className="font-medium text-brand-700 hover:underline">Open the Executive dashboard →</Link>}
      </p>
    </>
  );
}
