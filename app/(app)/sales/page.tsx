import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, canManageSales, canViewSales, branchLocked } from "@/lib/auth";
import { money, qty } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { prisma } from "@/lib/prisma";
import { salesDirectorDashboard, currentPeriodKey, periodLabel, otherSalesSummary, listNonAdvisorEmployees } from "@/lib/sales";
import { teamFunnel, buildLeaderboards, diagnoseFunnel, salesPace, stageStatus, type AdvisorFunnel } from "@/lib/sales-funnel";
import { focusRollup, focusTypeLabel, type FocusRollupRow } from "@/lib/sales-focus";
import MyReviewsCard from "@/components/MyReviewsCard";
import LeadInsightsSection from "@/components/LeadInsightsSection";
import { resolveRange } from "@/lib/sales-leads";
import { smarterLaunchConfigured } from "@/lib/smarterlaunch";
import FunnelEntryButton from "./FunnelEntryButton";
import SalesDirectorTools from "./SalesDirectorTools";
import AllBranchSales from "./AllBranchSales";
import FunnelHealthBoard, { type HealthRow } from "@/components/FunnelHealthBoard";
import { AchievementBar, ProgressRing, rampColor, encouragement, rankMedal } from "@/components/motivation";

export const dynamic = "force-dynamic";

const m = (n: number | null) => (n == null ? "—" : money(n));

