import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { syncSmarterLaunchBackfill } from "@/lib/smarterlaunch";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily SmarterLaunch backfill (Vercel Cron). The live feed is the outbound
// webhook; this is a small, quota-aware safety net that re-pulls recently updated
// proposals so nothing is missed. Vercel Cron hits this with GET +
// (when CRON_SECRET is set) `Authorization: Bearer <secret>`; an admin/manager can
// also trigger it. No-op (200) when the connector isn't configured.
//
// HARD BUDGET: 250 API calls/day/company. This stays well short — a handful of
// pages, enrichment only while above a budget floor, and it bails the moment a
// company/api_key rate limit is reported.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || (user.role !== "admin" && user.role !== "manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await syncSmarterLaunchBackfill();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
