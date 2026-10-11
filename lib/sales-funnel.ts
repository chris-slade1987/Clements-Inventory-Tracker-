import { prisma } from "@/lib/prisma";
import { listServiceAdvisors, type Advisor } from "@/lib/sales";

// Sales FUNNEL + leaderboard engine. The funnel is a numbers game — Leads created
// → Proposals made → Closed $ — and each stage is ranked in its own right so an
// advisor who leads on activity is recognized even if another closes more dollars
// (the research-backed way to keep a leaderboard motivating, not demoralizing).
//
// Actuals live in SalesPeriodStat (manual entry today, SmarterLaunch API next
// month). Targets come from the advisor goal sheets. Nothing here touches comp.

export type FunnelInput = { leadsCreated: number; proposalsMade: number; closedAmount: number };

/** The month before `key` ("YYYY-MM"), for most-improved comparisons. */
export function priorPeriodKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const clampInt = (n: number) => Math.max(0, Math.round(n || 0));
const clampNum = (n: number) => Math.max(0, n || 0);

/** Create/update one advisor's funnel actuals for a month. */
export async function upsertFunnelStat(
  advisorEmployeeId: string,
  periodKey: string,
  data: FunnelInput,
  opts: { branch?: string | null; source?: string; userId?: string | null } = {},
) {
  const clean = {
    leadsCreated: clampInt(data.leadsCreated),
    proposalsMade: clampInt(data.proposalsMade),
    closedAmount: clampNum(data.closedAmount),
  };
  return prisma.salesPeriodStat.upsert({
    where: { advisorEmployeeId_periodKey: { advisorEmployeeId, periodKey } },
    create: { advisorEmployeeId, periodKey, branch: opts.branch ?? null, source: opts.source ?? "manual", updatedByUserId: opts.userId ?? null, ...clean },
    update: { ...clean, ...(opts.source ? { source: opts.source } : {}), ...(opts.branch !== undefined ? { branch: opts.branch } : {}), updatedByUserId: opts.userId ?? null },
  });
}

const div = (a: number, b: number) => (b > 0 && Number.isFinite(a / b) ? a / b : 0);

export type AdvisorFunnel = {
  advisor: Advisor;
  leads: number;
  proposals: number;
  closed: number;
  proposalRate: number;      // proposals / leads (how well leads become proposals)
  dollarsPerProposal: number;// closed $ / proposals (how well proposals convert to $)
  goal: number;              // this month's $ goal from the goal sheet
  goalPct: number;           // closed / goal
  prevClosed: number;        // last month's closed $ (most-improved)
  hasData: boolean;
};

/**
 * Per-advisor funnel for a period (optionally one branch), plus branch rollups
 * and company totals. Pulls actuals (SalesPeriodStat), prior-month closed (for
 * most-improved), and the $ goal (SalesGoalSheet).
 */
export async function teamFunnel(periodKey: string, branch?: string | null) {
  const advisors = await listServiceAdvisors(branch);
  const ids = advisors.map((a) => a.id);
  const prevKey = priorPeriodKey(periodKey);

  const [stats, prevStats, goals] = await Promise.all([
    prisma.salesPeriodStat.findMany({ where: { advisorEmployeeId: { in: ids }, periodKey } }),
    prisma.salesPeriodStat.findMany({ where: { advisorEmployeeId: { in: ids }, periodKey: prevKey }, select: { advisorEmployeeId: true, closedAmount: true } }),
    prisma.salesGoalSheet.findMany({ where: { advisorEmployeeId: { in: ids }, periodKey }, select: { advisorEmployeeId: true, salesGoal: true } }),
  ]);
  const statBy = new Map(stats.map((s) => [s.advisorEmployeeId, s]));
  const prevBy = new Map(prevStats.map((s) => [s.advisorEmployeeId, s.closedAmount]));
  const goalBy = new Map(goals.map((g) => [g.advisorEmployeeId, g.salesGoal]));

  const rows: AdvisorFunnel[] = advisors.map((a) => {
    const s = statBy.get(a.id);
    const leads = s?.leadsCreated ?? 0;
    const proposals = s?.proposalsMade ?? 0;
    const closed = s?.closedAmount ?? 0;
    const goal = goalBy.get(a.id) ?? 0;
    return {
      advisor: a,
      leads, proposals, closed,
      proposalRate: div(proposals, leads),
      dollarsPerProposal: div(closed, proposals),
      goal,
      goalPct: div(closed, goal),
      prevClosed: prevBy.get(a.id) ?? 0,
      hasData: !!s && (leads > 0 || proposals > 0 || closed > 0),
    };
  });

  const totals = {
    advisors: rows.length,
    leads: rows.reduce((s, r) => s + r.leads, 0),
    proposals: rows.reduce((s, r) => s + r.proposals, 0),
    closed: rows.reduce((s, r) => s + r.closed, 0),
    goal: rows.reduce((s, r) => s + r.goal, 0),
    withData: rows.filter((r) => r.hasData).length,
  };

  return { rows, totals };
}

