import type { PrismaClient } from "@prisma/client";
import { normalizeProductName } from "@/lib/product-aliases";
import { SITEONE_ALIASES } from "@/lib/invoice/siteone-aliases";

// Idempotent backfills for the scan-to-issue feature. Each is safe to re-run:
// it only fills what is missing and never overwrites existing data. The deploy
// wires these as Setting-marker-guarded runSteps; the standalone scripts in
// scripts/ call them directly so they can be re-run anytime.

export type BarcodeBackfillResult = { scanned: number; created: number; skipped: number };

/**
 * Backfill ProductBarcode from every existing Product.barcode. Skips a barcode
 * that already has a ProductBarcode row. Product.barcode is kept as the legacy
 * mirror (lookups check ProductBarcode first, then Product.barcode).
 */
export async function backfillProductBarcodes(prisma: PrismaClient): Promise<BarcodeBackfillResult> {
  const products = await prisma.product.findMany({
    where: { barcode: { not: null } },
    select: { id: true, barcode: true },
  });
  let created = 0;
  let skipped = 0;
  for (const p of products) {
    const code = (p.barcode ?? "").trim();
    if (!code) continue;
    const exists = await prisma.productBarcode.findUnique({ where: { code } });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.productBarcode.create({ data: { productId: p.id, code } });
    created++;
  }
  return { scanned: products.length, created, skipped };
}

export type SkuBackfillResult = { candidates: number; set: number; skipped: number; unmatched: number };

/**
 * Backfill Product.distributorSku from SiteOne item numbers (SITEONE_ALIASES maps
 * item # → catalog product name). Only fills products whose distributorSku is
 * currently null; the first matching item # wins. This gives the AI identify
 * prompt and the barcode-link search a vendor SKU to show.
 */
export async function backfillDistributorSku(prisma: PrismaClient): Promise<SkuBackfillResult> {
  const products = await prisma.product.findMany({ select: { id: true, name: true, distributorSku: true } });
  const byName = new Map<string, (typeof products)[number]>();
  for (const p of products) byName.set(normalizeProductName(p.name), p);

  let candidates = 0;
  let set = 0;
  let skipped = 0;
  let unmatched = 0;
  // Track products set in this run so two item #s for the same product don't fight.
  const setThisRun = new Set<string>();

  for (const [itemNumber, productName] of Object.entries(SITEONE_ALIASES)) {
    candidates++;
    const product = byName.get(normalizeProductName(productName));
    if (!product) {
      unmatched++;
      continue;
    }
    if (product.distributorSku || setThisRun.has(product.id)) {
      skipped++;
      continue;
    }
    await prisma.product.update({ where: { id: product.id }, data: { distributorSku: itemNumber.trim() } });
    setThisRun.add(product.id);
    set++;
  }
  return { candidates, set, skipped, unmatched };
}
