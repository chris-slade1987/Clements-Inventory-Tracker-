import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { reprocessStoredPositionEvents } from "@/lib/gps-webhook";

export const runtime = "nodejs";
export const maxDuration = 20;

// Admin backfill: re-parse already-stored Verizon webhook events into GpsPosition
// rows. This lights up the map from the position events that arrived BEFORE the
// CloudEvents parser fix, without waiting for new deliveries. Also runnable with
// CRON_SECRET so it can be triggered headless. `?limit=N` caps the scan
// (newest-first; default 20000).
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50000) : 20000;
  const result = await reprocessStoredPositionEvents(limit);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) { return run(req); }
export async function GET(req: Request) { return run(req); }
