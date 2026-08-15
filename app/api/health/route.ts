import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Diagnostic endpoint: open /api/health in a browser to check that the app can
// reach its database and that sample data is loaded. Safe to leave in — it
// exposes no secrets (only the URL scheme, never credentials).
export async function GET() {
  const dbScheme = (process.env.DATABASE_URL ?? "").split(":")[0] || "unset";
  try {
    const [warehouses, users, products, techActive, techTotal] =
      await Promise.all([
        prisma.warehouse.count(),
        prisma.user.count(),
        prisma.product.count(),
        prisma.technician.count({ where: { active: true } }),
        prisma.technician.count(),
      ]);
    return NextResponse.json({
      ok: true,
      dbScheme,
      seeded: users > 0 && warehouses > 0,
      counts: {
        warehouses,
        users,
        products,
        techniciansActive: techActive,
        techniciansTotal: techTotal,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, dbScheme, error: (e as Error).message },
      { status: 500 }
    );
  }
}
