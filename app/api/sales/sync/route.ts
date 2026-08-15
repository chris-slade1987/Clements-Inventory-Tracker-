import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { syncSalesFromSheet } from "@/lib/sales-sync";

export const runtime = "nodejs";
export const maxDuration = 20;

// Pull the Sales Center Google Sheet and refresh the metrics snapshot.
// Admin/manager triggered; also called by the cron.
export async function POST() {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await syncSalesFromSheet(prisma);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
