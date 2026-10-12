import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { onHandByWarehouse } from "@/lib/inventory";
import { countedProductIds } from "@/lib/stock-count";
import { saveUpload } from "@/lib/storage";
import { uomCode } from "@/lib/uom";

export const runtime = "nodejs";
export const maxDuration = 20;

const IDENTIFIED_BY = new Set(["BARCODE", "AI_PHOTO", "MANUAL_SEARCH", "SHELF_QR"]);

type LineIn = {
  productId: string;
  quantity: number;
  identifiedBy: string;
  photoUrl?: string | null;
  aiConfidence?: number | null;
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
  const technicianId: string = String(body?.technicianId ?? "");
  const rawLines: LineIn[] = Array.isArray(body?.lines) ? body.lines : [];

  // Branch scoping: a non-admin manager may only check out from their own branch.
  if (user.role !== "admin" && warehouseId && warehouseId !== user.warehouseId) {
    return NextResponse.json({ error: "You can only check out from your own branch." }, { status: 403 });
  }

  const lines = rawLines
    .map((l) => ({
      productId: String(l.productId),
      quantity: Math.trunc(Number(l.quantity)),
      identifiedBy: IDENTIFIED_BY.has(String(l.identifiedBy)) ? String(l.identifiedBy) : "MANUAL_SEARCH",
      photoUrl: l.photoUrl ? String(l.photoUrl) : null,
      aiConfidence: typeof l.aiConfidence === "number" && Number.isFinite(l.aiConfidence) ? l.aiConfidence : null,
    }))
    .filter((l) => l.productId && Number.isFinite(l.quantity) && l.quantity > 0);

  if (!warehouseId) return NextResponse.json({ error: "Select a warehouse." }, { status: 400 });
  if (!technicianId) return NextResponse.json({ error: "Select a technician." }, { status: 400 });
  if (lines.length === 0) return NextResponse.json({ error: "Add at least one product." }, { status: 400 });

  const [warehouse, technician, products] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: warehouseId } }),
    prisma.technician.findUnique({ where: { id: technicianId } }),
    prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } }),
  ]);

  if (!warehouse) return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  if (!technician) return NextResponse.json({ error: "Technician not found." }, { status: 404 });

  const productById = new Map(products.map((p) => [p.id, p]));

  // Unconfirmed-product hard stop (data-quality gate — no override).
  const seenUnc = new Set<string>();
  const unconfirmed = lines
    .map((l) => productById.get(l.productId))
    .filter((p): p is NonNullable<typeof p> => !!p && p.confirmed === false)
    .filter((p) => (seenUnc.has(p.id) ? false : (seenUnc.add(p.id), true)))
    .map((p) => ({ productId: p.id, name: p.name }));
  if (unconfirmed.length > 0) {
    return NextResponse.json({ error: "unconfirmed_product", offending: unconfirmed }, { status: 409 });
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
    return NextResponse.json(
      {
        error: "negative_stock",
        offending: offending.map((l) => ({
          productId: l.productId,
          name: productById.get(l.productId)?.name ?? "Unknown",
          onHand: l.current,
          requested: l.quantity,
          after: l.after,
        })),
      },
      { status: 409 },
    );
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

  const now = new Date();
  const checkout = await prisma.$transaction(async (tx) => {
    const co = await tx.checkout.create({
      data: {
        warehouseId,
        technicianId,
        issuedByUserId: user.id,
        status: "SUBMITTED",
        signatureImageUrl,
        submittedAt: now,
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
        },
      });
    }
    return co;
  });

  return NextResponse.json({
    ok: true,
    receipt: {
      checkoutId: checkout.id,
      warehouse: warehouse.name,
      technician: technician.name,
      manager: user.name,
      at: checkout.submittedAt ?? now,
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
