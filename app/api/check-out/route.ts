import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { onHandByWarehouse } from "@/lib/inventory";
import { uomCode } from "@/lib/uom";

type LineIn = { productId: string; quantity: number; unit?: string | null };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const warehouseId: string = body?.warehouseId ?? "";
  const technicianId: string = body?.technicianId ?? "";
  // Insufficient-stock is a HARD STOP for managers — only an admin may
  // reconcile-through by driving stock negative. A branch manager can never
  // override; they must escalate to reconcile on-hand instead.
  const allowNegative: boolean = body?.allowNegative === true && user.role === "admin";
  const rawLines: LineIn[] = Array.isArray(body?.lines) ? body.lines : [];

  // Normalise + validate lines.
  const lines = rawLines
    .map((l) => ({
      productId: String(l.productId),
      quantity: Number(l.quantity),
      unit: uomCode(l.unit),
    }))
    .filter((l) => l.productId && Number.isFinite(l.quantity) && l.quantity > 0);

  if (!warehouseId) {
    return NextResponse.json({ error: "Select a warehouse." }, { status: 400 });
  }
  if (!technicianId) {
    return NextResponse.json({ error: "Select a technician." }, { status: 400 });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "Add at least one product." }, { status: 400 });
  }

  const [warehouse, technician, products] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: warehouseId } }),
    prisma.technician.findUnique({ where: { id: technicianId } }),
    prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
    }),
  ]);

  if (!warehouse) return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  if (!technician) return NextResponse.json({ error: "Technician not found." }, { status: 404 });

  const productById = new Map(products.map((p) => [p.id, p]));

  // Negative-stock guard.
  const onHand = await onHandByWarehouse(warehouseId);
  const wouldGoNegative = lines
    .map((l) => {
      const current = onHand.get(l.productId) ?? 0;
      return { ...l, current, after: current - l.quantity };
    })
    .filter((l) => l.after < 0);

  if (wouldGoNegative.length > 0 && !allowNegative) {
    return NextResponse.json(
      {
        error: "negative_stock",
        offending: wouldGoNegative.map((l) => ({
          productId: l.productId,
          name: productById.get(l.productId)?.name ?? "Unknown",
          onHand: l.current,
          requested: l.quantity,
          after: l.after,
        })),
      },
      { status: 409 }
    );
  }

  // Post negative-quantity check_out movements atomically.
  const created = await prisma.$transaction(
    lines.map((l) =>
      prisma.stockMovement.create({
        data: {
          type: "check_out",
          productId: l.productId,
          warehouseId,
          technicianId,
          quantity: -Math.abs(l.quantity),
          // Canonical unit code chosen in the dropdown; falls back to the
          // product's approved unit. Never free text.
          unit: l.unit ?? uomCode(productById.get(l.productId)?.unitOfMeasure) ?? null,
          userId: user.id,
        },
      })
    )
  );

  const at = created[0]?.createdAt ?? new Date();
  return NextResponse.json({
    ok: true,
    receipt: {
      warehouse: warehouse.name,
      technician: technician.name,
      manager: user.name,
      at,
      lines: lines.map((l) => ({
        name: productById.get(l.productId)?.name ?? "Unknown",
        unit: l.unit ?? uomCode(productById.get(l.productId)?.unitOfMeasure) ?? "",
        quantity: l.quantity,
      })),
      totalItems: lines.reduce((s, l) => s + l.quantity, 0),
    },
  });
}
