import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/inventory/barcode/unlink  { id }
// Admin-only. Removes a ProductBarcode mapping (used from /inventory/catalog).
// Product.barcode (legacy mirror) is left untouched.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const existing = await prisma.productBarcode.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Barcode not found." }, { status: 404 });

  await prisma.productBarcode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
