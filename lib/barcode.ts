import { prisma } from "@/lib/prisma";
import type { Product } from "@prisma/client";
import { parseProductQrPayload } from "@/lib/qr-payload";

export type BarcodeMatch = {
  product: Product;
  identifiedBy: "BARCODE" | "SHELF_QR";
};

/**
 * Resolve a scanned code to a catalog product.
 *
 * Order:
 *  1. `canopy:product:<id>` shelf-QR payload → that product by id (SHELF_QR).
 *  2. A linked `ProductBarcode.code` → its product (BARCODE).
 *  3. The legacy `Product.barcode` mirror → that product (BARCODE).
 *
 * Returns null when nothing matches (the caller then offers the link flow).
 */
export async function resolveBarcode(rawCode: string): Promise<BarcodeMatch | null> {
  const code = (rawCode ?? "").trim();
  if (!code) return null;

  // 1. Shelf QR label.
  const qrProductId = parseProductQrPayload(code);
  if (qrProductId) {
    const product = await prisma.product.findUnique({ where: { id: qrProductId } });
    return product ? { product, identifiedBy: "SHELF_QR" } : null;
  }

  // 2. Linked ProductBarcode.
  const linked = await prisma.productBarcode.findUnique({
    where: { code },
    include: { product: true },
  });
  if (linked) return { product: linked.product, identifiedBy: "BARCODE" };

  // 3. Legacy Product.barcode mirror.
  const legacy = await prisma.product.findFirst({ where: { barcode: code } });
  if (legacy) return { product: legacy, identifiedBy: "BARCODE" };

  return null;
}
