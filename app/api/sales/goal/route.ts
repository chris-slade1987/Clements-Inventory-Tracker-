import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { upsertGoalSheet, proposeGoal, acceptProposal, currentPeriodKey, type GoalSheetInput } from "@/lib/sales";

export const runtime = "nodejs";
export const maxDuration = 20;

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Save a monthly sales goal sheet. Three actions, all through this one path:
//   • (default) save the full sheet — a service advisor edits their own; the
//     Sales Director / admins (canManageSales) may edit anyone's.
//   • action:"propose"  — the Sales Director proposes a goal ALONGSIDE the
//     advisor's (canManageSales only); never overwrites the advisor's entry.
//   • action:"accept"   — the advisor (or a sales manager) accepts the proposal,
//     making it the committed goal.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const periodKey = typeof body.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : currentPeriodKey();
  const advisorEmployeeId: string | null = (typeof body.advisorEmployeeId === "string" && body.advisorEmployeeId) || user.employeeId;
  if (!advisorEmployeeId) return NextResponse.json({ error: "No advisor to save for." }, { status: 400 });

  const isOwn = advisorEmployeeId === user.employeeId;
  const action: string = typeof body.action === "string" ? body.action : "save";

  try {
    const emp = await prisma.employee.findUnique({ where: { id: advisorEmployeeId }, select: { branch: true } });

    // Director co-goal-setting: PROPOSE a goal. Director/admin only.
    if (action === "propose") {
      if (!canManageSales(user))
        return NextResponse.json({ error: "Only the Sales Director can propose a goal." }, { status: 403 });
      const sheet = await proposeGoal(advisorEmployeeId, periodKey, num(body.proposedGoal), { branch: emp?.branch ?? null, userId: user.id });
      return NextResponse.json({ ok: true, id: sheet.id, periodKey, goalStatus: sheet.goalStatus });
    }

    // ACCEPT the director's proposal. The advisor (own sheet) or a sales manager.
    if (action === "accept") {
      if (!isOwn && !canManageSales(user))
        return NextResponse.json({ error: "You can only accept a proposal on your own goal sheet." }, { status: 403 });
      const sheet = await acceptProposal(advisorEmployeeId, periodKey);
      if (!sheet) return NextResponse.json({ error: "There's no proposed goal to accept." }, { status: 400 });
      return NextResponse.json({ ok: true, id: sheet.id, periodKey, goalStatus: sheet.goalStatus });
    }

    // Default: save the full sheet. Own sheet, or a sales manager editing anyone's.
    if (!isOwn && !canManageSales(user))
      return NextResponse.json({ error: "You can only edit your own goal sheet." }, { status: 403 });

    const data: GoalSheetInput = {
      leads: num(body.leads), reis: num(body.reis), appts: num(body.appts), proposals: num(body.proposals),
      pcExposed: num(body.pcExposed), pcSold: num(body.pcSold), tcSold: num(body.tcSold),
      totalExposure: num(body.totalExposure), tcUnits: num(body.tcUnits),
      salesGoal: num(body.salesGoal), workdays: num(body.workdays),
    };
    const initiatives = Array.isArray(body.initiatives) ? (body.initiatives as unknown[]).map((s) => String(s)) : undefined;
    const notesForDirector = typeof body.notesForDirector === "string" ? body.notesForDirector : undefined;
    const sheet = await upsertGoalSheet(advisorEmployeeId, periodKey, data, {
      branch: emp?.branch ?? null, userId: user.id,
      ...(initiatives !== undefined ? { initiatives } : {}),
      ...(notesForDirector !== undefined ? { notesForDirector } : {}),
    });
    return NextResponse.json({ ok: true, id: sheet.id, periodKey, goalStatus: sheet.goalStatus });
  } catch (e) {
    return fail(e);
  }
}
