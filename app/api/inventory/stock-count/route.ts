import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { onHandByWarehouse } from "@/lib/inventory";
import { COUNT_REASON_PREFIX } from "@/lib/stock-count";
import { uomCode } from "@/lib/uom";

export const runtime = "nodejs";
export const maxDuration = 20;

type CountIn = { productId: string; counted: number };

// POST /api/inventory/stock-count  { warehouseId, counts: [{ productId, counted }] }
// Physical count entry (admin/manager). Writes ONE `adjustment` movement per
// product = (counted − current) — always, even when the delta is 0, so the
// product is recorded as "counted at branch" (its on-hand never changes by adding
// 0). Never edits on-hand directly; never hard-deletes.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only managers or admins can enter counts." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const warehouseId = String(body?.warehouseId ?? "");
  const rawCounts: CountIn[] = Array.isArray(body?.counts) ? body.counts : [];

  if (!warehouseId) return NextResponse.json({ error: "Select a warehouse." }, { status: 400 });
  if (user.role !== "admin" && warehouseId !== user.warehouseId) {
    return NextResponse.json({ error: "You can only count your own branch." }, { status: 403 });
  }

  const counts = rawCounts
    .map((c) => ({ productId: String(c.productId), counted: Math.trunc(Number(c.counted)) }))
    .filter((c) => c.productId && Number.isFinite(c.counted) && c.counted >= 0);
  if (counts.length === 0) return NextResponse.json({ error: "Enter at least one count." }, { status: 400 });

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });

  const products = await prisma.product.findMany({
    where: { id: { in: counts.map((c) => c.productId) } },
    select: { id: true, unitOfMeasure: true },
  });
  const unitById = new Map(products.map((p) => [p.id, uomCode(p.unitOfMeasure)]));
  const validIds = new Set(products.map((p) => p.id));

  const onHand = await onHandByWarehouse(warehouseId);
  const stamp = new Date().toISOString().slice(0, 10);
  const reason = `${COUNT_REASON_PREFIX} ${stamp} by ${user.name}`;

  const applicable = counts.filter((c) => validIds.has(c.productId));
  let adjusted = 0;

  await prisma.$transaction(async (tx) => {
    for (const c of applicable) {
      const current = onHand.get(c.productId) ?? 0;
      const delta = c.counted - current;
      if (delta !== 0) adjusted++;
      await tx.stockMovement.create({
        data: {
          type: "adjustment",
          productId: c.productId,
          warehouseId,
          quantity: delta, // may be 0 — still records the product as counted
          unit: unitById.get(c.productId) ?? null,
          userId: user.id,
          reason,
        },
      });
    }
  });

  return NextResponse.json({ ok: true, counted: applicable.length, adjusted });
}
