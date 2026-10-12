import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getLastIdentify } from "@/lib/inventory-identify";

export const runtime = "nodejs";
export const maxDuration = 20;

// GET /api/inventory/diagnostics — admin-only health/config view for the
// scan-to-issue feature (mirrors the WorkWave diagnostics shape).
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [catalogCount, barcodeCount, checkouts24h, lastIdentify] = await Promise.all([
    prisma.product.count({ where: { active: true } }),
    prisma.productBarcode.count(),
    prisma.checkout.count({ where: { createdAt: { gte: since } } }),
    getLastIdentify(),
  ]);

  return NextResponse.json({
    build: { tag: "inventory-checkout-1" },
    catalogCount,
    barcodeCount,
    checkouts24h,
    lastIdentify,
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}
