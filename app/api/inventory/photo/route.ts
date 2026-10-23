import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver, isSuperAdmin } from "@/lib/auth";
import { saveUpload, deleteUpload, readUpload } from "@/lib/storage";
import { identifyProduct, classifyPhoto, PHOTO_KINDS, type CatalogEntry, type PhotoKind } from "@/lib/inventory-identify";
import { uomCode } from "@/lib/uom";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };

// Max reference photos a single product may carry (Part 2).
const MAX_PHOTOS_PER_PRODUCT = 3;

// Strip a data: URL prefix and return raw base64, or "" if empty.
function rawBase64(v: unknown): string {
  let image = String(v ?? "").trim();
  if (!image) return "";
  const comma = image.indexOf(",");
  if (image.startsWith("data:") && comma !== -1) image = image.slice(comma + 1);
  return image;
}

function normKind(v: unknown): PhotoKind | null {
  const k = s(v)?.toLowerCase() ?? "";
  return (PHOTO_KINDS as readonly string[]).includes(k) ? (k as PhotoKind) : null;
}

// Photo Catalog (Phase 6) + product Edit-window photos (Part 2).
//  - identify:  save the submitted photo (unassigned) + ask the AI to PROPOSE a
//               match. Never assigns — a person decides. (managers + admins)
//  - add:       SUPER ADMIN. Save an uploaded image, AI-classify its kind, and
//               attach it to a product (status assigned). Enforces max 3/product.
//  - replace:   SUPER ADMIN. Delete one photo and add a new one in its place.
//  - setKind:   SUPER ADMIN. Manual kind override (Product/Label/Barcode).
//  - assign:    SUPER ADMIN. Attach a photo to a product (first-assign / re-assign).
//  - discard:   SUPER ADMIN. Mark "not a product" / bad shot (detaches it).
//  - delete:    SUPER ADMIN. Remove the photo entirely (a true delete).
//  - setPrimary: SUPER ADMIN. Pick which of a product's photos is canonical.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });
  // Capture (identify) stays open to managers/admins; every catalog-edit action
  // below is additionally gated to super admins.
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only managers or admins can manage product photos." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const action = s(body?.action);

  // Catalog-edit actions are super-admin-only (Chris, Julie, April).
  const EDIT_ACTIONS = new Set(["add", "replace", "setKind", "assign", "discard", "delete", "setPrimary", "promoteScan", "dismissScan"]);
  if (action && EDIT_ACTIONS.has(action) && !isSuperAdmin(user)) {
    return NextResponse.json({ error: "Only a super admin can manage catalog photos." }, { status: 403 });
  }

  try {
    if (action === "identify") {
      const image = rawBase64(body?.image);
      const mime = String(body?.mime ?? "image/jpeg").trim() || "image/jpeg";
      if (!image) return NextResponse.json({ error: "Missing image." }, { status: 400 });

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

    // Add a reference photo straight onto a product from the Edit window.
    if (action === "add") {
      const productId = s(body?.productId);
      const image = rawBase64(body?.image);
      const mime = String(body?.mime ?? "image/jpeg").trim() || "image/jpeg";
      if (!productId) return NextResponse.json({ error: "Missing product." }, { status: 400 });
      if (!image) return NextResponse.json({ error: "Missing image." }, { status: 400 });
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

      const existing = await prisma.productPhoto.count({ where: { productId, status: "assigned" } });
      if (existing >= MAX_PHOTOS_PER_PRODUCT) {
        return NextResponse.json({ error: `A product can have at most ${MAX_PHOTOS_PER_PRODUCT} photos. Delete one first.` }, { status: 409 });
      }

      const photoUrl = await saveUpload(Buffer.from(image, "base64"), "product-photo.jpg", mime, "product-photos").catch(() => null);
      if (!photoUrl) {
        return NextResponse.json({ error: "The photo could not be stored. Document storage isn't configured — try again." }, { status: 503 });
      }

      // AI auto-classifies the kind; an explicit manual kind wins. Degrades to
      // "other" when AI is unavailable so the uploader can pick it afterward.
      const manualKind = normKind(body?.kind);
      const classified = manualKind ? { kind: manualKind, labelText: null as string | null, ai: false } : await classifyPhoto(image, mime);

      const photo = await prisma.productPhoto.create({
        data: {
          productId,
          photoUrl,
          status: "assigned",
          kind: classified.kind,
          primary: existing === 0, // first photo becomes the canonical one
          labelText: classified.labelText,
          capturedByUserId: user.id, capturedByName: user.name,
          assignedByUserId: user.id, assignedByName: user.name, assignedAt: new Date(),
          branch: user.branch ?? null,
        },
      });
      return NextResponse.json({ ok: true, photoId: photo.id, photoUrl, kind: classified.kind, ai: classified.ai });
    }

    // Replace = delete one photo + add a new one (keeps the ≤3 cap honest).
    if (action === "replace") {
      const photoId = s(body?.photoId);
      const image = rawBase64(body?.image);
      const mime = String(body?.mime ?? "image/jpeg").trim() || "image/jpeg";
      if (!photoId) return NextResponse.json({ error: "Missing photo." }, { status: 400 });
      if (!image) return NextResponse.json({ error: "Missing image." }, { status: 400 });
      const old = await prisma.productPhoto.findUnique({ where: { id: photoId } });
      if (!old || !old.productId) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
      const productId = old.productId;
      const wasPrimary = old.primary;

      const photoUrl = await saveUpload(Buffer.from(image, "base64"), "product-photo.jpg", mime, "product-photos").catch(() => null);
      if (!photoUrl) {
        return NextResponse.json({ error: "The photo could not be stored. Try again." }, { status: 503 });
      }
      const manualKind = normKind(body?.kind);
      const classified = manualKind ? { kind: manualKind, labelText: null as string | null } : await classifyPhoto(image, mime);

      if (old.photoUrl) await deleteUpload(old.photoUrl).catch(() => {});
      const photo = await prisma.$transaction(async (tx) => {
        await tx.productPhoto.delete({ where: { id: photoId } });
        return tx.productPhoto.create({
          data: {
            productId, photoUrl, status: "assigned", kind: classified.kind,
            primary: wasPrimary, labelText: classified.labelText,
            capturedByUserId: user.id, capturedByName: user.name,
            assignedByUserId: user.id, assignedByName: user.name, assignedAt: new Date(),
            branch: user.branch ?? null,
          },
        });
      });
      return NextResponse.json({ ok: true, photoId: photo.id, photoUrl, kind: classified.kind });
    }

    // Manual kind override (Product / Label / Barcode / Other).
    if (action === "setKind") {
      const photoId = s(body?.photoId);
      const kind = normKind(body?.kind);
      if (!photoId || !kind) return NextResponse.json({ error: "Pick a kind." }, { status: 400 });
      await prisma.productPhoto.update({ where: { id: photoId }, data: { kind } });
      return NextResponse.json({ ok: true });
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

      // Enforce the per-product cap on (re)assign too.
      const existing = await prisma.productPhoto.count({ where: { productId, status: "assigned", NOT: { id: photoId } } });
      if (existing >= MAX_PHOTOS_PER_PRODUCT) {
        return NextResponse.json({ error: `A product can have at most ${MAX_PHOTOS_PER_PRODUCT} photos. Delete one first.` }, { status: 409 });
      }

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

    // Scan Intelligence (Part 3): promote a good confirmed check-out scan into a
    // curated reference ProductPhoto so /api/inventory/identify compares against
    // it next time. Reuses the SAME storage + classify + cap + primary rules as
    // "add", but sources the image bytes from the stored scan (no re-upload from
    // the client). SUPER-ADMIN only (gated above).
    if (action === "promoteScan") {
      const lineId = s(body?.lineId);
      if (!lineId) return NextResponse.json({ error: "Missing scan." }, { status: 400 });
      const line = await prisma.checkoutLine.findUnique({
        where: { id: lineId },
        select: { id: true, productId: true, photoUrl: true, refPhotoReviewedAt: true, product: { select: { id: true } } },
      });
      if (!line) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
      if (!line.photoUrl) return NextResponse.json({ error: "This scan has no stored photo." }, { status: 400 });
      if (!line.product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
      const productId = line.productId;

      const existing = await prisma.productPhoto.count({ where: { productId, status: "assigned" } });
      if (existing >= MAX_PHOTOS_PER_PRODUCT) {
        return NextResponse.json({ error: `A product can have at most ${MAX_PHOTOS_PER_PRODUCT} photos. Delete one first.` }, { status: 409 });
      }

      // Read the stored scan bytes and re-save into the product-photos space so
      // the reference photo owns its own object (no dangling ref if the checkout
      // is later voided/cleaned up).
      const bytes = await readUpload(line.photoUrl);
      if (!bytes) {
        return NextResponse.json({ error: "The scan image could not be read. It may have been removed." }, { status: 410 });
      }
      const photoUrl = await saveUpload(bytes, "reference-photo.jpg", "image/jpeg", "product-photos").catch(() => null);
      if (!photoUrl) {
        return NextResponse.json({ error: "The photo could not be stored. Try again." }, { status: 503 });
      }

      // AI auto-classifies the kind; degrades to "other" when AI is unavailable.
      const classified = await classifyPhoto(bytes.toString("base64"), "image/jpeg");

      const photo = await prisma.$transaction(async (tx) => {
        const created = await tx.productPhoto.create({
          data: {
            productId,
            photoUrl,
            status: "assigned",
            kind: classified.kind,
            primary: existing === 0, // the first reference photo becomes canonical
            labelText: classified.labelText,
            capturedByUserId: user.id, capturedByName: user.name,
            assignedByUserId: user.id, assignedByName: user.name, assignedAt: new Date(),
            branch: user.branch ?? null,
          },
        });
        // Mark this scan reviewed so it leaves the promotion queue.
        await tx.checkoutLine.update({ where: { id: lineId }, data: { refPhotoReviewedAt: new Date() } });
        return created;
      });
      return NextResponse.json({ ok: true, photoId: photo.id, photoUrl, kind: classified.kind, ai: classified.ai });
    }

    // Scan Intelligence: hide a scan from the promotion queue without promoting it.
    if (action === "dismissScan") {
      const lineId = s(body?.lineId);
      if (!lineId) return NextResponse.json({ error: "Missing scan." }, { status: 400 });
      const line = await prisma.checkoutLine.findUnique({ where: { id: lineId }, select: { id: true } });
      if (!line) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
      await prisma.checkoutLine.update({ where: { id: lineId }, data: { refPhotoReviewedAt: new Date() } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
