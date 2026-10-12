import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { identifyProduct, type CatalogEntry } from "@/lib/inventory-identify";
import { onHandByWarehouse } from "@/lib/inventory";
import { resolveWarehouseId } from "@/lib/inventory-scope";
import { countedProductIds } from "@/lib/stock-count";
import { saveUpload } from "@/lib/storage";
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

  const result = await identifyProduct(image, mime, catalog);

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
