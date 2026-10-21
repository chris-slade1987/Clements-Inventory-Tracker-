import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { identifyProduct, type CatalogEntry } from "@/lib/inventory-identify";
import { uomCode } from "@/lib/uom";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };

// Photo Catalog (Phase 6) — HUMAN-IN-THE-LOOP label/barcode photo capture.
//  - identify:  save the submitted photo (unassigned) + ask the AI to PROPOSE a
//               match. Never assigns — a person decides.
//  - assign:    attach a photo to a product (becomes that product's primary label
//               photo). Used for both first-assign and re-assign (correction).
//  - discard:   mark "not a product" / bad shot (keeps the row, detaches it).
//  - delete:    remove the photo entirely (true delete — photos aren't audit records).
//  - setPrimary: pick which of a product's photos is the canonical one.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only managers or admins can manage product photos." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const action = s(body?.action);

  try {
    if (action === "identify") {
      let image = String(body?.image ?? "").trim();
      const mime = String(body?.mime ?? "image/jpeg").trim() || "image/jpeg";
      if (!image) return NextResponse.json({ error: "Missing image." }, { status: 400 });
      const comma = image.indexOf(",");
      if (image.startsWith("data:") && comma !== -1) image = image.slice(comma + 1);

      // Persist the photo FIRST (the human already chose to submit it). Fail loudly
      // if storage rejects it — we never want a dangling suggestion with no image.
      const photoUrl = await saveUpload(Buffer.from(image, "base64"), "product-label.jpg", mime, "product-photos").catch(() => null);
      if (!photoUrl) {
        return NextResponse.json({ error: "The photo could not be stored. Document storage isn't configured — try again." }, { status: 503 });
      }

      const products = await prisma.product.findMany({
        where: { active: true },
        orderBy: [{ approved: "desc" }, { name: "asc" }],
        select: { id: true, name: true, distributorSku: true, unitOfMeasure: true },
      });
      const catalog: CatalogEntry[] = products.map((p) => ({
        id: p.id, name: p.name, distributorSku: p.distributorSku, unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
      }));
      const result = await identifyProduct(image, mime, catalog);
      const top = result.candidates[0] ?? null;
      const byId = new Map(products.map((p) => [p.id, p]));

      const photo = await prisma.productPhoto.create({
        data: {
          photoUrl, status: "unassigned", kind: s(body?.kind) ?? "label",
          aiSuggestedProductId: top?.productId ?? null, aiConfidence: top?.confidence ?? null,
          labelText: result.labelText,
          capturedByUserId: user.id, capturedByName: user.name,
          warehouseId: s(body?.warehouseId), branch: user.branch ?? null,
        },
      });

      return NextResponse.json({
        ok: true,
        photoId: photo.id,
        photoUrl,
        labelText: result.labelText,
        ai: result.ai,
        message: result.message,
        candidates: result.candidates.map((c) => ({
          productId: c.productId,
          name: byId.get(c.productId)?.name ?? "",
          confidence: c.confidence,
          reason: c.reason,
        })),
      });
    }

    if (action === "assign") {
      const photoId = s(body?.photoId);
      const productId = s(body?.productId);
      if (!photoId || !productId) return NextResponse.json({ error: "Pick a product." }, { status: 400 });
      const [photo, product] = await Promise.all([
        prisma.productPhoto.findUnique({ where: { id: photoId } }),
        prisma.product.findUnique({ where: { id: productId } }),
      ]);
      if (!photo) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
      if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

      // This photo becomes the product's primary label photo; demote any previous
      // primary for that product so there's exactly one canonical shot.
      await prisma.$transaction([
        prisma.productPhoto.updateMany({ where: { productId, primary: true, NOT: { id: photoId } }, data: { primary: false } }),
        prisma.productPhoto.update({
          where: { id: photoId },
          data: { productId, status: "assigned", primary: true, assignedByUserId: user.id, assignedByName: user.name, assignedAt: new Date() },
        }),
      ]);
      return NextResponse.json({ ok: true });
    }

    if (action === "setPrimary") {
      const photoId = s(body?.photoId);
      if (!photoId) return NextResponse.json({ error: "Missing photo." }, { status: 400 });
      const photo = await prisma.productPhoto.findUnique({ where: { id: photoId } });
      if (!photo || !photo.productId) return NextResponse.json({ error: "Assign the photo to a product first." }, { status: 400 });
      await prisma.$transaction([
        prisma.productPhoto.updateMany({ where: { productId: photo.productId, primary: true, NOT: { id: photoId } }, data: { primary: false } }),
        prisma.productPhoto.update({ where: { id: photoId }, data: { primary: true } }),
      ]);
      return NextResponse.json({ ok: true });
    }

    if (action === "discard") {
      const photoId = s(body?.photoId);
      if (!photoId) return NextResponse.json({ error: "Missing photo." }, { status: 400 });
      await prisma.productPhoto.update({
        where: { id: photoId },
        data: { status: "discarded", productId: null, primary: false },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const photoId = s(body?.photoId);
      if (!photoId) return NextResponse.json({ error: "Missing photo." }, { status: 400 });
      const photo = await prisma.productPhoto.findUnique({ where: { id: photoId } });
      if (photo?.photoUrl) await deleteUpload(photo.photoUrl).catch(() => {});
      await prisma.productPhoto.delete({ where: { id: photoId } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
