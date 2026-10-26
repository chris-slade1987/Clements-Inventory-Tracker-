import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { normalizeBarcode } from "@/lib/barcode";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

// POST /api/inventory/barcode/link  { code, productId, symbology? }
// Link a newly-scanned barcode to a catalog product (admin or branch manager).
// Handles P2002 (code already linked) gracefully.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only managers or admins can link barcodes." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim();
  const productId = String(body?.productId ?? "").trim();
  const symbology = body?.symbology == null ? null : String(body.symbology).trim() || null;
  // When the code is already on a DIFFERENT product, reassign=true moves it to
  // this product (the "override" the manager picks from the conflict prompt).
  const reassign = body?.reassign === true;
  if (!code || !productId) {
    return NextResponse.json({ error: "code and productId are required." }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  // Resolve a conflict up front so we can offer / apply a reassignment.
  const existing = await prisma.productBarcode.findUnique({ where: { code }, include: { product: { select: { id: true, name: true } } } });
  if (existing) {
    if (existing.productId === productId) {
      return NextResponse.json({ ok: true, alreadyLinked: true, sameProduct: true, barcode: { id: existing.id, code: existing.code, productId: existing.productId } });
    }
    if (!reassign) {
      return NextResponse.json(
        { ok: false, alreadyLinked: true, sameProduct: false, barcode: { id: existing.id, code: existing.code, productId: existing.productId }, linkedTo: existing.product ? { id: existing.product.id, name: existing.product.name } : null },
        { status: 409 },
      );
    }
    // Override: move the existing barcode row onto this product (keeps check-out
    // history intact — the mapping just points somewhere new from now on).
    const moved = await prisma.productBarcode.update({
      where: { id: existing.id },
      data: { productId, normalizedCode: normalizeBarcode(code) || null, symbology, createdByUserId: user.id },
    });
    return NextResponse.json({ ok: true, reassigned: true, reassignedFrom: existing.product ? { id: existing.product.id, name: existing.product.name } : null, barcode: { id: moved.id, code: moved.code, productId: moved.productId } });
  }

  try {
    const bc = await prisma.productBarcode.create({
      // Store both the raw `code` and its GTIN-14 canonical `normalizedCode` so the
      // same physical barcode resolves at check-out across encodings/leading zeros.
      data: { productId, code, normalizedCode: normalizeBarcode(code) || null, symbology, createdByUserId: user.id },
    });
    return NextResponse.json({ ok: true, barcode: { id: bc.id, code: bc.code, productId: bc.productId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Already linked — return the existing mapping instead of erroring.
      const existing = await prisma.productBarcode.findUnique({ where: { code }, include: { product: { select: { id: true, name: true } } } });
      if (existing) {
        const sameProduct = existing.productId === productId;
        return NextResponse.json(
          {
            ok: sameProduct,
            alreadyLinked: true,
            sameProduct,
            barcode: { id: existing.id, code: existing.code, productId: existing.productId },
            linkedTo: existing.product ? { id: existing.product.id, name: existing.product.name } : null,
          },
          { status: sameProduct ? 200 : 409 },
        );
      }
    }
    return NextResponse.json({ error: "Could not link barcode." }, { status: 500 });
  }
}
