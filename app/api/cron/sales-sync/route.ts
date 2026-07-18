import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { syncSalesFromSheet } from "@/lib/sales-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hourly Sales Center sync. Vercel Cron hits this with a CRON_SECRET bearer; an
// admin can also trigger it. Matches the sheet's hourly refresh from Sales Center.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || (user.role !== "admin" && user.role !== "manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await syncSalesFromSheet(prisma);
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
