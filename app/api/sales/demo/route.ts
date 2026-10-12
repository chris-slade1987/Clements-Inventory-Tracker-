import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { fail } from "@/lib/http";
import { listServiceAdvisors, currentPeriodKey } from "@/lib/sales";
import { priorPeriodKey } from "@/lib/sales-funnel";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sample sales-funnel data for the demo period, so the dashboards look alive
// before SmarterLaunch is connected. Everything written here is tagged
// source="demo" and removed by action:"clear" at cutover — it never touches a real
// goal sheet (an advisor who already set their own goal keeps it). Managers only.
const PROFILES = [
  { leadsGoal: 85, propGoal: 48, dealGoal: 20, salesGoal: 36000, leads: 58, proposals: 31, deals: 14, closed: 24800, prev: 16000 }, // healthy / #1
  { leadsGoal: 80, propGoal: 55, dealGoal: 33, salesGoal: 38000, leads: 61, proposals: 19, deals: 7, closed: 12900, prev: 11800 },  // consultation gap
  { leadsGoal: 70, propGoal: 50, dealGoal: 28, salesGoal: 34000, leads: 44, proposals: 34, deals: 9, closed: 15600, prev: 14200 },  // closing gap
  { leadsGoal: 62, propGoal: 38, dealGoal: 22, salesGoal: 28000, leads: 40, proposals: 24, deals: 12, closed: 17800, prev: 9000 },  // on track
  { leadsGoal: 70, propGoal: 45, dealGoal: 26, salesGoal: 30000, leads: 22, proposals: 12, deals: 5, closed: 7400, prev: 2100 },    // lead-gen gap
  { leadsGoal: 55, propGoal: 32, dealGoal: 18, salesGoal: 24000, leads: 33, proposals: 18, deals: 5, closed: 9900, prev: 8800 },    // mixed
];

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || !canManageSales(user)) return NextResponse.json({ error: "Managers only." }, { status: 403 });
    const body = await req.json().catch(() => null);
    const action = body?.action === "clear" ? "clear" : "load";
    const periodKey = currentPeriodKey();
    const prevKey = priorPeriodKey(periodKey);

    if (action === "clear") {
      const [stat, sheet] = await Promise.all([
        prisma.salesPeriodStat.deleteMany({ where: { periodKey: { in: [periodKey, prevKey] }, source: "demo" } }),
        prisma.salesGoalSheet.deleteMany({ where: { periodKey, source: "demo" } }),
      ]);
      return NextResponse.json({ ok: true, cleared: stat.count + sheet.count });
    }

    const advisors = await listServiceAdvisors(null);
    if (advisors.length === 0) return NextResponse.json({ error: "No service advisors yet — assign the Service Advisor access level in People first." }, { status: 400 });

    let loaded = 0;
    for (let i = 0; i < advisors.length; i++) {
      const a = advisors[i];
      const p = PROFILES[i % PROFILES.length];
      // Only create a demo goal sheet when the advisor has no sheet, or a prior demo
      // one — never overwrite a real goal they set themselves.
      const existing = await prisma.salesGoalSheet.findUnique({ where: { advisorEmployeeId_periodKey: { advisorEmployeeId: a.id, periodKey } } });
      if (!existing || existing.source === "demo") {
        const recap = { reis: 30, appts: 20, proposals: p.propGoal, pcExposed: p.salesGoal, pcSold: p.salesGoal * 0.3, tcSold: p.salesGoal, totalExposure: p.salesGoal * 2, tcUnits: p.dealGoal };
        await prisma.salesGoalSheet.upsert({
          where: { advisorEmployeeId_periodKey: { advisorEmployeeId: a.id, periodKey } },
          create: { advisorEmployeeId: a.id, periodKey, branch: a.branch, source: "demo", salesGoal: p.salesGoal, workdays: 22, leadsGoal: p.leadsGoal, proposalsGoal: p.propGoal, dealsGoal: p.dealGoal, ...recap },
          update: { branch: a.branch, source: "demo", salesGoal: p.salesGoal, workdays: 22, leadsGoal: p.leadsGoal, proposalsGoal: p.propGoal, dealsGoal: p.dealGoal, ...recap },
        });
      }
      await prisma.salesPeriodStat.upsert({
        where: { advisorEmployeeId_periodKey: { advisorEmployeeId: a.id, periodKey } },
        create: { advisorEmployeeId: a.id, periodKey, branch: a.branch, source: "demo", leadsCreated: p.leads, proposalsMade: p.proposals, dealsClosed: p.deals, closedAmount: p.closed },
        update: { branch: a.branch, source: "demo", leadsCreated: p.leads, proposalsMade: p.proposals, dealsClosed: p.deals, closedAmount: p.closed },
      });
      // Prior month closed (for Most Improved).
      await prisma.salesPeriodStat.upsert({
        where: { advisorEmployeeId_periodKey: { advisorEmployeeId: a.id, periodKey: prevKey } },
        create: { advisorEmployeeId: a.id, periodKey: prevKey, branch: a.branch, source: "demo", closedAmount: p.prev },
        update: { source: "demo", closedAmount: p.prev },
      });
      loaded++;
    }
    return NextResponse.json({ ok: true, loaded });
  } catch (e) {
    return fail(e);
  }
}
