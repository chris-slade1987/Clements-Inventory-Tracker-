import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { identifyProduct, REFERENCE_IMAGE_CAP, type CatalogEntry, type ReferenceImage } from "@/lib/inventory-identify";
import { onHandByWarehouse } from "@/lib/inventory";
import { resolveWarehouseId } from "@/lib/inventory-scope";
import { countedProductIds } from "@/lib/stock-count";
import { saveUpload, readUpload } from "@/lib/storage";
import { uomCode } from "@/lib/uom";

export const runtime = "nodejs";
export const maxDuration = 20;

// POST /api/inventory/identify  { image: base64 (JPEG, ~1280px), mime?, warehouseId? }
// Rank the most likely catalog products a photo shows. NEVER auto-submits — the
// manager still confirms the line. Degrades to a "use catalog search" fallback
// with no key / on timeout / on error.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only managers or admins can check out." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  let image = String(body?.image ?? "").trim();
  const mime = String(body?.mime ?? "image/jpeg").trim() || "image/jpeg";
  if (!image) return NextResponse.json({ error: "Missing image." }, { status: 400 });
  // Tolerate a data: URL prefix.
  const comma = image.indexOf(",");
  if (image.startsWith("data:") && comma !== -1) image = image.slice(comma + 1);

  const warehouseId = await resolveWarehouseId(user, body?.warehouseId);

  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ approved: "desc" }, { name: "asc" }],
    select: { id: true, name: true, distributorSku: true, unitOfMeasure: true },
  });
  const catalog: CatalogEntry[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    distributorSku: p.distributorSku,
    unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
  }));

  // Reference photos: compare the submitted shelf photo against stored reference
  // photos of catalog products (the Part 2 accuracy win). Bounded by
  // REFERENCE_IMAGE_CAP; primary photos first. Degrades to text-only matching when
  // no product has a photo yet or storage can't return the bytes.
  const activeIds = new Set(products.map((p) => p.id));
  const references: ReferenceImage[] = [];
  try {
    const photoRows = await prisma.productPhoto.findMany({
      where: { status: "assigned", productId: { not: null } },
      orderBy: [{ primary: "desc" }, { assignedAt: "desc" }],
      take: REFERENCE_IMAGE_CAP * 2,
      select: { productId: true, kind: true, photoUrl: true },
    });
    const seenProducts = new Set<string>();
    for (const row of photoRows) {
      if (references.length >= REFERENCE_IMAGE_CAP) break;
      if (!row.productId || !activeIds.has(row.productId) || seenProducts.has(row.productId)) continue;
      const bytes = await readUpload(row.photoUrl);
      if (!bytes) continue;
      seenProducts.add(row.productId);
      references.push({ productId: row.productId, kind: row.kind, base64: bytes.toString("base64"), mime: "image/jpeg" });
    }
  } catch {
    /* references are an enhancement only — never block identify */
  }

  const result = await identifyProduct(image, mime, catalog, references);

  // Non-secret signal so we can tell when the photo path couldn't actually "see"
  // the image (no vision key / timeout / error) vs a genuine no-match. Never logs
  // the key or any image bytes — only the status + timing.
  if (!result.ai) {
    console.warn(`[inventory/identify] vision unavailable: status=${result.status} latencyMs=${result.latencyMs} (ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? "set" : "absent"})`);
  }

  // Persist the photo (best-effort) so the chosen line can carry a thumbnail into
  // history. Never blocks identification.
  let photoUrl: string | null = null;
  try {
    photoUrl = await saveUpload(Buffer.from(image, "base64"), "identify.jpg", mime, "checkouts");
  } catch {
    /* optional */
  }

  // Enrich candidates with on-hand + counted so the client can render the card
  // and cap the quantity without a second round-trip.
  const onHand = warehouseId ? await onHandByWarehouse(warehouseId) : new Map<string, number>();
  const counted = warehouseId ? await countedProductIds(warehouseId) : new Set<string>();
  const byId = new Map(products.map((p) => [p.id, p]));
  const candidates = result.candidates.map((c) => {
    const p = byId.get(c.productId)!;
    return {
      ...c,
      name: p.name,
      unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
      distributorSku: p.distributorSku,
      onHand: onHand.get(c.productId) ?? 0,
      counted: counted.has(c.productId),
    };
  });

  return NextResponse.json({
    ai: result.ai,
    status: result.status,
    latencyMs: result.latencyMs,
    labelText: result.labelText,
    preselectProductId: result.preselectProductId,
    message: result.message,
    warehouseId,
    photoUrl,
    candidates,
  });
}
