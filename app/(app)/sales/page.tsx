import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, canManageSales } from "@/lib/auth";
import { money, qty } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { prisma } from "@/lib/prisma";
import { salesDirectorDashboard, currentPeriodKey, periodLabel } from "@/lib/sales";
import { teamFunnel, buildLeaderboards, diagnoseFunnel, salesPace, stageStatus, type AdvisorFunnel, type StageStatus } from "@/lib/sales-funnel";
import MyReviewsCard from "@/components/MyReviewsCard";
import LeadInsightsSection from "@/components/LeadInsightsSection";
import { resolveRange } from "@/lib/sales-leads";
import { smarterLaunchConfigured } from "@/lib/smarterlaunch";
import FunnelEntryButton from "./FunnelEntryButton";
import SalesDirectorTools from "./SalesDirectorTools";

export const dynamic = "force-dynamic";

const m = (n: number | null) => (n == null ? "—" : money(n));

export default async function SalesTeamPage({ searchParams }: { searchParams: Promise<{ branch?: string; range?: string; from?: string; to?: string }> }) {
  const user = await requireUser();
  if (!canManageSales(user)) redirect("/me");

  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const range = resolveRange(sp.range, sp.from, sp.to);
  const periodKey = currentPeriodKey();
  const { advisorRows, byBranch, totals, actuals } = await salesDirectorDashboard(periodKey, branch);
  const { rows: funnelRows } = await teamFunnel(periodKey, branch);
  const boards = buildLeaderboards(funnelRows);
  const pLabel = periodLabel(periodKey);
  const pace = salesPace(periodKey);
  const demoCount = await prisma.salesPeriodStat.count({ where: { periodKey, source: "demo" } });
  const slLive = smarterLaunchConfigured();

  // The director's actionable gap: advisors who haven't set this period's goal.
  const notSet = advisorRows.filter((r) => !r.hasGoal);

  return (
    <>
      <PageHeader
        title="Sales Team"
        subtitle={`Targets, closed & pipeline across all branches — ${periodLabel(periodKey)}`}
        actions={<Link href="/management/sales" className="text-sm font-medium text-brand-700 hover:underline">Sales &amp; Attrition analytics →</Link>}
      />

      <MyReviewsCard userId={user.id} />

      <SalesDirectorTools periodKey={periodKey} hasDemo={demoCount > 0} live={slLive} />

      {/* actuals connection state */}
      <div className={`mb-4 rounded-xl border px-4 py-2.5 text-sm ${actuals.connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {actuals.connected
          ? <><strong>Closed &amp; pipeline are live</strong> — synced from the sales system{actuals.syncedAt ? ` (last update ${new Date(actuals.syncedAt).toLocaleDateString()})` : ""}. Targets are from advisor goal sheets.</>
          : <><strong>Targets are live</strong> from advisor goal sheets. <strong>Closed &amp; pipeline</strong> will populate here automatically once the sales system (WorkWave) is connected.</>}
      </div>

      {/* Needs your attention — goal-setting gap for the current period */}
      {advisorRows.length > 0 ? (
        <div className="mb-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Needs your attention</div>
          {notSet.length === 0 ? (
            <Card className="flex items-center gap-3 p-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
              <div>
                <div className="text-sm font-medium text-ink">All {totals.advisors} advisors have set their {periodLabel(periodKey)} goals.</div>
                <div className="text-xs text-muted">You&rsquo;re set for the month — track pace in the tables below.</div>
              </div>
            </Card>
          ) : (
            <Card className="p-4 ring-1 ring-amber-200">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 text-sm font-semibold tabular-nums">{notSet.length}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{notSet.length} of {totals.advisors} advisor{notSet.length === 1 ? " hasn't" : "s haven't"} set {periodLabel(periodKey)} goals</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {notSet.map((r) => (
                      <Link key={r.advisor.id} href={`/sales/${r.advisor.id}`} className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100">
                        {r.advisor.name}{r.advisor.branch ? ` · ${branchLabel(r.advisor.branch)}` : ""}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      ) : null}

      {/* branch filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill href="/sales" active={!branch}>All branches</Pill>
        {BRANCHES.map((b) => (
          <Pill key={b.key} href={`/sales?branch=${b.key}`} active={branch === b.key}>{b.label}</Pill>
        ))}
      </div>

      {/* company summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <Tile label="Combined target (month)" value={money(totals.target)} />
        <Tile label="Goals set" value={`${totals.withGoal} / ${totals.advisors}`} tone={totals.withGoal < totals.advisors ? "warn" : "good"} />
        <Tile label="Closed (YTD)" value={m(totals.closed)} />
        <Tile label="Open pipeline" value={m(totals.pipeline)} />
      </div>

      {/* Lead geographic heat map + lead-source performance (company-wide, honors
          the branch filter and the date-range control). */}
      <LeadInsightsSection
        scope="team"
        branch={branch}
        range={range}
        mapTitle={`Lead heat map${branch ? ` · ${branchLabel(branch)}` : " · all branches"}`}
        mapSubtitle="Where leads are coming in and which neighborhoods have the most density and best close rate. Color-coded by funnel stage — filter to a stage to see pending leads by stage."
      />

      {/* Leaderboard — the funnel, ranked. Each stage is its own board so activity
          leaders are recognized alongside dollar closers. */}
      {funnelRows.length > 0 ? (
        <>
          <h2 className="text-sm font-semibold text-ink mb-2">Funnel health · where each advisor is leaking</h2>
          <Card className="p-0 overflow-hidden mb-6 scroll">
            <table style={{ minWidth: "560px" }} className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Advisor</th>
                  <th className="px-3 py-2 font-medium">Leads</th>
                  <th className="px-3 py-2 font-medium">Proposals</th>
                  <th className="px-3 py-2 font-medium">Closing</th>
                  <th className="px-4 py-2 font-medium">Bottleneck</th>
                </tr>
              </thead>
              <tbody>
                {funnelRows.map((r: AdvisorFunnel) => {
                  const d = diagnoseFunnel(r, pace);
                  return (
                    <tr key={r.advisor.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">{r.advisor.name}{r.advisor.branch ? <span className="ml-2 text-[11px] text-muted">{branchLabel(r.advisor.branch)}</span> : null}</td>
                      <td className="px-3 py-2"><HealthDot s={stageStatus(r.leads, r.leadsGoal, pace)} /></td>
                      <td className="px-3 py-2"><HealthDot s={stageStatus(r.proposals, r.propGoal, pace)} /></td>
                      <td className="px-3 py-2"><HealthDot s={stageStatus(r.closed, r.goal, pace)} /></td>
                      <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BTL[d.key]}`}>{d.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-line text-[11px] text-muted">Dot = pace status (green on track · amber watch · red behind). Bottleneck is the first stage that breaks the chain.</div>
          </Card>

          <h2 className="text-sm font-semibold text-ink mb-2">Leaderboard · {pLabel}</h2>
          <div className="grid gap-3 lg:grid-cols-3 mb-3">
            <MiniBoard title="Leads created" emoji="🚀" rows={boards.leads} fmt={(n) => qty(n)} />
            <MiniBoard title="Proposals made" emoji="🎯" rows={boards.proposals} fmt={(n) => qty(n)} />
            <MiniBoard title="Closed $" emoji="💰" rows={boards.closed} fmt={(n) => money(n)} />
          </div>
          {boards.mostImproved ? (
            <Card className="p-3 mb-6 ring-1 ring-emerald-200 flex items-center gap-3">
              <span className="text-lg">📈</span>
              <div className="text-sm text-ink"><span className="font-semibold">Most improved:</span> {boards.mostImproved.advisor.name} — up {money(boards.mostImproved.delta)} in closed vs last month.</div>
            </Card>
          ) : <div className="mb-6" />}

          {/* This month's funnel (editable) */}
          <h2 className="text-sm font-semibold text-ink mb-2">This month&rsquo;s funnel</h2>
          <Card className="p-0 overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Advisor</th>
                    <th className="px-3 py-2 font-medium text-right">Leads</th>
                    <th className="px-3 py-2 font-medium text-right">Proposals</th>
                    <th className="px-3 py-2 font-medium text-right">Lead→Prop</th>
                    <th className="px-3 py-2 font-medium text-right">Deals</th>
                    <th className="px-3 py-2 font-medium text-right">Close %</th>
                    <th className="px-3 py-2 font-medium text-right">Closed $</th>
                    <th className="px-3 py-2 font-medium text-right">vs Goal</th>
                    <th className="px-4 py-2 font-medium text-right"></th>
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
                      <td className="px-3 py-2 text-right tabular-nums">{r.goal > 0 ? <span className={r.goalPct >= 1 ? "text-emerald-600 font-medium" : "text-muted"}>{Math.round(r.goalPct * 100)}%</span> : "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <FunnelEntryButton advisorId={r.advisor.id} advisorName={r.advisor.name} periodKey={periodKey} periodLabel={pLabel} current={{ leadsCreated: r.leads, proposalsMade: r.proposals, dealsClosed: r.deals, closedAmount: r.closed }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
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
          <h2 className="text-sm font-semibold text-ink mb-2">By branch</h2>
          <Card className="p-0 overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Advisors</th>
                    <th className="px-3 py-2 font-medium text-right">Target (month)</th>
                    <th className="px-3 py-2 font-medium text-right">Closed (YTD)</th>
                  </tr>
                </thead>
                <tbody>
                  {byBranch.map((b) => (
                    <tr key={b.branch} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/sales?branch=${b.branch}`} className="text-brand-700 hover:underline">{b.label}</Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{b.withGoal}/{b.advisors} set</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(b.target)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{m(b.closed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* by advisor */}
          <h2 className="text-sm font-semibold text-ink mb-2">By service advisor</h2>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Advisor</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Target (month)</th>
                    <th className="px-3 py-2 font-medium text-right">Sales / day</th>
                    <th className="px-3 py-2 font-medium text-right">Leads / day</th>
                    <th className="px-3 py-2 font-medium text-right">Closed (YTD)</th>
                    <th className="px-4 py-2 font-medium text-center">Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {advisorRows.map((r) => (
                    <tr key={r.advisor.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium"><Link href={`/sales/${r.advisor.id}`} className="text-brand-700 hover:underline">{r.advisor.name}</Link></td>
                      <td className="px-3 py-2 text-muted">{r.advisor.branch ? branchLabel(r.advisor.branch) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{r.hasGoal ? money(r.target) : "—"}</td>
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

const BTL: Record<StageStatus, string> = {
  on: "bg-emerald-100 text-emerald-700",
  watch: "bg-amber-100 text-amber-700",
  behind: "bg-red-100 text-red-700",
  nogoal: "bg-slate-100 text-slate-500",
};
function HealthDot({ s }: { s: StageStatus }) {
  const map: Record<StageStatus, { c: string; t: string }> = {
    on: { c: "bg-emerald-500", t: "On track" },
    watch: { c: "bg-amber-500", t: "Watch" },
    behind: { c: "bg-red-500", t: "Behind" },
    nogoal: { c: "bg-slate-300", t: "No goal" },
  };
  const m = map[s];
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className={`h-2.5 w-2.5 rounded-full ${m.c}`} />{m.t}</span>;
}

function MiniBoard({ title, emoji, rows, fmt }: { title: string; emoji: string; rows: { advisor: { id: string; name: string }; value: number; rank: number }[]; fmt: (n: number) => string }) {
  const top = rows.filter((r) => r.value > 0).slice(0, 5);
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line text-sm font-medium text-ink flex items-center gap-2"><span>{emoji}</span>{title}</div>
      {top.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">No data yet this month.</p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((r) => (
            <li key={r.advisor.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-6 text-center">{medal(r.rank)}</span>
              <span className="flex-1 truncate">{r.advisor.name}</span>
              <span className="tabular-nums font-medium text-ink">{fmt(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-600 text-white" : "border border-line bg-white text-ink hover:bg-slate-50"}`}>{children}</Link>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4 h-full">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}
