import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { branchLocked, canViewExec, type SessionUser } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods, resolvePeriod, periodValues, type Scope } from "@/lib/management";
import { buildDashboardPayload } from "@/lib/branch-pnl";
import { completedQuarters, scopeQuarterAll } from "@/lib/branch-kpis";
import Controls from "@/app/(app)/management/Controls";
import BranchDashboard, { type DBasis } from "@/components/BranchDashboard";
import BranchQuarters from "@/components/BranchQuarters";
import { teamFunnel } from "@/lib/sales-funnel";
import { currentPeriodKey } from "@/lib/sales";
import { getProductionRollup } from "@/lib/branch-production-ingest";
import { collectAttention } from "@/lib/needs-attention";
import { buildExecutiveRhythm } from "@/lib/rhythm";
import RhythmRibbon from "@/components/RhythmRibbon";
import NeedsAttentionList from "@/components/NeedsAttentionList";
import MyBranchViewToggle from "@/app/(app)/my-branch/MyBranchViewToggle";
import KpiSummaryButton from "@/components/KpiSummaryButton";

// Executive dashboard — OVERVIEW tab. The role-scoped operating budget-vs-actual-
// vs-forecast dashboard over real MBR data (headline KPIs, pacing to budget, FY
// forecast, sales-funnel snapshot). Branch managers (branch-locked) are pinned to
// THEIR branch; admins / super admins / exec default COMPANY-WIDE with a branch
// drill-down — the same role-scoping the former `/management` Company KPIs page
// served, preserved verbatim. Period + basis are URL-driven (`?p=`, `?basis=`) so
// the whole board re-scopes; the active tab (`?tab=overview`) is preserved by the
// Controls. Deeper financial detail lives on the Branches / Financials tabs
// (exec-only). Prisma is server-only: the panel computes a serializable payload
// and hands it to the client renderer.
export async function OverviewPanel({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | undefined>;
}) {
  const locked = branchLocked(user);
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = locked ? (user.branch ?? BRANCHES[0].key) : requested;
  const isCompany = branch === null;
  const scope: Scope = (isCompany ? "company" : branch) as Scope;
  const branchQuery = branch ? `?branch=${branch}` : "";
  const scopeLabel = isCompany ? "All branches" : branchLabel(branch!);

  // Route-completion rollup for leadership — surfaces the Branch Command completion
  // signal where execs look, deep-linking into each branch's command center.
  const prodRollup = !locked ? await getProductionRollup(BRANCHES.map((b) => b.key)) : null;

  // Leadership "what needs me" — the exec attention queue + rhythm, on the landing tab
  // (moved here from the Branches tab so it's the first thing a leader sees). Exec only;
  // branch managers reaching Overview via the toggle use their own My Branch worklist.
  const now = new Date();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const execAttention = !locked ? await collectAttention({ user, audience: "executive", now }) : [];
  const renewalKinds = new Set(["policy_renewal", "license_expiring", "lease_expiring"]);
  const findCount = (kind: string) => execAttention.filter((a) => a.kind === kind).reduce((s, a) => s + (a.count ?? 1), 0);
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const execRhythm = !locked
    ? buildExecutiveRhythm({
        now, quarter,
        overdueFollowUps: findCount("audit_followup"),
        missedChecklists: findCount("checklist_miss"),
        mbrMissing: execAttention.some((a) => a.kind === "mbr_missing"),
        mbrMonthLabel: lastMonthDate.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
        warehouseMissing: findCount("warehouse_due"),
        warehouseTotal: BRANCHES.length,
        auditsMissing: findCount("audit_missing"),
        auditsTotal: BRANCHES.length,
        renewals: execAttention.filter((a) => renewalKinds.has(a.kind)).length,
      })
    : null;
  const attentionBlock = !locked && execRhythm ? (
    <div className="mb-5">
      <RhythmRibbon segments={execRhythm} />
      <NeedsAttentionList
        items={execAttention}
        title="Needs your attention"
        showBranch
        emptyText="Every branch is current — audits in, inspections logged, renewals clear."
        className="mb-2"
      />
    </div>
  ) : null;

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title={isCompany ? "Company KPIs" : "Branch KPIs"} subtitle={scopeLabel} />
        <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
        {attentionBlock}
        <EmptyState title="No report data yet" hint="KPIs populate once a Monthly Board Report is uploaded." />
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  // Basis is URL-driven (Month · YTD · Full-Year Forecast · a completed quarter).
  // cy_forecast maps to the dashboard's "fy" basis; a "qN" basis opens the quarter
  // view (Production / New Sales / Cancellations only — the metrics with real
  // monthly history). The AI summary only speaks month/ytd.
  const availableQuarters = completedQuarters(period.year);
  const qMatch = /^q([1-4])$/.exec(sp.basis ?? "");
  const quarterSel = qMatch && availableQuarters.includes(Number(qMatch[1])) ? Number(qMatch[1]) : null;
  const basisParam = quarterSel
    ? `q${quarterSel}`
    : sp.basis === "month"
      ? "month"
      : sp.basis === "cy_forecast"
        ? "cy_forecast"
        : "ytd";
  const basis: DBasis = basisParam === "month" ? "month" : basisParam === "cy_forecast" ? "fy" : "ytd";

  // Quarter view: the three KPIs with true monthly history, summed over the quarter.
  const quarterCells = quarterSel ? await scopeQuarterAll(scope, period.year, quarterSel) : null;

  const values = quarterSel ? null : await periodValues(period.id);

  // Sales funnel for this scope — Leads → Proposals → Closed (# and $). Tied to
  // the current sales month, not the MBR report period. Folded into the board.
  const payload = quarterSel
    ? null
    : await (async () => {
        const { totals: funnel } = await teamFunnel(currentPeriodKey(), branch);
        return buildDashboardPayload(
          values!,
          scope,
          locked,
          { id: period.id, year: period.year, month: period.month, label: period.label },
          basis,
          { leads: funnel.leads, proposals: funnel.proposals, deals: funnel.deals, closed: funnel.closed, goal: funnel.goal },
        );
      })();

  const tabQuery = (extra: string) => `/executive?tab=overview&${extra}`;
  const selector = !locked ? (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1 w-fit">
      <Link href={tabQuery(`p=${periodKey}&basis=${basisParam}`)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isCompany ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>All branches</Link>
      {BRANCHES.map((b) => (
        <Link key={b.key} href={tabQuery(`branch=${b.key}&p=${periodKey}&basis=${basisParam}`)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${branch === b.key ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>{b.label}</Link>
      ))}
    </div>
  ) : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={isCompany ? "Company KPIs" : "Branch KPIs"}
          subtitle={`${scopeLabel} · ${period.label} · budget vs actual vs forecast`}
        />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basisParam}
          basePath="/executive"
          forecast
          quarters={availableQuarters.map((q) => ({ key: `q${q}`, label: `Q${q}` }))}
        />
      </div>

      <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
      {selector}

      {attentionBlock}

      {prodRollup && prodRollup.some((r) => r.periodKey) ? (
        <div className="mb-4 rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted">Route completion · all branches</div>
            <Link href="/branch-command" className="text-xs font-medium text-brand-700 hover:underline">Open Branch Command →</Link>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {prodRollup.map((r) => (
              <Link key={r.branch} href={`/branch-command?branch=${r.branch}`} className="rounded-lg border border-line p-3 hover:bg-black/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{branchLabel(r.branch)}</span>
                  <span className="text-lg font-light tabular-nums text-ink">{r.periodKey ? `${r.completionPct}%` : "—"}</span>
                </div>
                {r.periodKey ? (
                  <div className="mt-1 text-[11px] text-muted">
                    <span className={r.leftBehind > 0 ? "text-red-600" : ""}>{r.leftBehind} left behind</span> · {r.callbacks} callbacks
                  </div>
                ) : <div className="mt-1 text-[11px] text-muted">No month loaded</div>}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <KpiSummaryButton scope={scope} p={periodKey} basis={basisParam === "month" ? "month" : "ytd"} forecastBasis={basisParam === "cy_forecast"} label={isCompany ? "AI company summary" : "AI branch summary"} />

      {quarterSel ? (
        <BranchQuarters scopeLabel={scopeLabel} quarterLabel={`Q${quarterSel} ${period.year}`} cells={quarterCells!} />
      ) : (
        <BranchDashboard payload={payload!} />
      )}

      <div className="mt-6 flex flex-col gap-1 text-xs text-muted">
        <p>
          Looking for the company financial statements — full P&amp;L, balance sheet and cash flow?{" "}
          {branchLocked(user) ? "Those live on the Financials tab (leadership access)." : <Link href="/executive?tab=financials" className="font-medium text-brand-700 hover:underline">Open Financials →</Link>}
        </p>
        {canViewExec(user) ? (
          <p>
            Compare the four branches side by side —{" "}
            <Link href="/executive?tab=branches" className="font-medium text-brand-700 hover:underline">open the Branches tab →</Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
