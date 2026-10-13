import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

// Read-only ground-truth for "why is a report empty?" Reports the server clock
// (so "Last month" presets can be sanity-checked), the warehouse names (the
// purchase loader matches these EXACTLY), and invoice / check-in counts bucketed
// by month — so we can see whether the Aug/Sep data actually landed in THIS
// database.
//
// Auth: either an admin session (open it in the browser while signed in), OR a
// bearer/token match against CRON_SECRET — `Authorization: Bearer <CRON_SECRET>`
// or `?token=<CRON_SECRET>` — so the maintainer can pull prod ground-truth with
// a plain curl. The payload is strictly counts/names/timestamps (no PII, no
// secrets), and the route only ever reads.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization") === `Bearer ${secret}`;
  const token = req.nextUrl.searchParams.get("token");
  const tokenOk = !!secret && (bearer || token === secret);

  if (!tokenOk) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const [warehouses, totalInvoices, confirmedInvoices, invoices, checkInCount, sampleInvoices] = await Promise.all([
    prisma.warehouse.findMany({ select: { name: true, active: true } }).catch(() => []),
    prisma.invoice.count().catch(() => 0),
    prisma.invoice.count({ where: { status: "confirmed" } }).catch(() => 0),
    prisma.invoice.findMany({ select: { invoiceDate: true, status: true, distributor: true } }).catch(() => []),
    prisma.stockMovement.count({ where: { type: "check_in" } }).catch(() => 0),
    prisma.invoice.findMany({
      orderBy: { invoiceDate: "desc" },
      take: 5,
      select: { invoiceNumber: true, invoiceDate: true, status: true, distributor: true, warehouse: { select: { name: true } } },
    }).catch(() => []),
  ]);

  // Bucket invoices by YYYY-MM of invoiceDate (confirmed only).
  const byMonth: Record<string, number> = {};
  for (const inv of invoices) {
    if (inv.status !== "confirmed" || !inv.invoiceDate) continue;
    const k = inv.invoiceDate.toISOString().slice(0, 7);
    byMonth[k] = (byMonth[k] ?? 0) + 1;
  }

  return NextResponse.json({
    build: { tag: "reports-diag-2" },
    serverTime: now.toISOString(),
    lastMonthRange: { from: lastMonthStart.toISOString().slice(0, 10), to: lastMonthEnd.toISOString().slice(0, 10) },
    warehouses: warehouses.map((w) => w.name),
    invoices: { total: totalInvoices, confirmed: confirmedInvoices, confirmedByMonth: byMonth },
    checkInMovements: checkInCount,
    recentInvoices: sampleInvoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate?.toISOString().slice(0, 10) ?? null,
      status: i.status,
      distributor: i.distributor,
      warehouse: i.warehouse?.name ?? null,
    })),
  });
}
