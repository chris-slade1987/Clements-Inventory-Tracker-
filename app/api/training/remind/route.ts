import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { remindTraining } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 20;

// Manual trigger (admin) for training reminders. The daily cron uses /api/cron/daily.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const r = await remindTraining();
  return NextResponse.json({ ok: true, ...r });
}