// Thin line icons (brand kit §6: 24×24, stroke 1.6, round caps, no fill, currentColor).
function Icon({ path, className = "h-4 w-4" }: { path: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}
const ICONS = {
  leads: <path d="M3 5h18M6 5l5 7v5l2 2v-7l5-7" />,
  proposals: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  closed: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M14.5 9.5c-.6-.8-1.6-1.2-2.6-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.4 5 4 0 1.1-1 1.9-2.6 1.9-1.1 0-2.1-.4-2.7-1.2" /></>,
  trendUp: <><path d="M4 18l6-6 4 4 6-7" /><path d="M20 9V5m0 4h-4" /></>,
};

export default async function SalesTeamPage({ searchParams }: { searchParams: Promise<{ branch?: string; range?: string; from?: string; to?: string }> }) {
  const user = await requireUser();
  if (!canViewSales(user)) redirect("/me");
  // Branch managers get a READ-ONLY view scoped to their own branch's advisors;
  // admins / the Sales Director manage everything cross-branch.
  const canManage = canManageSales(user);
  const locked = branchLocked(user);

  const sp = await searchParams;
  const branch = locked ? user.branch : (BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);
  const range = resolveRange(sp.range, sp.from, sp.to);
  const periodKey = currentPeriodKey();
  const { advisorRows, byBranch, totals, actuals } = await salesDirectorDashboard(periodKey, branch);
  const { rows: funnelRows, totals: funnelTotals } = await teamFunnel(periodKey, branch);
  const boards = buildLeaderboards(funnelRows);
  const teamAttainPct = funnelTotals.goal > 0 ? (funnelTotals.closed / funnelTotals.goal) * 100 : 0;
  const goalsSetPct = funnelTotals.advisors > 0 ? (funnelTotals.withGoal / funnelTotals.advisors) * 100 : 0;
  const pLabel = periodLabel(periodKey);
  const pace = salesPace(periodKey);

  // Day-of-month framing for the pace board.
  const nowD = new Date();
  const [pY, pM] = periodKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(pY, pM, 0)).getUTCDate();
  const isCurMonth = periodKey === `${nowD.getUTCFullYear()}-${String(nowD.getUTCMonth() + 1).padStart(2, "0")}`;
  const dayOfMonth = isCurMonth ? nowD.getUTCDate() : daysInMonth;

  // Pace-aware, serializable rows for the interactive Funnel-health board.
  const healthRows: HealthRow[] = funnelRows.map((r: AdvisorFunnel) => {
    const d = diagnoseFunnel(r, pace);
    const projected = pace > 0 ? r.closed / pace : r.closed;
    const mk = (actual: number, goal: number) => ({ actual, goal, status: stageStatus(actual, goal, pace), pct: goal > 0 ? Math.min(100, (actual / goal) * 100) : 0 });
    return {
      id: r.advisor.id, name: r.advisor.name, branch: r.advisor.branch ? branchLabel(r.advisor.branch) : null,
      hasGoal: r.hasGoal, hasData: r.hasData,
      goal: r.goal, closed: r.closed, projected,
      goalPct: r.goal > 0 ? Math.min(100, (r.closed / r.goal) * 100) : 0,
      overall: stageStatus(r.closed, r.goal, pace),
      stages: [
        { key: "leads", label: "Leads", ...mk(r.leads, r.leadsGoal) },
        { key: "proposals", label: "Proposals", ...mk(r.proposals, r.propGoal) },
        { key: "closing", label: "Closing $", money: true, ...mk(r.closed, r.goal) },
      ],
      diag: { key: d.key, label: d.label, msg: d.msg },
    };
  });
  const demoCount = await prisma.salesPeriodStat.count({ where: { periodKey, source: "demo" } });
  const slLive = smarterLaunchConfigured();

  // The director's actionable gap: advisors who haven't set this period's goal.
  const notSet = advisorRows.filter((r) => !r.hasGoal);
  // Advisors who submitted a goal for the director's sign-off.
  const pendingApproval = advisorRows.filter((r) => r.pendingApproval);

  // ── All branch sales: Sales Team (advisors) + Other (techs/managers/leadership) ──
  // Service advisors are the only ones tracked for goals/pacing; everyone else's
  // closed $ rolls up to the branch here so the true total book is visible.
  const otherSummary = await otherSalesSummary(periodKey, branch);
  const sellers = canManage ? await listNonAdvisorEmployees(branch) : [];
  const branchKeys = branch ? [branch] : BRANCHES.map((b) => b.key);
  const teamByBranch: Record<string, number> = {};
  for (const r of funnelRows) if (r.advisor.branch) teamByBranch[r.advisor.branch] = (teamByBranch[r.advisor.branch] ?? 0) + r.closed;
  const branchSalesRows = branchKeys
    .map((bk) => {
      const team = teamByBranch[bk] ?? 0;
      const other = otherSummary.byBranch[bk]?.closed ?? 0;
      return { branch: bk, label: branchLabel(bk), team, other, total: team + other };
    })
    .filter((b) => b.total > 0 || b.branch === branch);
  const otherEntries = otherSummary.entries.map((e) => ({
    id: e.id, branch: e.branch, branchLabel: branchLabel(e.branch),
    sellerName: e.sellerName, sellerRole: e.sellerRole, sellerEmployeeId: e.sellerEmployeeId,
    closedAmount: e.closedAmount, dealsClosed: e.dealsClosed, note: e.note,
  }));
  const showBranchSales = advisorRows.length > 0 || otherEntries.length > 0 || canManage;

  // Focus & follow-ups rollup across advisors (the director's coaching queue).
  const focusNames = new Map(advisorRows.map((r) => [r.advisor.id, { name: r.advisor.name, branch: r.advisor.branch }]));
  const rollup = await focusRollup(periodKey, advisorRows.map((r) => r.advisor.id), focusNames);
  const showFocus = rollup.counts.actions > 0;

  return (
    <>
      <PageHeader
        title="Sales Team"
        subtitle={
          locked && branch
            ? `${branchLabel(branch)} — how your sales team is performing · ${periodLabel(periodKey)}`
            : `Targets, closed & pipeline across all branches — ${periodLabel(periodKey)}`
        }
        actions={canManage ? <Link href="/management/sales" className="text-sm font-medium text-brand-700 hover:underline">Sales &amp; Attrition analytics →</Link> : undefined}
      />

      <MyReviewsCard userId={user.id} />

      {canManage ? <SalesDirectorTools periodKey={periodKey} hasDemo={demoCount > 0} live={slLive} /> : null}

      {/* actuals connection state */}
      <div className={`mb-4 rounded-xl border px-4 py-2.5 text-sm ${actuals.connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {actuals.connected
          ? <><strong>Closed &amp; pipeline are live</strong> — synced from the sales system{actuals.syncedAt ? ` (last update ${new Date(actuals.syncedAt).toLocaleDateString()})` : ""}. Targets are from advisor goal sheets.</>
          : <><strong>Targets are live</strong> from advisor goal sheets. <strong>Closed &amp; pipeline</strong> will populate here automatically once the sales system (WorkWave) is connected.</>}
      </div>

      {/* branch filter — admins/director only; branch managers are pinned to theirs */}
      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <Pill href="/sales" active={!branch}>All branches</Pill>
          {BRANCHES.map((b) => (
            <Pill key={b.key} href={`/sales?branch=${b.key}`} active={branch === b.key}>{b.label}</Pill>
          ))}
        </div>
      ) : null}

      {/* ───────── 1. Needs your attention — the actionable goal-setting gap ───────── */}
      {advisorRows.length > 0 ? (
        <div className="mb-5">
          <SectionLabel>Needs your attention</SectionLabel>
          {notSet.length === 0 ? (
            <Card className="flex items-center gap-3 p-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                <Icon path={<path d="M20 6L9 17l-5-5" />} className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-medium text-ink">All {totals.advisors} advisors have set their {pLabel} goals.</div>
                <div className="text-xs text-muted">You&rsquo;re set for the month — track pace below.</div>
              </div>
            </Card>
          ) : (
            <Card className="p-4 ring-1 ring-amber-200">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 text-sm font-semibold tabular-nums">{notSet.length}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{notSet.length} of {totals.advisors} advisor{notSet.length === 1 ? " hasn't" : "s haven't"} set {pLabel} goals</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {notSet.map((r) => (
                      <Link key={r.advisor.id} href={`/sales/${r.advisor.id}`} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100">
                        {r.advisor.name}{r.advisor.branch ? ` · ${branchLabel(r.advisor.branch)}` : ""}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}
          {canManage && pendingApproval.length > 0 ? (
            <Card className="mt-3 p-4 ring-1 ring-amber-200">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 text-sm font-semibold tabular-nums">{pendingApproval.length}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{pendingApproval.length} goal{pendingApproval.length === 1 ? "" : "s"} awaiting your approval</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {pendingApproval.map((r) => (
                      <Link key={r.advisor.id} href={`/sales/${r.advisor.id}`} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100">
                        {r.advisor.name}{r.target > 0 ? ` · ${money(r.target)}` : ""} — review &amp; approve
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* ───────── Focus & follow-ups — the director's coaching queue ───────── */}
      {showFocus ? (
        <div className="mb-5">
          <SectionLabel>Focus &amp; follow-ups · {pLabel}</SectionLabel>
          <Card className="p-4">
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <FocusStat n={rollup.counts.actions} label="Planned actions" />
              <FocusStat n={rollup.counts.overdue} label="Follow-ups due" tone={rollup.counts.overdue > 0 ? "warn" : undefined} />
              <FocusStat n={rollup.counts.logged} label="Outcomes logged" tone={rollup.counts.logged > 0 ? "good" : undefined} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <FocusColumn title="Overdue follow-ups" empty="Nothing overdue — nice." rows={rollup.overdue} tone="warn" />
              <FocusColumn title="Upcoming" empty="No upcoming follow-ups." rows={rollup.upcoming.slice(0, 8)} />
              <FocusColumn title="Recently logged" empty="No outcomes logged yet." rows={rollup.logged.slice(0, 8)} tone="good" showOutcome />
            </div>
          </Card>
        </div>
      ) : null}

      {/* ───────── 2. Team attainment — how the team is tracking to goal ───────── */}
      {funnelRows.length > 0 && (funnelTotals.goal > 0 || funnelTotals.advisors > 0) ? (
        <div className="mb-5">
          <SectionLabel>Team attainment · {pLabel}</SectionLabel>
          <Card className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {funnelTotals.goal > 0 ? (
                <div className="flex shrink-0 items-center gap-4">
                  <ProgressRing value={funnelTotals.closed} target={funnelTotals.goal} size={76} stroke={8} />
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted">Team attainment</div>
                    <div className="text-sm text-ink">{encouragement(teamAttainPct)}{teamAttainPct >= 100 ? <span className="motion-safe:animate-pulse"> 🎉</span> : ""}</div>
                  </div>
                </div>
              ) : null}
              <div className="flex-1 space-y-3">
                {funnelTotals.goal > 0 ? (
                  <AchievementBar
                    label="Closed vs team goal"
                    value={funnelTotals.closed}
                    target={funnelTotals.goal}
                    caption={`${money(funnelTotals.closed)} of ${money(funnelTotals.goal)} this month`}
                    milestones={[{ at: 25 }, { at: 50 }, { at: 75 }]}
                  />
                ) : null}
                <AchievementBar
                  label="Advisors with a goal set"
                  value={funnelTotals.withGoal}
                  target={funnelTotals.advisors}
                  caption={`${funnelTotals.withGoal} of ${funnelTotals.advisors} advisors`}
                  tone="brand"
                />
              </div>
              <div className="shrink-0 text-center">
                <ProgressRing value={goalsSetPct} tone="brand" size={60} stroke={7} />
                <div className="mt-1 text-[11px] text-muted">Goals set</div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {/* company summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Combined target (month)" value={money(totals.target)} />
        <Tile label="Goals set" value={`${totals.withGoal} / ${totals.advisors}`} tone={totals.withGoal < totals.advisors ? "warn" : "good"} />
        <Tile label="Closed (YTD)" value={m(totals.closed)} />
        <Tile label="Open pipeline" value={m(totals.pipeline)} />
      </div>

      {/* ───────── All branch sales — Sales Team + Other, differentiated ───────── */}
      {showBranchSales ? (
        <AllBranchSales
          periodKey={periodKey}
          periodLabel={pLabel}
          canManage={canManage}
          teamClosed={funnelTotals.teamClosed}
          otherClosed={funnelTotals.otherClosed}
          grandClosed={funnelTotals.grandClosed}
          byBranch={branchSalesRows}
          entries={otherEntries}
          sellers={sellers}
          branches={branch ? [{ key: branch, label: branchLabel(branch) }] : BRANCHES.map((b) => ({ key: b.key, label: b.label }))}
          scopedBranch={branch}
        />
      ) : null}

      {/* Lead geographic heat map + lead-source performance (company-wide, honors
          the branch filter and the date-range control). */}
      {canManage ? (
        <LeadInsightsSection
          scope="team"
          branch={branch}
          range={range}
          mapTitle={`Lead heat map${branch ? ` · ${branchLabel(branch)}` : " · all branches"}`}
          mapSubtitle="Where leads are coming in and which neighborhoods have the most density and best close rate. Color-coded by funnel stage — filter to a stage to see pending leads by stage."
        />
      ) : null}

      {funnelRows.length > 0 ? (
        <>
          {/* ───────── 3. Leaderboard — the funnel, ranked ───────── */}
          <SectionLabel>Leaderboard · {pLabel}</SectionLabel>
          <div className="mb-3 grid gap-3 lg:grid-cols-3">
            <MiniBoard title="Leads created" icon={ICONS.leads} rows={boards.leads} fmt={(n) => qty(n)} />
            <MiniBoard title="Proposals made" icon={ICONS.proposals} rows={boards.proposals} fmt={(n) => qty(n)} />
            <MiniBoard title="Closed $" icon={ICONS.closed} rows={boards.closed} fmt={(n) => money(n)} />
          </div>
          {boards.mostImproved ? (
            <Card className="mb-6 flex items-center gap-3 p-3 ring-1 ring-emerald-200">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-lg leading-none" role="img" aria-label="Most improved">📈</span>
              <div className="text-sm text-ink"><span className="font-semibold">Most improved:</span> {boards.mostImproved.advisor.name} — up {money(boards.mostImproved.delta)} in closed vs last month. Momentum is yours. 🚀</div>
            </Card>
          ) : <div className="mb-6" />}

          {/* ───────── 4. Per-advisor funnel — pace-aware, interactive ───────── */}
          <SectionLabel>Funnel health · pace vs. the calendar</SectionLabel>
          <div className="mb-6">
            <FunnelHealthBoard
              rows={healthRows}
              pace={pace}
              monthLabel={pLabel}
              day={dayOfMonth}
              daysInMonth={daysInMonth}
              basePath="/sales"
            />
          </div>

          {/* This month's funnel (editable) */}
          <SectionLabel>This month&rsquo;s funnel</SectionLabel>
          <Card className="mb-6 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table style={{ minWidth: "720px" }} className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Advisor</th>
                    <th className="px-3 py-2 text-right font-medium">Leads</th>
                    <th className="px-3 py-2 text-right font-medium">Proposals</th>
                    <th className="px-3 py-2 text-right font-medium">Lead→Prop</th>
                    <th className="px-3 py-2 text-right font-medium">Deals</th>
                    <th className="px-3 py-2 text-right font-medium">Close %</th>
                    <th className="px-3 py-2 text-right font-medium">Closed $</th>
                    <th className="px-3 py-2 text-right font-medium">vs Goal</th>
                    <th className="px-4 py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {funnelRows.map((r: AdvisorFunnel) => (
                    <tr key={r.advisor.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/sales/${r.advisor.id}`} className="text-brand-700 hover:underline">{r.advisor.name}</Link>
                        {r.advisor.branch ? <span className="ml-2 text-[11px] text-muted">{branchLabel(r.advisor.branch)}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.leads || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.proposals || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.leads ? `${Math.round(r.lpRate * 100)}%` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.deals || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.proposals ? `${Math.round(r.pcRate * 100)}%` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{r.closed ? money(r.closed) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.goal > 0 ? <span className={r.goalPct >= 1 ? "font-medium text-emerald-600" : "text-muted"}>{Math.round(r.goalPct * 100)}%</span> : "—"}</td>
                      <td className="px-4 py-2 text-right">
                        {canManage ? (
                          <FunnelEntryButton advisorId={r.advisor.id} advisorName={r.advisor.name} periodKey={periodKey} periodLabel={pLabel} current={{ leadsCreated: r.leads, proposalsMade: r.proposals, dealsClosed: r.deals, closedAmount: r.closed }} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-4 py-2 text-[11px] text-muted">
              Enter numbers manually for now; they&rsquo;ll flow in automatically once SmarterLaunch is connected (then this stays as an override).
            </div>
          </Card>
        </>
      ) : null}

      {advisorRows.length === 0 ? (
        <EmptyState title="No service advisors yet" hint="Assign the Service Advisor access level to your sales reps in People, and they'll appear here." />
      ) : (
        <>
          {/* by branch */}
          <SectionLabel>By branch</SectionLabel>
          <Card className="mb-6 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table style={{ minWidth: "420px" }} className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 text-right font-medium">Advisors</th>
                    <th className="px-3 py-2 text-right font-medium">Target (month)</th>
                    <th className="px-3 py-2 text-right font-medium">Closed (YTD)</th>
                  </tr>
                </thead>
                <tbody>
                  {byBranch.map((b) => (
                    <tr key={b.branch} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/sales?branch=${b.branch}`} className="text-brand-700 hover:underline">{b.label}</Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{b.withGoal}/{b.advisors} set</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(b.target)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{m(b.closed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* by advisor */}
          <SectionLabel>By service advisor</SectionLabel>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table style={{ minWidth: "640px" }} className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Advisor</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 text-right font-medium">Target (month)</th>
                    <th className="px-3 py-2 text-right font-medium">Sales / day</th>
                    <th className="px-3 py-2 text-right font-medium">Leads / day</th>
                    <th className="px-3 py-2 text-right font-medium">Closed (YTD)</th>
                    <th className="px-4 py-2 text-center font-medium">Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {advisorRows.map((r) => (
                    <tr key={r.advisor.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium"><Link href={`/sales/${r.advisor.id}`} className="text-brand-700 hover:underline">{r.advisor.name}</Link></td>
                      <td className="px-3 py-2 text-muted">{r.advisor.branch ? branchLabel(r.advisor.branch) : "—"}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{r.hasGoal ? money(r.target) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.hasGoal ? money(r.salesPerDay) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.hasGoal ? qty(r.prospectsPerDay) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{m(r.closed)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.hasGoal ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.hasGoal ? "Set" : "Not set"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
            <Link href="/management/sales" className="font-medium text-brand-700 hover:underline">Open Sales &amp; Attrition analytics →</Link>
            <span>Closed = year-to-date won revenue from the sales feed. Per-branch and per-advisor pipeline detail arrives with the full sales API.</span>
          </div>
        </>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h2>;
}

function FocusStat({ n, label, tone }: { n: number; label: string; tone?: "warn" | "good" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-white p-2.5">
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{n}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function FocusColumn({ title, empty, rows, tone, showOutcome }: { title: string; empty: string; rows: FocusRollupRow[]; tone?: "warn" | "good"; showOutcome?: boolean }) {
  const dot = tone === "warn" ? "bg-amber-500" : tone === "good" ? "bg-emerald-500" : "bg-brand-500";
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink"><span className={`h-2 w-2 rounded-full ${dot}`} />{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/sales/${r.advisorEmployeeId}`} className="block rounded-lg border border-line bg-white px-3 py-2 hover:bg-black/[0.02]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{r.advisorName}</span>
                  {r.followUpAt ? <span className={`shrink-0 text-[11px] ${tone === "warn" ? "font-medium text-amber-700" : "text-muted"}`}>{fmtDate(r.followUpAt)}</span> : null}
                </div>
                <div className="truncate text-[11px] text-muted">{focusTypeLabel(r.type)} · {r.label}</div>
                {showOutcome && r.outcome ? <div className="mt-0.5 truncate text-[11px] text-emerald-700">{r.outcome}</div> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniBoard({ title, icon, rows, fmt }: { title: string; icon: ReactNode; rows: { advisor: { id: string; name: string }; value: number; rank: number }[]; fmt: (n: number) => string }) {
  const top = rows.filter((r) => r.value > 0).slice(0, 5);
  // Ramp-colored mini-bar per row, scaled to the board leader (motivation kit).
  const max = Math.max(1, ...top.map((r) => r.value));
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium text-ink"><span className="text-brand-600"><Icon path={icon} /></span>{title}</div>
      {top.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">No data yet this month.</p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((r) => {
            const share = (r.value / max) * 100;
            return (
              <li key={r.advisor.id} className="px-4 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <Rank n={r.rank} />
                  <span className="flex-1 truncate">{r.advisor.name}</span>
                  <span className="font-medium tabular-nums text-ink">{fmt(r.value)}</span>
                </div>
                <div className="ml-9 mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, share)}%`, background: rampColor(share) }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// Rank chip — top 3 get a sanctioned sales medal 🥇🥈🥉, the rest a plain number.
function Rank({ n }: { n: number }) {
  const medal = rankMedal(n);
  if (medal) return <span className="grid h-6 w-6 shrink-0 place-items-center text-base leading-none" role="img" aria-label={`Rank ${n}`}>{medal}</span>;
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums text-muted">{n}</span>;
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-600 text-white" : "border border-line bg-white text-ink hover:bg-slate-50"}`}>{children}</Link>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="h-full p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}
