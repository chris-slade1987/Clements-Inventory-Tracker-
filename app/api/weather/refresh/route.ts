import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { refreshAll } from "@/lib/weather/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// Secured refresh for every active location + briefing regeneration. Called by the
// hourly Vercel cron (Authorization: Bearer CRON_SECRET) or an admin manually. The
// refresh-on-read path keeps data fresh without this; the cron just guarantees the
// morning briefing and keeps things warm. Dual auth mirrors the other cron routes.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await refreshAll();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
