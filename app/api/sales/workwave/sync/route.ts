import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isConfigured, syncWorkwaveSales } from "@/lib/workwave";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin-triggered live WorkWave Sales Center sync. Pulls opportunities, rolls
// them up, and writes a SalesSnapshot the Sales dashboard reads. No-op with a
// clear message when the WorkWave key isn't configured.
async function run() {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ ok: false, error: "WorkWave is not configured (set WORKWAVE_API_KEY)." }, { status: 400 });
  }
  const result = await syncWorkwaveSales();
  return NextResponse.json({ ranAt: new Date().toISOString(), source: "workwave", ...result });
}

export async function POST() { return run(); }
export async function GET() { return run(); }
