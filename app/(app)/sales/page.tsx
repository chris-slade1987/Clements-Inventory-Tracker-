import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, canManageSales, canViewSales, branchLocked } from "@/lib/auth";
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
import { AchievementBar, ProgressRing, rampColor, encouragement } from "@/components/motivation";

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
  const demoCount = await prisma.salesPeriodStat.count({ where: { periodKey, source: "demo" } });
  const slLive = smarterLaunchConfigured();

  // The director's actionable gap: advisors who haven't set this period's goal.
  const notSet = advisorRows.filter((r) => !r.hasGoal);

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
                    <div className="text-sm text-ink">{encouragement(teamAttainPct)}</div>
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
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><Icon path={ICONS.trendUp} /></span>
              <div className="text-sm text-ink"><span className="font-semibold">Most improved:</span> {boards.mostImproved.advisor.name} — up {money(boards.mostImproved.delta)} in closed vs last month.</div>
            </Card>
          ) : <div className="mb-6" />}

          {/* ───────── 4. Per-advisor funnel ───────── */}
          <SectionLabel>Funnel health · where each advisor is leaking</SectionLabel>
          <Card className="mb-6 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table style={{ minWidth: "560px" }} className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
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
            </div>
            <div className="border-t border-line px-4 py-2 text-[11px] text-muted">Dot = pace status (green on track · amber watch · red behind). Bottleneck is the first stage that breaks the chain.</div>
          </Card>

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

// Rank chip — top 3 get a subtle medal tint, the rest a plain number.
function Rank({ n }: { n: number }) {
  const tint = n === 1 ? "bg-amber-100 text-amber-800" : n === 2 ? "bg-slate-200 text-slate-700" : n === 3 ? "bg-orange-100 text-orange-800" : "text-muted";
  return <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${tint}`}>{n}</span>;
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
