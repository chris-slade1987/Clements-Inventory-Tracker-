import { NextResponse } from "next/server";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { sendRescoreNotices } from "@/lib/inspection-rescore-notify";

export const runtime = "nodejs";
export const maxDuration = 60;

// Send the one-time "inspection scoring revised" notices (technicians with a
// re-scored inspection + every branch manager). SUPER ADMINS ONLY. Idempotent —
// anyone already sent a notice is skipped, so pressing again only retries gaps.
export async function POST() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const results = await sendRescoreNotices();
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return fail(e);
  }
}
