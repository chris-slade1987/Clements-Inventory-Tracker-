import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { resetDemo } from "@/prisma/seed-demo";

export const runtime = "nodejs";
export const maxDuration = 20;

// Reset the demo dataset (clear demo-marked rows, then reseed). Admin only, and
// only when demo mode is on. Never throws — any failure is captured into the
// JSON response so the client always gets a clean answer.
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Only an admin may reset demo data." }, { status: 403 });
  }
  if (!(await isDemoMode())) {
    return NextResponse.json({ ok: false, error: "Demo mode is off." }, { status: 400 });
  }

  try {
    const summary = await resetDemo();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
