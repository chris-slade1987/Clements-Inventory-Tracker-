import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { syncFleet } from "@/lib/gps";

export const runtime = "nodejs";
// Capped low on purpose: a failing Verizon integration loops per-vehicle (15s
// timeout each), so a generous budget lets one run burn minutes of compute.
// 30s is plenty for a healthy sync and bounds the cost of a broken one.
export const maxDuration = 20;

// GPS fleet sync. NOTE: the every-15-minute Vercel Cron for this route is
// intentionally PAUSED (removed from vercel.json) to stop recurring spend while
// the Verizon integration is unverified. The route still works for manual
// admin-triggered syncs; re-add the cron entry to resume scheduled updates. The webhook is a push feed that can go
// silent if a subscription lapses; this scheduled REST pull is the safety net so
// positions + trips stay fresh unattended. Vercel Cron hits this with GET +
// (when CRON_SECRET is set) `Authorization: Bearer <secret>`; also admin-runnable.
// No-op (200) when the VERIZON_* creds aren't configured — syncFleet never throws.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await syncFleet();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
