import { prisma } from "@/lib/prisma";
import type { Product } from "@prisma/client";
import { parseProductQrPayload } from "@/lib/qr-payload";

export type BarcodeMatch = {
  product: Product;
  identifiedBy: "BARCODE" | "SHELF_QR";
};

/**
 * Canonicalize a scanned barcode to one stable key so the same physical barcode
 * matches even when two scans differ by a leading zero, a check digit, or by
 * UPC-A(12) vs EAN-13(13) vs GTIN-14 encoding.
 *
 *  - All-digits code (ignoring spaces/hyphens): strip non-digits and left-pad
 *    with zeros to GTIN-14, i.e. `digits.length <= 14 ? padStart(14) : digits`.
 *    So "036000291452", "0036000291452" and "00036000291452" all collapse to
 *    "00036000291452".
 *  - Non-numeric code (e.g. an alphanumeric Code-128 or a shelf-QR payload):
 *    trimmed and upper-cased.
 *
 * Returns "" for an empty input.
 */
export function normalizeBarcode(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  // Numeric barcode: digits with only spaces/hyphens as separators (no letters).
  const isNumeric = digits.length > 0 && !/[a-zA-Z]/.test(trimmed);
  if (isNumeric) {
    return digits.length <= 14 ? digits.padStart(14, "0") : digits;
  }
  return trimmed.toUpperCase();
}

// Runtime backfill of ProductBarcode.normalizedCode — the build-time seed doesn't
// reliably reach the LIVE production DB (same reason as lib/mbr-ensure.ts /
// ensureCatalogBaseline: prod only takes runtime writes). Called from the check-out
// scan path (resolveBarcode) so any row linked before this change gets its
// normalized key filled the first time someone scans. Idempotent + non-fatal, with
// a per-instance fast-path once there are no null rows left.
let _normalizeRan = false;

export async function ensureBarcodesNormalized(): Promise<void> {
  if (_normalizeRan) return;
  try {
    const rows = await prisma.productBarcode.findMany({
      where: { normalizedCode: null },
      select: { id: true, code: true },
    });
    for (const r of rows) {
      const normalized = normalizeBarcode(r.code);
      if (!normalized) continue;
      try {
        await prisma.productBarcode.update({ where: { id: r.id }, data: { normalizedCode: normalized } });
      } catch (e) {
        console.error("ensureBarcodesNormalized: failed to fill", r.id, e);
      }
    }
    _normalizeRan = true;
  } catch (e) {
    console.error("ensureBarcodesNormalized failed (non-fatal):", e);
  }
}

/**
 * Resolve a scanned code to a catalog product.
 *
 * Order:
 *  1. `canopy:product:<id>` shelf-QR payload → that product by id (SHELF_QR).
 *  2. A linked `ProductBarcode.code` exact match → its product (BARCODE).
 *  3. A linked `ProductBarcode.normalizedCode` == normalizeBarcode(scanned) →
 *     its product (BARCODE) — the cross-format match.
 *  4. The legacy `Product.barcode` mirror, exact → that product (BARCODE).
 *  5. The legacy `Product.barcode` mirror, normalized-in-app → that product
 *     (BARCODE). The catalog is a few hundred rows, so an in-app normalize is cheap.
 *
 * Returns the first hit, or null when nothing matches (the caller then offers the
 * link flow / new-product request).
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

  // Make sure every linked barcode has its normalized key before the normalized
  // lookup (step 3) runs — fills rows linked before this change, on prod.
  await ensureBarcodesNormalized();

  // 2. Linked ProductBarcode — exact.
  const exact = await prisma.productBarcode.findUnique({
    where: { code },
    include: { product: true },
  });
  if (exact) return { product: exact.product, identifiedBy: "BARCODE" };

  // 3. Linked ProductBarcode — normalized (cross-format).
  const norm = normalizeBarcode(code);
  if (norm) {
    const byNorm = await prisma.productBarcode.findFirst({
      where: { normalizedCode: norm },
      include: { product: true },
    });
    if (byNorm) return { product: byNorm.product, identifiedBy: "BARCODE" };
  }

  // 4. Legacy Product.barcode mirror — exact.
  const legacyExact = await prisma.product.findFirst({ where: { barcode: code } });
  if (legacyExact) return { product: legacyExact, identifiedBy: "BARCODE" };

  // 5. Legacy Product.barcode mirror — normalized (in-app over the catalog).
  if (norm) {
    const withBarcode = await prisma.product.findMany({ where: { barcode: { not: null } } });
    const legacyNorm = withBarcode.find((p) => p.barcode && normalizeBarcode(p.barcode) === norm);
    if (legacyNorm) return { product: legacyNorm, identifiedBy: "BARCODE" };
  }

  return null;
}
