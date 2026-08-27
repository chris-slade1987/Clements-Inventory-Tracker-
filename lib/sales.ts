import { prisma } from "@/lib/prisma";
import { computeGoalSheet, EMPTY_RECAP, type RecapInputs, type GoalInputs, type GoalSheetInput } from "@/lib/sales-goal";

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

/** Director roster: every advisor (optionally one branch) with their month's plan. */
export async function salesTeamRoster(periodKey: string, branch?: string | null) {
  const advisors = await listServiceAdvisors(branch);
  const rows = await Promise.all(
    advisors.map(async (a) => {
      const g = await advisorGoal(a.id, periodKey);
      return { advisor: a, salesGoal: g.goal.salesGoal, workdays: g.goal.workdays, salesPerDay: g.plan.salesPerDay, prospectsPerDay: g.plan.prospectsPerDay, hasGoal: g.hasGoal };
    }),
  );
  const totalGoal = rows.reduce((s, r) => s + r.salesGoal, 0);
  const withGoal = rows.filter((r) => r.hasGoal).length;
  return { rows, totals: { advisors: rows.length, withGoal, totalGoal } };
}
