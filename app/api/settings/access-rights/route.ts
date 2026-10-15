import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canManageAccessRights, saveLevelGrants, saveUserOverride } from "@/lib/access";
import { sanitizeGrants } from "@/lib/access-catalog";

// Save access-rights changes. Super admins only (Chris, Julie, April).
export async function POST(req: Request) {
  const user = await requireUser();
  if (!canManageAccessRights(user)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const scope = body?.scope;
  const grants = sanitizeGrants(body?.grants);

  try {
    if (scope === "level") {
      if (typeof body?.key !== "string") return NextResponse.json({ error: "Missing level." }, { status: 400 });
      await saveLevelGrants(body.key, grants);
    } else if (scope === "user") {
      if (typeof body?.userId !== "string") return NextResponse.json({ error: "Missing user." }, { status: 400 });
      await saveUserOverride(body.userId, grants);
    } else {
      return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
