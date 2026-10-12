import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { fail } from "@/lib/http";
import { branchLabel } from "@/lib/management";
import { resolveRange, buildHeatMap, buildSourcePerformance } from "@/lib/sales-leads";
import { heatMapInsight, sourceInsight } from "@/lib/sales-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

// On-demand AI insight over the lead data. kind "heatmap" → geographic insight;
// kind "sources" → lead-source insight. scope "team" (company-wide, managers
// only) or "advisor" (one advisor — themselves, or a manager viewing anyone).
// Falls back to a deterministic insight when no Anthropic key is configured.
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

    const body = await req.json().catch(() => null);
    const kind = body?.kind === "sources" ? "sources" : "heatmap";
    const scope = body?.scope === "team" ? "team" : "advisor";
    const range = resolveRange(body?.range, body?.from, body?.to);
    const branch = typeof body?.branch === "string" && body.branch ? body.branch : null;

    let advisorEmployeeId: string | null = null;
    let scopeLabel = "Company-wide";

    if (scope === "team") {
      if (!canManageSales(user)) return NextResponse.json({ error: "Managers only." }, { status: 403 });
      scopeLabel = branch ? `${branchLabel(branch)} branch` : "Company-wide";
    } else {
      advisorEmployeeId = typeof body?.advisorEmployeeId === "string" ? body.advisorEmployeeId : (user.employeeId ?? "");
      if (!advisorEmployeeId) return NextResponse.json({ error: "No advisor." }, { status: 400 });
      if (advisorEmployeeId !== user.employeeId && !canManageSales(user)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
      const emp = await prisma.employee.findUnique({ where: { id: advisorEmployeeId }, select: { name: true } });
      scopeLabel = `${emp?.name ?? "Advisor"} (personal), ${range.label}`;
    }

    const filter = { range, branch: scope === "team" ? branch : null, advisorEmployeeId };
    if (kind === "sources") {
      const perf = await buildSourcePerformance(filter);
      const r = await sourceInsight(perf, scope, scopeLabel);
      return NextResponse.json({ ok: true, ...r });
    }
    const heat = await buildHeatMap(filter);
    const r = await heatMapInsight(heat, scope, scopeLabel);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return fail(e);
  }
}
