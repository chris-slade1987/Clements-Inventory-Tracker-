import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { syncCoastFuel } from "@/lib/fuel";

export const runtime = "nodejs";
export const maxDuration = 30;

// Scheduled Coast fuel sync (Vercel Cron). Coast purchases settle 24–72h after
// the swipe and there are no webhooks, so we poll a few times a day. Vercel Cron
// hits this with GET + (when CRON_SECRET is set) `Authorization: Bearer <secret>`;
// also runnable by an admin. No-op (200) when COAST_API_KEY isn't configured.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await syncCoastFuel();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
