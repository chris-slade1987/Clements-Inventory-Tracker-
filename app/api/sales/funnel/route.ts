import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { fail } from "@/lib/http";
import { upsertFunnelStat } from "@/lib/sales-funnel";

export const runtime = "nodejs";
export const maxDuration = 20;

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };

// Manual entry of an advisor's monthly funnel actuals (Leads / Proposals / Closed $)
// by the Sales Director or an admin. This is how the board runs THIS month, before
// the SmarterLaunch feed is live; SmarterLaunch upserts the same rows via /ingest.
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || !canManageSales(user)) return NextResponse.json({ error: "Only the Sales Director or an admin can edit sales numbers." }, { status: 403 });

    const body = await req.json().catch(() => null);
    const advisorEmployeeId = typeof body?.advisorEmployeeId === "string" ? body.advisorEmployeeId : "";
    const periodKey = typeof body?.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : "";
    if (!advisorEmployeeId || !periodKey) return NextResponse.json({ error: "Missing advisor or period." }, { status: 400 });

    const emp = await prisma.employee.findUnique({ where: { id: advisorEmployeeId }, select: { id: true, branch: true } });
    if (!emp) return NextResponse.json({ error: "Advisor not found." }, { status: 404 });

    await upsertFunnelStat(
      advisorEmployeeId,
      periodKey,
      { leadsCreated: num(body?.leadsCreated), proposalsMade: num(body?.proposalsMade), closedAmount: num(body?.closedAmount) },
      { branch: emp.branch, source: "manual", userId: user.id },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
