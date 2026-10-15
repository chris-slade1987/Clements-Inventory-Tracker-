import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods, resolvePeriod, periodValues } from "@/lib/management";
import { buildBranchPnlPayload } from "@/lib/branch-pnl";
import BranchPnlClient, { type Metric } from "@/app/(app)/management/branch-pnl/BranchPnlClient";
import { Gauge, KpiMeter } from "@/components/motivation";
import { money } from "@/lib/format";
import MyBranchViewToggle from "../MyBranchViewToggle";

export const dynamic = "force-dynamic";

// Branch KPIs — the manager's own branch performance (budget-vs-actual), surfaced
// inside My Branch with the v2 motivation gauges so managers see their numbers on
// their home turf and never need the company-wide Executive center. Reuses the
// same `buildBranchPnlPayload` + `BranchPnlClient` as the Executive dashboard's
// branch view, pinned to the manager's branch.
export default async function MyBranchKpisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  // Branch-locked managers are pinned to their own branch; admins/exec may pick one
  // (defaulting to their home branch, else the first branch).
  const branch = scopedBranch(user, requested) ?? user.branch ?? BRANCHES[0].key;
  const locked = branchLocked(user);
  const branchQuery = requested && !locked ? `?branch=${requested}` : "";

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Branch KPIs" subtitle={branchLabel(branch)} />
        <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
        <EmptyState title="No report data yet" hint="Branch KPIs populate once a Monthly Board Report is uploaded." />
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const values = await periodValues(period.id);
  const payload = await buildBranchPnlPayload(values, branch, locked, { year: period.year, month: period.month });

  // v2 headline gauges, drawn from the YTD budget-vs-actual already in the payload.
  const metric = (key: string): Metric | undefined => payload.metrics.find((m) => m.key === key);
  const production = metric("production");
  const netAfterLabor = metric("net_after_labor");
  const newSales = metric("new_sales");
  const stops = metric("stops");

  const ytdActual = (m?: Metric) => m?.series.ytd.actual ?? null;
  const ytdBudget = (m?: Metric) => m?.series.ytd.budget ?? null;

  return (
    <>
      <PageHeader
        title="Branch KPIs"
        subtitle={`${branchLabel(branch)} · ${period.label} · budget vs actual`}
      />
      <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />

      {/* Not branch-locked (admin/exec viewing My Branch): let them pick a branch. */}
      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          {BRANCHES.map((b) => (
            <a
              key={b.key}
              href={`/my-branch/kpis?branch=${b.key}`}
              className={`rounded-lg px-3 py-1.5 text-xs ${branch === b.key ? "bg-emerald-grad text-white shadow-sm" : "text-mint hover:text-white"}`}
            >
              {b.label}
            </a>
          ))}
        </div>
      ) : null}

      {/* Headline attainment — the v2 speedometer leads, YTD $ gauges beside it. */}
      <Card className="p-5 mb-5">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-around">
          {production && ytdBudget(production) ? (
            <div className="flex flex-col items-center">
              <Gauge
                value={ytdActual(production) ?? 0}
                target={ytdBudget(production) ?? 0}
                label="Production vs budget · YTD"
                size={210}
              />
              <div className="mt-1 text-xs text-muted tabular-nums">
                {money(ytdActual(production))} of {money(ytdBudget(production))} budget
              </div>
            </div>
          ) : null}
          <div className="grid w-full max-w-sm gap-4 sm:w-auto">
            {netAfterLabor && ytdBudget(netAfterLabor) ? (
              <KpiMeter
                label="Net after labor · YTD"
                value={ytdActual(netAfterLabor) ?? 0}
                target={ytdBudget(netAfterLabor) ?? 0}
                format={(n) => money(n)}
              />
            ) : null}
            {newSales && ytdBudget(newSales) ? (
              <KpiMeter
                label="New sales · YTD"
                value={ytdActual(newSales) ?? 0}
                target={ytdBudget(newSales) ?? 0}
                format={(n) => money(n)}
              />
            ) : null}
            {stops && ytdBudget(stops) ? (
              <KpiMeter
                label="Stops completed · YTD"
                value={ytdActual(stops) ?? 0}
                target={ytdBudget(stops) ?? 0}
                format={(n) => n.toLocaleString()}
              />
            ) : null}
          </div>
        </div>
      </Card>

      {/* Full budget-vs-actual detail — the same client the Executive dashboard uses. */}
      <BranchPnlClient payload={payload} />
    </>
  );
}
