/**
 * Catalog CSV import — PREVIEW + APPLY.
 *
 * Reads the committed SiteOne line-item files (prisma/data/purchase-invoices/*.json,
 * parsed from the owner's SiteOne line-item CSVs) and ADDS/UPDATES one Product per
 * distinct item number. The catalog is already seeded from these files, so this
 * never duplicates: it fills distributorSku / category / UoM on existing products
 * and creates genuinely-new ones as approved=false, confirmed=false.
 *
 * Idempotent — a second apply reports every row as "unchanged" (acceptance test 11).
 *
 *   Preview:  DATABASE_URL=... tsx scripts/import-catalog-csv.ts
 *   Apply:    DATABASE_URL=... tsx scripts/import-catalog-csv.ts apply
 *
 * Also exposed at POST /api/inventory/catalog-import (admin "Import catalog CSV"
 * button on /inventory/catalog) and wired (Setting-marker guarded) into deploy-db.
 */
import { importCatalog } from "../lib/catalog-import";

async function main() {
  const apply = process.argv.includes("apply");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await importCatalog(prisma, { apply });
    console.log(
      `import-catalog-csv (${apply ? "APPLY" : "PREVIEW"}): ${r.distinctItems} distinct items from ${r.files.length} file(s) ` +
        `— ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged; ` +
        `${r.skippedSurcharge} surcharge + ${r.skippedCredit} credit line(s) skipped.`,
    );
    for (const row of r.rows.filter((x) => x.action !== "unchanged")) {
      console.log(`  ${row.action.padEnd(8)} ${row.itemNumber.padEnd(14)} ${row.name}${row.changes ? ` [${row.changes.join(", ")}]` : ""}`);
    }
    if (!apply) console.log("  (preview only — pass `apply` to write)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
