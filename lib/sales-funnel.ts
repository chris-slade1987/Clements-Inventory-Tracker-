import { prisma } from "@/lib/prisma";
import { listServiceAdvisors, type Advisor } from "@/lib/sales";
import { computeGoalSheet, EMPTY_RECAP, type RecapInputs } from "@/lib/sales-goal";

// Sales FUNNEL + leaderboard + diagnosis engine. The funnel is a numbers game —
// Leads created → Proposals made → Closed (deals + $) — and each stage carries its
// own goal so we can show, visually, where an advisor is on or off pace and WHERE
// the funnel is leaking (not enough leads? leads not becoming proposals? proposals
// not closing?). Per-stage goals are derived from the advisor's existing Monthly
// Goal Sheet, so there's nothing extra to enter:
//   leads goal  = prospects needed   proposals goal = proposals needed
//   deals goal  = $ goal ÷ avg job   $ goal         = sales goal
// Actuals live in SalesPeriodStat (manual entry now, SmarterLaunch API later).

export type FunnelInput = { leadsCreated: number; proposalsMade: number; dealsClosed: number; closedAmount: number };

export function priorPeriodKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Fraction of the month elapsed (the pace line). Past months = 1, future = 0. */
export function salesPace(periodKey: string, now: Date = new Date()): number {
  const curKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  if (periodKey < curKey) return 1;
  if (periodKey > curKey) return 0;
  const [y, m] = periodKey.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.min(1, Math.max(0.03, now.getUTCDate() / dim));
}

const clampInt = (n: number) => Math.max(0, Math.round(n || 0));
const clampNum = (n: number) => Math.max(0, n || 0);
const div = (a: number, b: number) => (b > 0 && Number.isFinite(a / b) ? a / b : 0);

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
    dealsClosed: clampInt(data.dealsClosed),
    closedAmount: clampNum(data.closedAmount),
  };
  return prisma.salesPeriodStat.upsert({
    where: { advisorEmployeeId_periodKey: { advisorEmployeeId, periodKey } },
    create: { advisorEmployeeId, periodKey, branch: opts.branch ?? null, source: opts.source ?? "manual", updatedByUserId: opts.userId ?? null, ...clean },
    update: { ...clean, ...(opts.source ? { source: opts.source } : {}), ...(opts.branch !== undefined ? { branch: opts.branch } : {}), updatedByUserId: opts.userId ?? null },
  });
}

export type StageStatus = "on" | "watch" | "behind" | "nogoal";
export function stageStatus(actual: number, goal: number, pace: number): StageStatus {
  if (goal <= 0) return "nogoal";
  const exp = goal * pace;
  if (exp <= 0) return "on";
  if (actual >= exp * 0.98) return "on";
  if (actual >= exp * 0.8) return "watch";
  return "behind";
}

export type AdvisorFunnel = {
  advisor: Advisor;
  leads: number; proposals: number; deals: number; closed: number;
  leadsGoal: number; propGoal: number; dealGoal: number; goal: number;
  lpRate: number; lpTarget: number;   // lead → proposal conversion vs target
  pcRate: number; pcTarget: number;   // proposal → close (count) vs target
  dollarsPerProposal: number;
  goalPct: number;                    // closed $ / $ goal
  prevClosed: number;
  hasGoal: boolean;
  hasData: boolean;
};

function stageGoals(recap: RecapInputs, salesGoal: number, workdays: number, explicit: { leadsGoal: number; proposalsGoal: number; dealsGoal: number }) {
  const { rates, plan } = computeGoalSheet(recap, { salesGoal, workdays });
  const propGoal = explicit.proposalsGoal > 0 ? explicit.proposalsGoal : Math.round(plan.totalProposals);
  const leadsGoal = explicit.leadsGoal > 0 ? explicit.leadsGoal : Math.round(plan.prospectsNeeded);
  const dealGoal = explicit.dealsGoal > 0 ? explicit.dealsGoal : (rates.avgTcJobPrice > 0 ? Math.round(div(salesGoal, rates.avgTcJobPrice)) : Math.round(propGoal * 0.5));
  return { leadsGoal, propGoal, dealGoal, goal: salesGoal };
}

