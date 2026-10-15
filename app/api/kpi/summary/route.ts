import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getSessionUser, canViewExec, branchLocked } from "@/lib/auth";
import { BRANCHES, resolvePeriod, periodValues, type Scope } from "@/lib/management";
import { summarizeKpis } from "@/lib/kpi-ai";

export const runtime = "nodejs";
export const maxDuration = 30;

// On-demand AI KPI read-out. Scope-aware + access-gated:
//   • company scope → admins/exec (canViewExec) or the Sales Director only.
//   • a branch scope → admins/exec/Sales Director (any branch), or a branch
//     manager for THEIR OWN branch (branch-locked users are pinned to it).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const requested = typeof body.scope === "string" ? body.scope : "company";
  const basis: "month" | "ytd" = body.basis === "ytd" ? "ytd" : "month";
  const p = typeof body.p === "string" ? body.p : undefined;

  const isExec = canViewExec(user) || user.accessLevel === "sales_director";
  const validBranch = BRANCHES.find((b) => b.key === requested)?.key ?? null;

  // Resolve the effective scope under the caller's permissions.
  let scope: Scope;
  if (branchLocked(user)) {
    // Branch managers only ever get their own branch, whatever they ask for.
    if (!user.branch) return NextResponse.json({ error: "No branch to summarize." }, { status: 400 });
    scope = user.branch as Scope;
  } else if (requested === "company") {
    if (!isExec) return NextResponse.json({ error: "Company metrics are leadership-only." }, { status: 403 });
    scope = "company";
  } else if (validBranch) {
    if (!isExec) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    scope = validBranch as Scope;
  } else {
    return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
  }

  try {
    const period = await resolvePeriod(p);
    if (!period) return NextResponse.json({ error: "No report period loaded yet." }, { status: 400 });
    const values = await periodValues(period.id);
    const { text, ai } = await summarizeKpis(values, scope, basis, period.label);
    return NextResponse.json({ ok: true, text, ai, scope });
  } catch (e) {
    return fail(e);
  }
}
