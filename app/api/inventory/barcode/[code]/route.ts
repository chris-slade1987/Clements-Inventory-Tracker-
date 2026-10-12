import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveBarcode } from "@/lib/barcode";
import { onHand } from "@/lib/inventory";
import { resolveWarehouseId } from "@/lib/inventory-scope";
import { countedProductIds } from "@/lib/stock-count";
import { uomCode } from "@/lib/uom";

export const runtime = "nodejs";

// GET /api/inventory/barcode/<code>
// Resolve a scanned barcode (or a `canopy:product:<id>` shelf-QR payload) to a
// catalog product with its on-hand at the caller's branch. 404 when unlinked, so
// the client can offer the "which product is this?" link flow.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode ?? "").trim();
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const url = new URL(_req.url);
  const warehouseId = await resolveWarehouseId(user, url.searchParams.get("branch"));

  const match = await resolveBarcode(code);
  if (!match) {
    return NextResponse.json({ error: "unlinked", code }, { status: 404 });
  }

  const p = match.product;
  const oh = warehouseId ? await onHand(p.id, warehouseId) : 0;
  const counted = warehouseId ? (await countedProductIds(warehouseId)).has(p.id) : false;

  return NextResponse.json({
    ok: true,
    identifiedBy: match.identifiedBy,
    warehouseId,
    product: {
      id: p.id,
      name: p.name,
      unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
      manufacturer: p.manufacturer,
      distributorSku: p.distributorSku,
      category: p.category,
      approved: p.approved,
      confirmed: p.confirmed,
      onHand: oh,
      counted,
    },
  });
}
