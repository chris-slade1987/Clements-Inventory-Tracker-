import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { onHand } from "@/lib/inventory";
import { resolveRecipientTechnicianId } from "@/lib/checkout-recipient";

export const maxDuration = 20;

// GET /api/reconcile?productId=&warehouseId=  → live on-hand for that pair, so the
// modal can show current on-hand beside the delta (and the resulting on-hand).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId") ?? "";
  const warehouseId = searchParams.get("warehouseId") ?? "";
  if (!productId || !warehouseId) {
    return NextResponse.json({ error: "productId and warehouseId are required." }, { status: 400 });
  }
  const current = await onHand(productId, warehouseId);
  return NextResponse.json({ onHand: current });
}

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

    // correct: reverse the original and post a corrected replacement, in one
    // transaction. The replacement may change the QUANTITY, the WAREHOUSE (stock
    // checked into the wrong branch) and — for a check-out — the TECHNICIAN it went
    // to (COO 2026-11-18). `moveInvoice` moves every live line of the original's
    // invoice to the new warehouse the same way and re-files the invoice there.
    const newQty = body?.quantity === undefined || body?.quantity === null || body?.quantity === "" ? original.quantity : Number(body.quantity);
    if (!Number.isFinite(newQty) || newQty === 0) {
      return NextResponse.json({ error: "Enter a non-zero corrected quantity." }, { status: 400 });
    }
    const targetWarehouseId: string = typeof body?.warehouseId === "string" && body.warehouseId ? body.warehouseId : original.warehouseId;
    const wantTech: string | null = typeof body?.technicianId === "string" && body.technicianId ? body.technicianId : null;
    if (wantTech && original.type !== "check_out") {
      return NextResponse.json({ error: "Only a check-out has a technician to change." }, { status: 400 });
    }
    const moveInvoice = body?.moveInvoice === true;

    const [fromWh, toWh] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: original.warehouseId }, select: { name: true } }),
      prisma.warehouse.findUnique({ where: { id: targetWarehouseId }, select: { id: true, name: true, active: true } }),
    ]);
    if (!toWh || !toWh.active) return NextResponse.json({ error: "Pick an active warehouse." }, { status: 400 });

    let targetTechId = original.technicianId;
    let fromTechName: string | null = null;
    let toTechName: string | null = null;
    if (wantTech && wantTech !== original.technicianId) {
      const resolved = await resolveRecipientTechnicianId(wantTech, targetWarehouseId);
      if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
      targetTechId = resolved.id;
      const [ft, tt] = await Promise.all([
        original.technicianId ? prisma.technician.findUnique({ where: { id: original.technicianId }, select: { name: true } }) : null,
        prisma.technician.findUnique({ where: { id: targetTechId }, select: { name: true } }),
      ]);
      fromTechName = ft?.name ?? "no one";
      toTechName = tt?.name ?? "?";
    }

    const whChanged = targetWarehouseId !== original.warehouseId;
    const techChanged = targetTechId !== original.technicianId;
    const qtyChanged = newQty !== original.quantity;
    if (!whChanged && !techChanged && !qtyChanged) {
      return NextResponse.json({ error: "Nothing changed — edit the quantity, warehouse or technician." }, { status: 400 });
    }
    if (moveInvoice && (!whChanged || !original.sourceInvoiceId || original.type !== "check_in")) {
      return NextResponse.json({ error: "Moving a whole invoice needs a check-in from an invoice and a different warehouse." }, { status: 400 });
    }

    const changes = [
      qtyChanged ? `qty ${original.quantity} → ${newQty}` : null,
      whChanged ? `warehouse ${fromWh?.name ?? "?"} → ${toWh.name}` : null,
      techChanged ? `technician ${fromTechName} → ${toTechName}` : null,
    ].filter(Boolean).join("; ");

    // The lines to re-post: just this one, or every live check-in line on the invoice.
    const lines = moveInvoice
      ? await prisma.stockMovement.findMany({
          where: { sourceInvoiceId: original.sourceInvoiceId, type: "check_in", reversalOfId: null, reversedBy: null, warehouseId: { not: targetWarehouseId } },
        })
      : [original];

    const created = await prisma.$transaction(async (tx) => {
      let replacementId = "";
      for (const mv of lines) {
        const isEdited = mv.id === original.id;
        const qtyFor = isEdited ? newQty : mv.quantity;
        const lineNote = isEdited ? changes : `warehouse ${fromWh?.name ?? "?"} → ${toWh.name} (whole invoice moved)`;
        await tx.stockMovement.create({
          data: {
            type: "adjustment",
            productId: mv.productId,
            warehouseId: mv.warehouseId,
            technicianId: mv.technicianId,
            quantity: -mv.quantity,
            unit: mv.unit,
            unitPrice: mv.unitPrice,
            reason: `Correction (reversal): ${lineNote}: ${reason}`,
            reversalOfId: mv.id,
            userId: user.id,
          },
        });
        const rep = await tx.stockMovement.create({
          data: {
            type: mv.type,
            productId: mv.productId,
            warehouseId: targetWarehouseId,
            technicianId: isEdited ? targetTechId : mv.technicianId,
            quantity: qtyFor,
            unit: mv.unit,
            unitPrice: mv.unitPrice,
            sourceInvoiceId: mv.sourceInvoiceId,
            movementDate: mv.movementDate,
            reason: `Corrected (${lineNote}): ${reason}`,
            userId: user.id,
          },
        });
        if (isEdited) replacementId = rep.id;
      }
      if (moveInvoice && original.sourceInvoiceId) {
        await tx.invoice.update({ where: { id: original.sourceInvoiceId }, data: { warehouseId: targetWarehouseId } });
      }
      return replacementId;
    });
    return NextResponse.json({ ok: true, id: created, moved: lines.length });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
