import { NextResponse } from "next/server";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { getTerritory, getAllTerritories } from "@/lib/weather/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID = new Set<string>(BRANCHES.map((b) => b.key));

// Weather Ops territory data, with server-side role scoping (the UI gate is not the
// security boundary). admin/superadmin/senior-leadership see every territory; a
// branch-locked manager sees ONLY their own and gets 403 for any other branch.
// ?branch=<slug|all>, ?brief=0 to skip the (slower) AI briefing (used by rollups).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canSeeAll = !branchLocked(user) || user.seniorLeadership;
  const url = new URL(req.url);
  const requested = url.searchParams.get("branch");
  const withBriefing = url.searchParams.get("brief") !== "0";
  const force = url.searchParams.get("force") === "1"; // manual "Refresh now" (scoped)

  if (requested && requested !== "all" && !VALID.has(requested))
    return NextResponse.json({ error: "Unknown branch." }, { status: 400 });

  // A branch-locked manager may only ever see their own branch.
  if (!canSeeAll && requested && requested !== "all" && requested !== user.branch)
    return NextResponse.json({ error: "That is not your branch." }, { status: 403 });

  try {
    if (!canSeeAll) {
      if (!user.branch) return NextResponse.json({ error: "No branch assigned." }, { status: 403 });
      const territory = await getTerritory(user.branch, { withBriefing, force });
      return NextResponse.json({ canSeeAll: false, scope: user.branch, territories: [territory] });
    }
    if (requested && requested !== "all") {
      const territory = await getTerritory(requested, { withBriefing, force });
      return NextResponse.json({ canSeeAll: true, scope: requested, territories: [territory] });
    }
    const territories = await getAllTerritories({ withBriefing, force });
    return NextResponse.json({ canSeeAll: true, scope: "all", territories });
  } catch (e) {
    console.error("GET /api/weather:", e);
    return NextResponse.json({ error: "Could not load weather." }, { status: 500 });
  }
}
