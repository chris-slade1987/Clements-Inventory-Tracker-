import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { backfillDriverLinks } from "@/lib/fleet-driver-link";

export const runtime = "nodejs";
export const maxDuration = 120;

// Admin-triggered backfill: link each vehicle's existing driver NAME
// (assignedTo, from the fleet import) to the matching employee record, so the
// driver grid comes up pre-populated. Idempotent; also runnable with CRON_SECRET.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await backfillDriverLinks();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) { return run(req); }
export async function GET(req: Request) { return run(req); }