/** Per-advisor funnel for a period (optionally one branch) + company totals. */
export async function teamFunnel(periodKey: string, branch?: string | null) {
  const advisors = await listServiceAdvisors(branch);
  const ids = advisors.map((a) => a.id);
  const prevKey = priorPeriodKey(periodKey);

  const [stats, prevStats, sheets] = await Promise.all([
    prisma.salesPeriodStat.findMany({ where: { advisorEmployeeId: { in: ids }, periodKey } }),
    prisma.salesPeriodStat.findMany({ where: { advisorEmployeeId: { in: ids }, periodKey: prevKey }, select: { advisorEmployeeId: true, closedAmount: true } }),
    prisma.salesGoalSheet.findMany({ where: { advisorEmployeeId: { in: ids }, periodKey } }),
  ]);
  const statBy = new Map(stats.map((s) => [s.advisorEmployeeId, s]));
  const prevBy = new Map(prevStats.map((s) => [s.advisorEmployeeId, s.closedAmount]));
  const sheetBy = new Map(sheets.map((s) => [s.advisorEmployeeId, s]));

  const rows: AdvisorFunnel[] = advisors.map((a) => {
    const s = statBy.get(a.id);
    const sheet = sheetBy.get(a.id);
    const recap: RecapInputs = sheet
      ? { reis: sheet.reis, appts: sheet.appts, proposals: sheet.proposals, pcExposed: sheet.pcExposed, pcSold: sheet.pcSold, tcSold: sheet.tcSold, totalExposure: sheet.totalExposure, tcUnits: sheet.tcUnits }
      : EMPTY_RECAP;
    const salesGoal = sheet?.salesGoal ?? 0;
    const g = stageGoals(recap, salesGoal, sheet?.workdays ?? 0, { leadsGoal: sheet?.leadsGoal ?? 0, proposalsGoal: sheet?.proposalsGoal ?? 0, dealsGoal: sheet?.dealsGoal ?? 0 });

    const leads = s?.leadsCreated ?? 0, proposals = s?.proposalsMade ?? 0, deals = s?.dealsClosed ?? 0, closed = s?.closedAmount ?? 0;
    return {
      advisor: a,
      leads, proposals, deals, closed,
      leadsGoal: g.leadsGoal, propGoal: g.propGoal, dealGoal: g.dealGoal, goal: g.goal,
      lpRate: div(proposals, leads), lpTarget: div(g.propGoal, g.leadsGoal),
      pcRate: div(deals, proposals), pcTarget: div(g.dealGoal, g.propGoal),
      dollarsPerProposal: div(closed, proposals),
      goalPct: div(closed, g.goal),
      prevClosed: prevBy.get(a.id) ?? 0,
      hasGoal: salesGoal > 0,
      hasData: !!s && (leads > 0 || proposals > 0 || deals > 0 || closed > 0),
    };
  });

  const totals = {
    advisors: rows.length,
    leads: rows.reduce((s, r) => s + r.leads, 0),
    proposals: rows.reduce((s, r) => s + r.proposals, 0),
    deals: rows.reduce((s, r) => s + r.deals, 0),
    closed: rows.reduce((s, r) => s + r.closed, 0),
    goal: rows.reduce((s, r) => s + r.goal, 0),
    withData: rows.filter((r) => r.hasData).length,
    withGoal: rows.filter((r) => r.hasGoal).length,
  };
  return { rows, totals };
}

export type Diagnosis = { key: StageStatus; label: string; head: string; msg: string };

/** Walk the funnel top-down and name the one weak link (deterministic). */
export function diagnoseFunnel(r: AdvisorFunnel, pace: number): Diagnosis {
  const fpct = (n: number) => `${Math.round(n * 100)}%`;
  if (!r.hasGoal || !r.hasData) return { key: "nogoal", label: "No data yet", head: "No goal or results yet", msg: "Set this month's goal and log activity to unlock funnel tracking and coaching." };
  const ls = stageStatus(r.leads, r.leadsGoal, pace);
  if (ls === "behind") return { key: "behind", label: "Lead-gen gap", head: "Top of funnel is behind pace", msg: "Not enough at-bats — lead volume is behind where it should be this far into the month. Everything downstream is capped until lead flow comes up." };
  if (r.lpTarget > 0 && r.lpRate < r.lpTarget * 0.85) return { key: "behind", label: "Consultation gap", head: "Leads aren't becoming proposals", msg: `Plenty of leads, but only ${fpct(r.lpRate)} turn into proposals vs a ${fpct(r.lpTarget)} target. The drop is at the consultation / booking step — not lead gen. Make sure every lead gets a sit-down and tighten the inspection pitch.` };
  if (r.pcTarget > 0 && r.pcRate < r.pcTarget * 0.85) return { key: "behind", label: "Closing gap", head: "Proposals aren't closing", msg: `Proposals are strong, but the close rate is ${fpct(r.pcRate)} vs a ${fpct(r.pcTarget)} target. That points to pricing or follow-up — not activity. Review pricing on lost bids and tighten the follow-up cadence.` };
  const slipping = ls !== "on" || stageStatus(r.proposals, r.propGoal, pace) !== "on" || stageStatus(r.closed, r.goal, pace) !== "on";
  if (slipping) return { key: "watch", label: "On watch", head: "Slightly behind pace", msg: "Close to pace overall — keep the top of the funnel full and stay on your follow-ups to finish strong." };
  return { key: "on", label: "Healthy", head: "On or ahead at every stage", msg: "Firing on all cylinders — leads, proposals and closes are all at or ahead of pace. Keep doing exactly this." };
}

/** Linear month-end projection of closed $ at the current pace. */
export function projectClose(r: AdvisorFunnel, pace: number): number {
  return pace > 0 ? r.closed / pace : r.closed;
}

export type Rank = { advisor: Advisor; value: number; rank: number };
export type Leaderboards = { leads: Rank[]; proposals: Rank[]; closed: Rank[]; mostImproved: { advisor: Advisor; delta: number } | null };

function rankBy(rows: AdvisorFunnel[], pick: (r: AdvisorFunnel) => number): Rank[] {
  return [...rows].map((r) => ({ advisor: r.advisor, value: pick(r) })).sort((a, b) => b.value - a.value).map((r, i) => ({ ...r, rank: i + 1 }));
}
export function buildLeaderboards(rows: AdvisorFunnel[]): Leaderboards {
  const improved = rows.map((r) => ({ advisor: r.advisor, delta: r.closed - r.prevClosed })).filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);
  return { leads: rankBy(rows, (r) => r.leads), proposals: rankBy(rows, (r) => r.proposals), closed: rankBy(rows, (r) => r.closed), mostImproved: improved[0] ?? null };
}

export type Badge = { label: string; emoji: string; tone: "gold" | "brand" | "emerald" | "violet" };

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
