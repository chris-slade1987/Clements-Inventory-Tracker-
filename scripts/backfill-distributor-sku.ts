/**
 * Standalone: backfill Product.distributorSku from SiteOne item numbers
 * (lib/invoice/siteone-aliases.ts SITEONE_ALIASES) where distributorSku is null.
 * Idempotent — only fills nulls; the first matching item # wins.
 *
 *   DATABASE_URL=... tsx scripts/backfill-distributor-sku.ts
 *
 * Also wired (Setting-marker guarded) into scripts/deploy-db.ts.
 */
import { backfillDistributorSku } from "../lib/backfills";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await backfillDistributorSku(prisma);
    console.log(
      `backfill-distributor-sku: ${r.set} set, ${r.skipped} skipped (already set/dup), ${r.unmatched} unmatched of ${r.candidates} aliases.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
