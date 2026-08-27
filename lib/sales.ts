import { prisma } from "@/lib/prisma";
import { computeGoalSheet, EMPTY_RECAP, type RecapInputs, type GoalInputs, type GoalSheetInput } from "@/lib/sales-goal";
import { latestSalesSnapshot } from "@/lib/sales-sync";
import { BRANCHES, branchLabel } from "@/lib/management";

export type { GoalSheetInput };

// Sales Team data helpers: service-advisor roster, per-advisor monthly goal
// sheets, and the computed rates/plan used by the advisor + director views.

/** Current month key, "YYYY-MM". */
export function currentPeriodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Human label for a period key, e.g. "August 2026". */
export function periodLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type Advisor = { id: string; name: string; branch: string | null; email: string | null };

/** Active service advisors — by Employee.role or a linked "sales" access level. */
export async function listServiceAdvisors(branch?: string | null): Promise<Advisor[]> {
  const rows = await prisma.employee.findMany({
    where: {
      status: "active",
      ...(branch ? { branch } : {}),
      OR: [{ role: { contains: "Advisor" } }, { user: { is: { accessLevel: "sales" } } }],
    },
    select: { id: true, name: true, branch: true, email: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
  return rows;
}

function recapFromSheet(s: { reis: number; appts: number; proposals: number; pcExposed: number; pcSold: number; tcSold: number; totalExposure: number; tcUnits: number } | null): RecapInputs {
  if (!s) return EMPTY_RECAP;
  return {
    reis: s.reis, appts: s.appts, proposals: s.proposals, pcExposed: s.pcExposed,
    pcSold: s.pcSold, tcSold: s.tcSold, totalExposure: s.totalExposure, tcUnits: s.tcUnits,
  };
}

export async function getGoalSheet(advisorEmployeeId: string, periodKey: string) {
  return prisma.salesGoalSheet.findUnique({
    where: { advisorEmployeeId_periodKey: { advisorEmployeeId, periodKey } },
  });
}

/** Create or update an advisor's goal sheet for a month. */
export async function upsertGoalSheet(
  advisorEmployeeId: string,
  periodKey: string,
  data: GoalSheetInput,
  opts: { branch?: string | null; userId?: string | null } = {},
) {
  const clean = {
    reis: Math.max(0, Math.round(data.reis || 0)),
    appts: Math.max(0, Math.round(data.appts || 0)),
    proposals: Math.max(0, Math.round(data.proposals || 0)),
    pcExposed: Math.max(0, data.pcExposed || 0),
    pcSold: Math.max(0, data.pcSold || 0),
    tcSold: Math.max(0, data.tcSold || 0),
    totalExposure: Math.max(0, data.totalExposure || 0),
    tcUnits: Math.max(0, Math.round(data.tcUnits || 0)),
    salesGoal: Math.max(0, data.salesGoal || 0),
    workdays: Math.max(0, Math.round(data.workdays || 0)),
  };
  return prisma.salesGoalSheet.upsert({
    where: { advisorEmployeeId_periodKey: { advisorEmployeeId, periodKey } },
    create: { advisorEmployeeId, periodKey, branch: opts.branch ?? null, createdByUserId: opts.userId ?? null, ...clean },
    update: { ...clean, ...(opts.branch !== undefined ? { branch: opts.branch } : {}) },
  });
}

/** An advisor's sheet + computed rates/plan for a month (sheet may be absent). */
export async function advisorGoal(advisorEmployeeId: string, periodKey: string) {
  const sheet = await getGoalSheet(advisorEmployeeId, periodKey);
  const recap = recapFromSheet(sheet);
  const goal: GoalInputs = { salesGoal: sheet?.salesGoal ?? 0, workdays: sheet?.workdays ?? 0 };
  const { rates, plan } = computeGoalSheet(recap, goal);
  return { sheet, recap, goal, rates, plan, hasGoal: !!sheet && sheet.salesGoal > 0 };
}

/**
 * Actual sales results (closed & pipeline) from the connected sales feed
 * (WorkWave API or the shared Google Sheet, via SalesSnapshot). Until a feed is
 * connected this returns `connected: false` and the dashboard shows targets
 * only. Closed is YTD won $ (per branch & per rep); pipeline is the company
 * open-opportunity total (per-branch/advisor pipeline arrives with the fuller
 * API). Rep→advisor is matched by name.
 */
export type SalesActuals = {
  connected: boolean;
  syncedAt: string | null;
  company: { closedYtd: number | null; pipeline: number | null };
  branchClosed: Record<string, number>;  // branch key -> YTD won $
  advisorClosed: Record<string, number>; // lowercased advisor name -> YTD won $
};

export async function getSalesActuals(): Promise<SalesActuals> {
  const snap = await latestSalesSnapshot().catch(() => null);
  const m = snap?.metrics ?? null;
  if (!m) return { connected: false, syncedAt: null, company: { closedYtd: null, pipeline: null }, branchClosed: {}, advisorClosed: {} };
  const branchClosed: Record<string, number> = {};
  for (const b of m.byBranch) branchClosed[b.branch] = b.soldAnnual;
  const advisorClosed: Record<string, number> = {};
  for (const r of m.byRep) advisorClosed[r.owner.trim().toLowerCase()] = r.soldAnnual;
  return {
    connected: true,
    syncedAt: snap?.syncedAt ? snap.syncedAt.toISOString() : null,
    company: { closedYtd: m.ytd.soldAnnual, pipeline: m.openPipeline },
    branchClosed,
    advisorClosed,
  };
}

/**
 * The Sales Director dashboard: this month's targets by branch and by advisor,
 * plus closed/pipeline from the sales feed (when connected).
 */
export async function salesDirectorDashboard(periodKey: string, branch?: string | null) {
  const [advisors, actuals] = await Promise.all([listServiceAdvisors(branch), getSalesActuals()]);
  const advisorRows = await Promise.all(
    advisors.map(async (a) => {
      const g = await advisorGoal(a.id, periodKey);
      return {
        advisor: a,
        target: g.goal.salesGoal,
        workdays: g.goal.workdays,
        salesPerDay: g.plan.salesPerDay,
        prospectsPerDay: g.plan.prospectsPerDay,
        hasGoal: g.hasGoal,
        closed: actuals.advisorClosed[a.name.trim().toLowerCase()] ?? null,
      };
    }),
  );

  const branchKeys = branch ? [branch] : BRANCHES.map((b) => b.key);
  const byBranch = branchKeys
    .map((bk) => {
      const rows = advisorRows.filter((r) => r.advisor.branch === bk);
      return {
        branch: bk,
        label: branchLabel(bk),
        advisors: rows.length,
        withGoal: rows.filter((r) => r.hasGoal).length,
        target: rows.reduce((s, r) => s + r.target, 0),
        closed: actuals.branchClosed[bk] ?? null,
      };
    })
    .filter((b) => b.advisors > 0);

  const totals = {
    advisors: advisorRows.length,
    withGoal: advisorRows.filter((r) => r.hasGoal).length,
    target: advisorRows.reduce((s, r) => s + r.target, 0),
    closed: actuals.company.closedYtd,
    pipeline: actuals.company.pipeline,
  };

  return { advisorRows, byBranch, totals, actuals };
}
