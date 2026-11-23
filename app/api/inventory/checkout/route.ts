import { NextResponse } from "next/server";
import { resolveRecipientTechnicianId } from "@/lib/checkout-recipient";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { onHandByWarehouse } from "@/lib/inventory";
import { countedProductIds, isCountReason } from "@/lib/stock-count";
import { resolveDisbursedAt } from "@/lib/disbursement-date";
import { saveUpload } from "@/lib/storage";
import { uomCode } from "@/lib/uom";
import { notifyOverDispenseAttempt } from "@/lib/overdispense-alert";

export const runtime = "nodejs";
export const maxDuration = 20;

const IDENTIFIED_BY = new Set(["BARCODE", "AI_PHOTO", "MANUAL_SEARCH", "SHELF_QR"]);

type LineIn = {
  productId: string;
  quantity: number;
  identifiedBy: string;
  photoUrl?: string | null;
  aiConfidence?: number | null;
  aiSuggestedProductId?: string | null;
};

// POST /api/inventory/checkout
// Scan-to-issue submit. Mirrors the guard logic of /api/check-out (unconfirmed
// hard stop + negative-stock hard stop) with one addition: a product that has
// NEVER been counted is exempt from the negative-stock guard (its on-hand can't
// be trusted yet). Creates Checkout(SUBMITTED) + CheckoutLines + one negative
// `check_out` StockMovement per line, tied back via checkoutLineId.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only managers or admins can check out." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const warehouseId: string = String(body?.warehouseId ?? "");
  const pickedId: string = String(body?.technicianId ?? "");
  const rawLines: LineIn[] = Array.isArray(body?.lines) ? body.lines : [];

  // No branch lock (COO 2026-11-13): managers sometimes check out from another
  // branch's warehouse or to a technician/person from another branch (coverage),
  // so any manager or admin may pick any warehouse and any technician. The
  // movement records the warehouse, technician and who did it, so it stays auditable.

  const lines = rawLines
    .map((l) => {
      const identifiedBy = IDENTIFIED_BY.has(String(l.identifiedBy)) ? String(l.identifiedBy) : "MANUAL_SEARCH";
      // The AI's top pick is only meaningful on an AI_PHOTO line — ignore it on
      // barcode / manual / QR lines so an outcome can't be miscredited to the AI.
      const aiSuggestedProductId =
        identifiedBy === "AI_PHOTO" && l.aiSuggestedProductId ? String(l.aiSuggestedProductId) : null;
      return {
        productId: String(l.productId),
        quantity: Math.trunc(Number(l.quantity)),
        identifiedBy,
        photoUrl: l.photoUrl ? String(l.photoUrl) : null,
        aiConfidence: typeof l.aiConfidence === "number" && Number.isFinite(l.aiConfidence) ? l.aiConfidence : null,
        aiSuggestedProductId,
      };
    })
    .filter((l) => l.productId && Number.isFinite(l.quantity) && l.quantity > 0);

  if (!warehouseId) return NextResponse.json({ error: "Select a warehouse." }, { status: 400 });
  if (!pickedId) return NextResponse.json({ error: "Select a technician." }, { status: 400 });
  if (lines.length === 0) return NextResponse.json({ error: "Add at least one product." }, { status: 400 });

  // Date taken (COO 2026-11-23): defaults to today; a manager entering late picks
  // the day the product actually left (up to 30 days back, never the future).
  const disbursed = resolveDisbursedAt(body?.disbursedOn);
  if ("error" in disbursed) return NextResponse.json({ error: disbursed.error }, { status: 400 });

  // The picker also offers anyone active on the org chart who isn't on the
  // technician list yet ("emp:<employeeId>") — turn that into their technician
  // row (reuse / reactivate / create). See lib/checkout-recipient.ts.
  const resolved = await resolveRecipientTechnicianId(pickedId, warehouseId);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const technicianId = resolved.id;

  const [warehouse, technician, products] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: warehouseId } }),
    prisma.technician.findUnique({ where: { id: technicianId } }),
    prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } }),
  ]);

  if (!warehouse) return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  if (!technician) return NextResponse.json({ error: "Technician not found." }, { status: 404 });

  const productById = new Map(products.map((p) => [p.id, p]));

  // "Properly cataloged" hard stop (data-quality gate — NO override for anyone).
  // Nothing may be checked out unless its product is on the approved catalog,
  // human-confirmed, and active. A sample / off-catalog item routes to the
  // super-admin approval request instead (see /api/inventory/product-request).
  // Reasons: "missing" (no such product), "inactive" (retired/merged away),
  // "unapproved" (not on the CEO catalog), "unconfirmed" (details not reviewed).
  const seenUncat = new Set<string>();
  const uncataloged: { productId: string; name: string; reason: string }[] = [];
  for (const l of lines) {
    if (seenUncat.has(l.productId)) continue;
    const p = productById.get(l.productId);
    const reason = !p ? "missing" : !p.active ? "inactive" : !p.approved ? "unapproved" : p.confirmed === false ? "unconfirmed" : null;
    if (reason) {
      seenUncat.add(l.productId);
      uncataloged.push({ productId: l.productId, name: p?.name ?? "Unknown product", reason });
    }
  }
  if (uncataloged.length > 0) {
    return NextResponse.json({ error: "uncataloged_product", offending: uncataloged }, { status: 409 });
  }

  // Negative-stock guard — EXEMPT products that have never been counted (their
  // on-hand isn't trustworthy yet; they get the not-yet-counted cap in the UI).
  const [onHand, counted] = await Promise.all([
    onHandByWarehouse(warehouseId),
    countedProductIds(warehouseId),
  ]);
  const offending = lines
    .filter((l) => counted.has(l.productId)) // never-counted products are exempt
    .map((l) => {
      const current = onHand.get(l.productId) ?? 0;
      return { ...l, current, after: current - l.quantity };
    })
    .filter((l) => l.after < 0);

  if (offending.length > 0) {
    const offenders = offending.map((l) => ({
      productId: l.productId,
      name: productById.get(l.productId)?.name ?? "Unknown",
      onHand: l.current,
      requested: l.quantity,
      after: l.after,
    }));
    // Notify the inventory approvers (Julie + the other super admins) that a
    // manager tried to dispense more than is on hand — a reconciliation prompt to
    // check what's been logged coming IN vs going OUT. Raises a deduped dashboard
    // alert + an Inbox/email thread. Non-fatal; never blocks the hard stop.
    await notifyOverDispenseAttempt({
      warehouseId,
      warehouseName: warehouse.name,
      attemptedByName: user.name,
      offenders,
    }).catch(() => {});
    return NextResponse.json({ error: "negative_stock", offending: offenders }, { status: 409 });
  }

  // Optional signature: accept a base64 PNG and persist it, or a pre-stored URL.
  let signatureImageUrl: string | null = body?.signatureImageUrl ? String(body.signatureImageUrl) : null;
  if (!signatureImageUrl && body?.signatureImage) {
    let data = String(body.signatureImage);
    const comma = data.indexOf(",");
    if (data.startsWith("data:") && comma !== -1) data = data.slice(comma + 1);
    try {
      const url = await saveUpload(Buffer.from(data, "base64"), "signature.png", "image/png", "checkouts");
      if (url) signatureImageUrl = url;
    } catch {
      /* signature is optional — proceed without it */
    }
  }

  // Backdated entry: the checkout + its movements are dated the day taken
  // (createdAt / movementDate — what every report reads), while `submittedAt`
  // stays the real entry time (the 15-minute undo window and the audit trail).
  const now = new Date();
  const takenAt = disbursed.backdated ? disbursed.at : now;
  const checkout = await prisma.$transaction(async (tx) => {
    const co = await tx.checkout.create({
      data: {
        warehouseId,
        technicianId,
        issuedByUserId: user.id,
        status: "SUBMITTED",
        signatureImageUrl,
        submittedAt: now,
        createdAt: takenAt,
      },
    });
    for (const l of lines) {
      const prod = productById.get(l.productId);
      const unit = uomCode(prod?.unitOfMeasure) ?? null;
      const cl = await tx.checkoutLine.create({
        data: {
          checkoutId: co.id,
          productId: l.productId,
          quantity: l.quantity,
          identifiedBy: l.identifiedBy,
          photoUrl: l.photoUrl,
          aiConfidence: l.aiConfidence,
          aiSuggestedProductId: l.aiSuggestedProductId,
        },
      });
      await tx.stockMovement.create({
        data: {
          type: "check_out",
          productId: l.productId,
          warehouseId,
          technicianId,
          quantity: -Math.abs(l.quantity),
          unit,
          userId: user.id,
          checkoutLineId: cl.id,
          ...(disbursed.backdated ? { createdAt: takenAt, movementDate: takenAt } : {}),
        },
      });
    }
    return co;
  });

  // A shelf count recorded for one of these products AFTER the date taken already
  // reflects this product leaving — flag it so the manager can check Reconcile
  // rather than have it come off twice. (Non-blocking.)
  let countedSince: string[] = [];
  if (disbursed.backdated) {
    const later = await prisma.stockMovement.findMany({
      where: { warehouseId, productId: { in: lines.map((l) => l.productId) }, type: "adjustment", createdAt: { gt: takenAt, lte: now } },
      select: { productId: true, reason: true },
    });
    countedSince = [...new Set(later.filter((m) => isCountReason(m.reason)).map((m) => productById.get(m.productId)?.name ?? "Unknown"))];
  }

  return NextResponse.json({
    ok: true,
    receipt: {
      checkoutId: checkout.id,
      warehouse: warehouse.name,
      technician: technician.name,
      manager: user.name,
      at: checkout.submittedAt ?? now,
      takenOn: disbursed.dayKey,
      backdated: disbursed.backdated,
      countedSince,
      signatureImageUrl,
      lines: lines.map((l) => ({
        name: productById.get(l.productId)?.name ?? "Unknown",
        unit: uomCode(productById.get(l.productId)?.unitOfMeasure) ?? "",
        quantity: l.quantity,
        identifiedBy: l.identifiedBy,
      })),
      totalItems: lines.reduce((s, l) => s + l.quantity, 0),
    },
  });
}