export type Rank = { advisor: Advisor; value: number; rank: number };
export type Leaderboards = {
  leads: Rank[];
  proposals: Rank[];
  closed: Rank[];
  mostImproved: { advisor: Advisor; delta: number } | null;
};

/** Rank rows (desc) by a metric; equal values share nothing fancy — position order. */
function rankBy(rows: AdvisorFunnel[], pick: (r: AdvisorFunnel) => number): Rank[] {
  return [...rows]
    .map((r) => ({ advisor: r.advisor, value: pick(r) }))
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Three stage leaderboards + a most-improved (biggest closed-$ gain vs last month). */
export function buildLeaderboards(rows: AdvisorFunnel[]): Leaderboards {
  const improvedList = rows
    .map((r) => ({ advisor: r.advisor, delta: r.closed - r.prevClosed }))
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  return {
    leads: rankBy(rows, (r) => r.leads),
    proposals: rankBy(rows, (r) => r.proposals),
    closed: rankBy(rows, (r) => r.closed),
    mostImproved: improvedList[0] ?? null,
  };
}

export type Badge = { label: string; emoji: string; tone: "gold" | "brand" | "emerald" | "violet" };

/** An advisor's competitive standing: their funnel, ranks (branch + company),
 *  progress to goal, most-improved flag, and earned badges. */
export async function advisorStanding(advisorEmployeeId: string, periodKey: string) {
  const { rows: company } = await teamFunnel(periodKey, null);
  const me = company.find((r) => r.advisor.id === advisorEmployeeId) ?? null;
  const branchKey = me?.advisor.branch ?? null;
  const branchRows = branchKey ? company.filter((r) => r.advisor.branch === branchKey) : company;

  const companyBoards = buildLeaderboards(company);
  const branchBoards = buildLeaderboards(branchRows);

  const rankIn = (board: Rank[]) => board.find((r) => r.advisor.id === advisorEmployeeId)?.rank ?? null;
  const ranks = {
    company: { leads: rankIn(companyBoards.leads), proposals: rankIn(companyBoards.proposals), closed: rankIn(companyBoards.closed), total: company.length },
    branch: { leads: rankIn(branchBoards.leads), proposals: rankIn(branchBoards.proposals), closed: rankIn(branchBoards.closed), total: branchRows.length },
  };

  const badges: Badge[] = [];
  if (me) {
    if (ranks.company.closed === 1 && me.closed > 0) badges.push({ label: "#1 Closed — company", emoji: "🥇", tone: "gold" });
    else if (ranks.branch.closed === 1 && me.closed > 0) badges.push({ label: "#1 Closed — branch", emoji: "🥇", tone: "gold" });
    if (ranks.company.leads === 1 && me.leads > 0) badges.push({ label: "Lead machine", emoji: "🚀", tone: "brand" });
    if (ranks.company.proposals === 1 && me.proposals > 0) badges.push({ label: "Top proposals", emoji: "🎯", tone: "violet" });
    if (companyBoards.mostImproved?.advisor.id === advisorEmployeeId) badges.push({ label: "Most improved", emoji: "📈", tone: "emerald" });
    if (me.goal > 0 && me.closed >= me.goal) badges.push({ label: "Goal crushed", emoji: "🔥", tone: "emerald" });
  }

  return { me, ranks, badges, mostImproved: companyBoards.mostImproved, branchKey };
}
