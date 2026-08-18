import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { clearPastDue } from "@/lib/manual-reminders";

export const runtime = "nodejs";

// Admin-only bulk clear of past-due items: dismiss open manual reminders and
// close open audit follow-ups whose due date is before today. Reversible —
// nothing is deleted; upcoming items (today onward) are untouched.
export async function POST() {
  const user = await requireUser();
  if (user.role !== "admin") return NextResponse.json({ error: "Only an admin can clear past-due alerts." }, { status: 403 });
  const result = await clearPastDue();
  return NextResponse.json({ ok: true, ...result });
}
