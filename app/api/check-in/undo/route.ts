import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { userCanAccess } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 20;

const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15 minutes — mirrors the check-out undo window

// POST /api/check-in/undo   { invoiceId, reason? }
// Undo a confirmed check-in. Every positive `check_in` movement the invoice
// posted gets an offsetting negative `adjustment` with reversalOfId set, exactly
// like the check-out void — nothing is ever hard-deleted, so on-hand = SUM of
// movements stays correct and the audit trail is preserved. Within 15 min of the
// check-in the uploader or an admin may undo; after that it's admin-only and a
// reason is required.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager" && !(await userCanAccess(user, "check-in")))
    return NextResponse.json({ error: "You don't have access to Check-In." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const invoiceId = String(body?.invoiceId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice." }, { status: 400 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { movements: { where: { type: "check_in" } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (invoice.status === "voided") {
    return NextResponse.json({ error: "This check-in is already undone." }, { status: 409 });
  }

  const isAdmin = user.role === "admin";
  // Non-admin managers may only undo their own branch's check-ins.
  if (!isAdmin && invoice.warehouseId !== user.warehouseId) {
    return NextResponse.json({ error: "You can only undo your own branch's check-ins." }, { status: 403 });
  }

  const withinWindow = Date.now() - invoice.createdAt.getTime() <= UNDO_WINDOW_MS;
  if (withinWindow) {
    if (!isAdmin && invoice.uploadedById !== user.id) {
      return NextResponse.json({ error: "Only the person who checked this in (or an admin) can undo it." }, { status: 403 });
    }
  } else {
    if (!isAdmin) {
      return NextResponse.json({ error: "The 15-minute undo window has passed — ask an admin to undo this check-in." }, { status: 403 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to undo after 15 minutes.", needReason: true }, { status: 400 });
    }
  }

  const noteReason = `Check-in ${invoice.invoiceNumber} undone${reason ? ` — ${reason}` : ""}`;

  let reversed = 0;
  await prisma.$transaction(async (tx) => {
    for (const mv of invoice.movements) {
      // Skip anything already reversed (defensive — unique reversalOfId).
      const already = await tx.stockMovement.findUnique({ where: { reversalOfId: mv.id } });
      if (already) continue;
      await tx.stockMovement.create({
        data: {
          type: "adjustment",
          productId: mv.productId,
          warehouseId: mv.warehouseId,
          quantity: -mv.quantity, // offset the positive receipt
          unit: mv.unit,
          unitPrice: mv.unitPrice,
          userId: user.id,
          reversalOfId: mv.id,
          reason: noteReason,
        },
      });
      reversed++;
    }
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "voided" } });
  });

  return NextResponse.json({ ok: true, invoiceId: invoice.id, reversed });
}
