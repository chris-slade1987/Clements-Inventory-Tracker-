import { NextResponse } from "next/server";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { fail } from "@/lib/http";
import { teamFunnel, salesPace } from "@/lib/sales-funnel";
import { currentPeriodKey } from "@/lib/sales";
import { coachAdvisor, briefTeam } from "@/lib/sales-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

// On-demand AI coaching. scope "advisor" → a coaching note + month-end projection
// for one advisor (the advisor themselves, or a sales manager/admin). scope "team"
// → a director briefing (managers/admins only). Falls back to the deterministic
// diagnosis text when no Anthropic key is set.
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await req.json().catch(() => null);
    const periodKey = typeof body?.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : currentPeriodKey();
    const scope = body?.scope === "team" ? "team" : "advisor";
    const pace = salesPace(periodKey);

    if (scope === "team") {
      if (!canManageSales(user)) return NextResponse.json({ error: "Managers only." }, { status: 403 });
      const { rows } = await teamFunnel(periodKey, null);
      const r = await briefTeam(rows, pace);
      return NextResponse.json({ ok: true, ...r });
    }

    const advisorEmployeeId = typeof body?.advisorEmployeeId === "string" ? body.advisorEmployeeId : (user.employeeId ?? "");
    if (!advisorEmployeeId) return NextResponse.json({ error: "No advisor." }, { status: 400 });
    // An advisor may coach themselves; managers/admins may coach anyone.
    if (advisorEmployeeId !== user.employeeId && !canManageSales(user)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

    const { rows } = await teamFunnel(periodKey, null);
    const row = rows.find((x) => x.advisor.id === advisorEmployeeId);
    if (!row) return NextResponse.json({ error: "That advisor isn't on the sales team." }, { status: 404 });
    const r = await coachAdvisor(row, pace);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return fail(e);
  }
}
