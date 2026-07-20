import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";

// Reconciliation never hard-deletes. All corrections are new movements:
//  - reverse:  post an offsetting adjustment linked to the original
//  - correct:  reverse the original, then post a corrected replacement
//  - adjust:   post a standalone manual adjustment (+/-) with a reason
// Every movement records userId + createdAt, which is the audit trail.

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action ?? "";

  if (action === "adjust") {
    const productId: string = body?.productId ?? "";
    const warehouseId: string = body?.warehouseId ?? "";
    const quantity = Number(body?.quantity);
    const reason: string = (body?.reason ?? "").trim();
    if (!productId || !warehouseId) {
      return NextResponse.json({ error: "Product and warehouse are required." }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity === 0) {
      return NextResponse.json({ error: "Enter a non-zero quantity." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required." }, { status: 400 });
    }
    const created = await prisma.stockMovement.create({
      data: { type: "adjustment", productId, warehouseId, quantity, reason, userId: user.id },
    });
    return NextResponse.json({ ok: true, id: created.id });
  }

  if (action === "reverse" || action === "correct") {
    const movementId: string = body?.movementId ?? "";
    const reason: string = (body?.reason ?? "").trim();
    if (!movementId) {
      return NextResponse.json({ error: "Movement is required." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required." }, { status: 400 });
    }

    const original = await prisma.stockMovement.findUnique({
      where: { id: movementId },
      include: { reversedBy: true },
    });
    if (!original) {
      return NextResponse.json({ error: "Movement not found." }, { status: 404 });
    }
    if (original.reversalOfId) {
      return NextResponse.json(
        { error: "This entry is itself a reversal and can't be reversed." },
        { status: 409 }
      );
    }
    if (original.reversedBy) {
      return NextResponse.json(
        { error: "This movement has already been reversed." },
        { status: 409 }
      );
    }

    if (action === "reverse") {
      const rev = await prisma.stockMovement.create({
        data: {
          type: "adjustment",
          productId: original.productId,
          warehouseId: original.warehouseId,
          technicianId: original.technicianId,
          quantity: -original.quantity,
          reason: `Reversal: ${reason}`,
          reversalOfId: original.id,
          userId: user.id,
        },
      });
      return NextResponse.json({ ok: true, id: rev.id });
    }

    // correct: reverse original + post corrected replacement in one transaction.
    const newQty = Number(body?.quantity);
    if (!Number.isFinite(newQty)) {
      return NextResponse.json({ error: "Enter a corrected quantity." }, { status: 400 });
    }
    const [, corrected] = await prisma.$transaction([
      prisma.stockMovement.create({
        data: {
          type: "adjustment",
          productId: original.productId,
          warehouseId: original.warehouseId,
          technicianId: original.technicianId,
          quantity: -original.quantity,
          reason: `Correction (reversal): ${reason}`,
          reversalOfId: original.id,
          userId: user.id,
        },
      }),
      prisma.stockMovement.create({
        data: {
          type: original.type,
          productId: original.productId,
          warehouseId: original.warehouseId,
          technicianId: original.technicianId,
          quantity: newQty,
          unitPrice: original.unitPrice,
          sourceInvoiceId: original.sourceInvoiceId,
          reason: `Corrected from ${original.quantity} to ${newQty}: ${reason}`,
          userId: user.id,
        },
      }),
    ]);
    return NextResponse.json({ ok: true, id: corrected.id });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
