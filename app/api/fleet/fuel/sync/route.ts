import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { syncCoastFuel } from "@/lib/fuel";

export const runtime = "nodejs";
export const maxDuration = 30;

// Pull new/updated Coast fuel-card purchases and link them to vehicles. Admin
// (the fuel dashboard "Sync from Coast" button) or the cron with CRON_SECRET.
// Never throws — syncCoastFuel() captures errors into its result.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await syncCoastFuel();
  return NextResponse.json(result, { status: result.ok || !result.configured ? 200 : 502 });
}

export async function POST(req: Request) {
  return run(req);
}
export async function GET(req: Request) {
  return run(req);
}
