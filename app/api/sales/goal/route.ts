import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { upsertGoalSheet, currentPeriodKey, type GoalSheetInput } from "@/lib/sales";

export const runtime = "nodejs";
export const maxDuration = 20;

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Save (create/update) a monthly sales goal sheet. A service advisor may edit
// their own; the Sales Director / admins may edit anyone's.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const periodKey = typeof body.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : currentPeriodKey();
  const advisorEmployeeId: string | null = (typeof body.advisorEmployeeId === "string" && body.advisorEmployeeId) || user.employeeId;
  if (!advisorEmployeeId) return NextResponse.json({ error: "No advisor to save for." }, { status: 400 });

  // Permission: own sheet, or a sales manager editing anyone's.
  if (advisorEmployeeId !== user.employeeId && !canManageSales(user))
    return NextResponse.json({ error: "You can only edit your own goal sheet." }, { status: 403 });

  const data: GoalSheetInput = {
    reis: num(body.reis), appts: num(body.appts), proposals: num(body.proposals),
    pcExposed: num(body.pcExposed), pcSold: num(body.pcSold), tcSold: num(body.tcSold),
    totalExposure: num(body.totalExposure), tcUnits: num(body.tcUnits),
    salesGoal: num(body.salesGoal), workdays: num(body.workdays),
  };

  try {
    const emp = await prisma.employee.findUnique({ where: { id: advisorEmployeeId }, select: { branch: true } });
    const sheet = await upsertGoalSheet(advisorEmployeeId, periodKey, data, { branch: emp?.branch ?? null, userId: user.id });
    return NextResponse.json({ ok: true, id: sheet.id, periodKey });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
