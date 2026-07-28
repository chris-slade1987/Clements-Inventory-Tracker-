import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProductName, PRODUCT_ALIASES } from "../lib/product-aliases";

/**
 * Backfill VERIFIED EPA registration numbers and official SDS (MSDS) links onto
 * catalog products.
 *
 * The data lives in two hand-curated, auditable JSON files (verified from EPA
 * PPLS or the manufacturer's own label/SDS — blanks are simply omitted):
 *   - prisma/data/epa-reg-numbers.json  { "<catalog product name>": "<EPA Reg No>" }
 *   - prisma/data/product-sds.json      { "<catalog product name>": "<SDS pdf URL>" }
 *
 * Resolution mirrors the history loader's contract: normalizeProductName() the
 * JSON key, match a Product whose normalized name equals it; if none, fall back
 * to PRODUCT_ALIASES (in case the JSON key is a history/alias name).
 *
 * Discipline (non-negotiable):
 *   - Only fields with a non-empty value in the JSON are ever written.
 *   - A value is written ONLY when the product's current value is empty OR
 *     differs from the verified value. We NEVER write a blank over an existing
 *     value, and we never delete.
 *   - Idempotent: a second run makes no changes.
 *
 * Local dev.db may hold only a subset of the 94 products — unmatched keys are
 * counted and skipped without error.
 */

type EpaMap = Record<string, string>;
type SdsMap = Record<string, string>;

function loadJson<T>(name: string): T {
  const file = join(__dirname, "data", name);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export async function seedEpaNumbers(prisma: PrismaClient) {
  const epa = loadJson<EpaMap>("epa-reg-numbers.json");
  const sds = loadJson<SdsMap>("product-sds.json");

  // Index every product by its normalized name (the stable catalog key).
  const products = await prisma.product.findMany({
    select: { id: true, name: true, epaRegNumber: true, sdsUrl: true },
  });
  const byNorm = new Map(products.map((p) => [normalizeProductName(p.name), p]));

  // Resolve a JSON key -> a product row. Try the key directly, then the alias
  // map (whose VALUE is a real catalog product name), then that value directly.
  const resolve = (key: string) => {
    const direct = byNorm.get(normalizeProductName(key));
    if (direct) return direct;
    const aliased = PRODUCT_ALIASES[normalizeProductName(key)];
    if (aliased) return byNorm.get(normalizeProductName(aliased)) ?? null;
    return null;
  };

  let epaSet = 0;
  let epaUnmatched = 0;
  let sdsSet = 0;
  let sdsUnmatched = 0;

  // EPA registration numbers.
  for (const [name, reg] of Object.entries(epa)) {
    const value = (reg ?? "").trim();
    if (!value) continue; // never write a blank
    const p = resolve(name);
    if (!p) {
      epaUnmatched++;
      continue;
    }
    if ((p.epaRegNumber ?? "") !== value) {
      await prisma.product.update({ where: { id: p.id }, data: { epaRegNumber: value } });
      epaSet++;
    }
  }

  // Official SDS links.
  for (const [name, url] of Object.entries(sds)) {
    const value = (url ?? "").trim();
    if (!value) continue; // never write a blank
    const p = resolve(name);
    if (!p) {
      sdsUnmatched++;
      continue;
    }
    if ((p.sdsUrl ?? "") !== value) {
      await prisma.product.update({ where: { id: p.id }, data: { sdsUrl: value } });
      sdsSet++;
    }
  }

  return {
    epaTotal: Object.keys(epa).length,
    epaSet,
    epaUnmatched,
    sdsTotal: Object.keys(sds).length,
    sdsSet,
    sdsUnmatched,
  };
}

// Allow running directly against local dev.db: `tsx prisma/seed-epa-numbers.ts`
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await seedEpaNumbers(prisma);
    console.log(
      `epa-numbers seed: EPA ${r.epaSet} set / ${r.epaUnmatched} unmatched (of ${r.epaTotal}); ` +
        `SDS ${r.sdsSet} set / ${r.sdsUnmatched} unmatched (of ${r.sdsTotal}).`
    );
    const withEpa = await prisma.product.count({ where: { NOT: { epaRegNumber: null } } });
    const withSds = await prisma.product.count({ where: { NOT: { sdsUrl: null } } });
    console.log(`catalog now: ${withEpa} products with an EPA Reg No, ${withSds} with an SDS link.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /seed-epa-numbers\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
