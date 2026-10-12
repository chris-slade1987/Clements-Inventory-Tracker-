/**
 * Standalone: backfill ProductBarcode from every existing Product.barcode.
 * Idempotent — skips a barcode that already has a ProductBarcode row.
 *
 *   DATABASE_URL=... tsx scripts/backfill-product-barcodes.ts
 *
 * Also wired (Setting-marker guarded) into scripts/deploy-db.ts.
 */
import { backfillProductBarcodes } from "../lib/backfills";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await backfillProductBarcodes(prisma);
    console.log(`backfill-product-barcodes: scanned ${r.scanned}, created ${r.created}, skipped ${r.skipped}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
