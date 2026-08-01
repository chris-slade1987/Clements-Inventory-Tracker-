import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { syncFleet } from "@/lib/gps";

export const runtime = "nodejs";
export const maxDuration = 120;

// Scheduled GPS fleet sync (Vercel Cron). The webhook is a push feed that can go
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
