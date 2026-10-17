import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser, branchLocked, canViewExec } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods, resolvePeriod, periodValues, type Scope } from "@/lib/management";
import { buildDashboardPayload } from "@/lib/branch-pnl";
import Controls from "@/app/(app)/management/Controls";
import BranchDashboard, { type DBasis } from "@/components/BranchDashboard";
import { teamFunnel } from "@/lib/sales-funnel";
import { currentPeriodKey } from "@/lib/sales";
import MyBranchViewToggle from "@/app/(app)/my-branch/MyBranchViewToggle";
import KpiSummaryButton from "@/components/KpiSummaryButton";
import InsightsLink from "@/components/InsightsLink";

export const dynamic = "force-dynamic";

// Branch & Company KPIs — the single most important analytics surface. ONE
// cohesive, interactive budget-vs-actual-vs-forecast dashboard over real MBR
// data, scoped by role: branch managers (branch-locked) are pinned to THEIR
// branch; admins / super admins / exec default COMPANY-WIDE with a branch
// drill-down. Period + basis (Month · YTD · Full-Year Forecast) are URL-driven
// (`?p=`, `?basis=`) so the whole board re-scopes; section tabs live in the
// client. This is the canonical OPERATING view. Financial statement reporting
// (full P&L, balance sheet, cash flow) lives on the Board — Financial statements
// dashboard (/management/board); the leaner Executive — Operating summary is at
// /executive. Prisma is server-only: the page computes a serializable payload and
// hands it to the client renderer.
export default async function BranchKpisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const locked = branchLocked(user);
  // Insights (grounded AI Q&A) is admin + senior-leadership only — same gate as
  // /management/insights. Surfaced consistently from each leadership dashboard.
  const canInsights = user.role === "admin" || user.seniorLeadership;
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
  // Basis is URL-driven (Month · YTD · Full-Year Forecast). cy_forecast maps to
  // the dashboard's "fy" basis; the AI summary only speaks month/ytd.
  const basisParam = sp.basis === "month" ? "month" : sp.basis === "cy_forecast" ? "cy_forecast" : "ytd";
  const basis: DBasis = basisParam === "month" ? "month" : basisParam === "cy_forecast" ? "fy" : "ytd";

  const values = await periodValues(period.id);

  // Sales funnel for this scope — Leads → Proposals → Closed (# and $). Tied to
  // the current sales month, not the MBR report period. Folded into the board.
  const { totals: funnel } = await teamFunnel(currentPeriodKey(), branch);

  const payload = await buildDashboardPayload(
    values,
    scope,
    locked,
    { id: period.id, year: period.year, month: period.month, label: period.label },
    basis,
    { leads: funnel.leads, proposals: funnel.proposals, deals: funnel.deals, closed: funnel.closed, goal: funnel.goal },
  );

  const selector = !locked ? (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1 w-fit">
      <Link href={`/management?p=${periodKey}&basis=${basisParam}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isCompany ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>All branches</Link>
      {BRANCHES.map((b) => (
        <Link key={b.key} href={`/management?branch=${b.key}&p=${periodKey}&basis=${basisParam}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${branch === b.key ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>{b.label}</Link>
      ))}
    </div>
  ) : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={isCompany ? "Company KPIs" : "Branch KPIs"}
          subtitle={`${scopeLabel} · ${period.label} · budget vs actual vs forecast`}
          actions={canInsights ? <InsightsLink /> : undefined}
        />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basisParam}
          forecast
        />
      </div>

      <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
      {selector}

      <KpiSummaryButton scope={scope} p={periodKey} basis={basisParam === "month" ? "month" : "ytd"} forecastBasis={basisParam === "cy_forecast"} label={isCompany ? "AI company summary" : "AI branch summary"} />

      <BranchDashboard payload={payload} />

      <div className="mt-6 flex flex-col gap-1 text-xs text-muted">
        <p>
          Looking for the company financial statements — full P&amp;L, balance sheet and cash flow?{" "}
          {branchLocked(user) ? "Those live on the Board — Financial statements dashboard (leadership access)." : <Link href="/management/board" className="font-medium text-brand-700 hover:underline">Open Board — Financial statements →</Link>}
        </p>
        {!branchLocked(user) ? (
          <p>
            For the leadership operating summary,{" "}
            <Link href="/executive" className="font-medium text-brand-700 hover:underline">open Executive — Operating →</Link>
          </p>
        ) : null}
        {canViewExec(user) ? (
          <p>
            Compare the four branches side by side —{" "}
            <Link href="/management/benchmarking" className="font-medium text-brand-700 hover:underline">open Branch Benchmarking →</Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
