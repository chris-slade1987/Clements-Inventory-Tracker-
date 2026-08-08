import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canEditAccessLevels } from "@/lib/auth";
import { LEVEL_ROLE, type AccessLevelKey } from "@/lib/access-levels";

export const runtime = "nodejs";

// Set a user's access level. ONLY full admins may change access rights. Setting a
// level also aligns the underlying `role` so the existing role-based gates keep
// working (admin & admin_lite → role "admin"; manager → "manager"; the rest →
// "employee"). Admin Lite is then narrowed by the People team-wall.
export async function POST(req: Request) {
  const actor = await getSessionUser();
  if (!actor || !canEditAccessLevels(actor))
    return NextResponse.json({ error: "Only a full admin can change access rights." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const level = typeof body?.accessLevel === "string" ? body.accessLevel : "";
  if (!userId) return NextResponse.json({ error: "That person has no login account to assign a level to." }, { status: 400 });
  if (!(level in LEVEL_ROLE)) return NextResponse.json({ error: "Unknown access level." }, { status: 400 });

  // Guard against an admin removing their own admin reach by mistake.
  if (userId === actor.id && level !== "admin")
    return NextResponse.json({ error: "You can't lower your own admin access. Ask another admin." }, { status: 400 });

  await prisma.user.update({
    where: { id: userId },
    data: { accessLevel: level, role: LEVEL_ROLE[level as AccessLevelKey] },
  });
  return NextResponse.json({ ok: true });
}
