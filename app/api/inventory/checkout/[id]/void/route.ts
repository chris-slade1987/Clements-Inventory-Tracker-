import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";

export const runtime = "nodejs";

const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// POST /api/inventory/checkout/<id>/void   { voidReason? }
// Undo/void a submitted checkout. Within 15 min of submittedAt: the submitter or
// an admin. After 15 min: admin only, and voidReason is required. Each line's
// issue (`check_out`) movement gets an offsetting positive `adjustment` with
// reversalOfId set — nothing is ever hard-deleted.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const voidReason = String(body?.voidReason ?? "").trim();

  const checkout = await prisma.checkout.findUnique({
    where: { id },
    include: { lines: { include: { movement: true } } },
  });
  if (!checkout) return NextResponse.json({ error: "Checkout not found." }, { status: 404 });
  if (checkout.status === "VOIDED") {
    return NextResponse.json({ error: "This checkout is already voided." }, { status: 409 });
  }

  const isAdmin = user.role === "admin";
  // Non-admin managers may only void their own branch's checkouts.
  if (!isAdmin && checkout.warehouseId !== user.warehouseId) {
    return NextResponse.json({ error: "You can only void your own branch's checkouts." }, { status: 403 });
  }

  const submittedAt = checkout.submittedAt ?? checkout.createdAt;
  const withinWindow = Date.now() - submittedAt.getTime() <= UNDO_WINDOW_MS;

  if (withinWindow) {
    // Submitter or admin.
    if (!isAdmin && checkout.issuedByUserId !== user.id) {
      return NextResponse.json({ error: "Only the person who issued this checkout (or an admin) can undo it." }, { status: 403 });
    }
  } else {
    // After the window: admin only, reason required.
    if (!isAdmin) {
      return NextResponse.json({ error: "The 15-minute undo window has passed — ask an admin to void this checkout." }, { status: 403 });
    }
    if (!voidReason) {
      return NextResponse.json({ error: "A reason is required to void after 15 minutes.", needReason: true }, { status: 400 });
    }
  }

  const reason = `Checkout ${checkout.id} voided${voidReason ? ` — ${voidReason}` : ""}`;

  await prisma.$transaction(async (tx) => {
    for (const line of checkout.lines) {
      const mv = line.movement;
      if (!mv) continue; // nothing posted for this line (defensive)
      // Skip if already reversed (defensive — unique reversalOfId).
      const already = await tx.stockMovement.findUnique({ where: { reversalOfId: mv.id } });
      if (already) continue;
      await tx.stockMovement.create({
        data: {
          type: "adjustment",
          productId: mv.productId,
          warehouseId: mv.warehouseId,
          technicianId: mv.technicianId,
          quantity: Math.abs(mv.quantity), // offset the negative issue
          unit: mv.unit,
          userId: user.id,
          reversalOfId: mv.id,
          reason,
        },
      });
    }
    await tx.checkout.update({
      where: { id: checkout.id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedByUserId: user.id,
        voidReason: voidReason || null,
      },
    });
  });

  return NextResponse.json({ ok: true, voided: checkout.id });
}
