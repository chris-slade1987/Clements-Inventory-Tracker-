import type { PrismaClient } from "@prisma/client";
import { categorizeProduct } from "../lib/constants";
import { isUomCode } from "../lib/uom";
import { normalizeProductName } from "../lib/product-aliases";

/**
 * Reconcile the CEO's approved product catalog into the database.
 *
 * - Upserts the 75 approved products (from the PestPac product list) by a stable
 *   key: the NORMALIZED product name (see normalizeProductName). Each gets its
 *   approved unit-of-measure CODE (from lib/uom.ts) and approved = true.
 * - Adds products that appear in transfer history but weren't on the sheet
 *   (flagged via `notes` so HR/admin can confirm naming).
 * - Demotes every other product to approved = false — still usable, just flagged
 *   as off-catalog — so the invariant "approved === on the CEO's list" holds.
 *
 * Idempotent: safe to run on every deploy. Never hard-deletes and never touches
 * stock movements.
 *
 * The stable upsert key (normalized name) is what the later purchase-history
 * loader must resolve to (via lib/product-aliases.ts) — do not change it without
 * updating that build.
 */

type ApprovedRow = {
  name: string;
  code: string; // canonical UoM code (lib/uom.ts)
  material: string; // PestPac Material Code (kept for the history loader)
  target: string | null;
  appMethod: string | null;
};

// The 75 approved products, from the PestPac "Product list" sheet. `name` is the
// sheet's Product Name (a few reconciled so the alias map resolves exactly);
// `code` is the sheet's approved Unit Of Measure.
const APPROVED: ApprovedRow[] = [
  { name: "Lutz Perfect Spike", code: "T", material: "LUTZ PERFECT SPIKE", target: null, appMethod: null },
  { name: "Acephate 90 Prill", code: "J", material: "ACEPHATE 90 PRILL", target: "SHRUBS", appMethod: "SPRAYER" },
  { name: "Advion Ant Gel", code: "T", material: "ADVION ANT GEL", target: "ANTS", appMethod: "HAND" },
  { name: "Advion cockroach gel bait", code: "T", material: "ADVION COCKROACH GEL BAIT", target: "ROACHES", appMethod: "HAND" },
  { name: "Advion Insect Granular", code: "FB", material: "ADVION GRANULAR", target: "MILLIPEDE", appMethod: "SPREADER" },
  { name: "Advion WDG Insecticide", code: "OZ", material: "ADVION WDG", target: "ROACHES", appMethod: "SPRAYER" },
  { name: "Alpine Roach Gel Bait", code: "T", material: "ALPINE ROACH GEL BAIT", target: "ROACHES", appMethod: "HAND" },
  { name: "OTC Fungicide", code: "B", material: "OTC FUNGICIDE", target: null, appMethod: null },
  { name: "Archer IGR", code: "B", material: "ARCHER IGR", target: "ROACHES", appMethod: "SPRAYER" },
  { name: "Avenue South", code: "J", material: "AVENUE SOUTH", target: "BROADLEAF", appMethod: "SPRAYER" },
  { name: "bifen XTS", code: "J", material: "BIFEN XTS", target: "LAWN & SHURBS", appMethod: "SPRAYER" },
  { name: "CB-80 Insecticide", code: "AC", material: "CB-80 INSECTICIDE", target: "INSECTS", appMethod: "SPRAYER" },
  { name: "Celsius", code: "B", material: "CELSIUS", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Certainty", code: "B", material: "CERTAINTY", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Contrac Rodent Bait Blox", code: "BU", material: "CONTRAC RODENT BAIT BLOX", target: "RODENTS", appMethod: "HAND" },
  { name: "Cyper TC", code: "J", material: "CYPER TC", target: "PRE-TREATS", appMethod: "SPRAYER" },
  { name: "Delta dust", code: "B", material: "DELTA DUST", target: "INSECTS", appMethod: "SPRAYER" },
  { name: "Demand CS", code: "B", material: "DEMAND CS", target: "GHP", appMethod: "SPRAYER" },
  { name: "DIPEL PRO", code: "FB", material: "DIPEL PRO", target: "SHRUBS", appMethod: "SPRAYER" },
  { name: "Extinguish", code: "FB", material: "EXTINGUISH", target: "ANTS", appMethod: "SPREADER" },
  { name: "Gentrol IGR Concentrate", code: "B", material: "GENTROL IGR CONCENTRATE", target: "ROACHES", appMethod: "SPRAYER" },
  { name: "Invade Hot Spot", code: "AC", material: "INVADE HOT SPOT", target: "CLEANER", appMethod: "HAND" },
  { name: "19-19-19 Sprayable fertilizer", code: "FB", material: "FERTILIZER 19-19-19", target: "FERT", appMethod: "SPRAYER" },
  { name: "20-0-0 Liquid Fertilizer", code: "J", material: "LIQUID FERTILIZER 20-0-0", target: "FERT", appMethod: null },
  { name: "Fertilizer 24-0-11 (Turf)", code: "FB", material: "FERTILIZER - 24-0-11", target: "FERT", appMethod: "SPREADER" },
  { name: "33-0-17 Sprayable Fertilizer", code: "FB", material: "FERTILIZER  - 33-0-17", target: "FERT", appMethod: "SPRAYER" },
  { name: "Wasp & Hornet Spray", code: "AC", material: "WASP & HORNET SPRAY", target: "WASP", appMethod: "HAND" },
  { name: "Atrazine", code: "J", material: "ATRAZINE", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Bandit 2F", code: "J", material: "BANDIT 2F", target: "L-SHRUB", appMethod: "SPRAYER" },
  { name: "Lesco Bio Iron Plus", code: "J", material: "LESCO BIO IRON PLUS", target: "FERT", appMethod: "SPRAYER" },
  { name: "0-0-7 Fertilizer + Insecticide", code: "FB", material: "FERTILIZER + INSECT - 0-0-7", target: "ANTS / ROACH", appMethod: "SPREADER" },
  { name: "Crosscheck 0.069% Plus", code: "FB", material: "CROSSCHECK 0.069% PLUS", target: "ANTS / ROACHES", appMethod: "SPREADER" },
  { name: "CrossCheck Plus", code: "J", material: "CROSSCHECK PLUS", target: "GHP", appMethod: "SPRAYER" },
  { name: "Lesco 10-0-12", code: "FB", material: "LESCO 10-0-12", target: "FERT", appMethod: "SPREADER" },
  { name: "Lesco Fertilizer 13-0-0", code: "J", material: "LESCO FERTILIZER 13-0-0", target: "FERT", appMethod: "SPRAYER" },
  { name: "Fertilizer - 21-0-6", code: "FB", material: "FERTILIZER - 21-0-6", target: "FERT", appMethod: "SPREADER" },
  { name: "Fertilizer 8-0-10 (Shrub)", code: "FB", material: "FERTILIZER - 8-0-10", target: "FERT", appMethod: "HAND" },
  { name: "Lesco Liquid 0-0-25", code: "J", material: "LESCO LIQUID 0-0-25", target: "FERT", appMethod: null },
  { name: "20-20-20 Sprayable Fertilizer", code: "FB", material: "FERTILIZER 20-20-20", target: "FERT", appMethod: "SPRAYER" },
  { name: "Mansion Turf Herbicide", code: "B", material: "MANSION", target: "BROADLEAF", appMethod: "SPRAYER" },
  { name: "Blackout Fertilizer 0-0-18 (turf)", code: "FB", material: "FERTILIZER - 0-0-18", target: "FERT", appMethod: "SPREADER" },
  { name: "Prosecutor", code: "J", material: "PROSECUTOR", target: null, appMethod: null },
  { name: "Spreader Sticker", code: "J", material: "SPREADER STICKER", target: "LAWN & SHRUBS", appMethod: "SPRAYER" },
  { name: "Lesco T&O Chelated Liquid Fertilizer", code: "J", material: "LESCO T&O CHELATED LIQUID FERT", target: "FERT", appMethod: null },
  { name: "T-Storm Fungicide", code: "J", material: "T-STORM", target: "FUNGUS", appMethod: "SPRAYER" },
  { name: "Maxforce Complete Granular Bait", code: "FB", material: "MAXFORCE COMPLETE GRANULAR", target: null, appMethod: null },
  { name: "Maxforce Quantum Ant Bait", code: "T", material: "MAXFORCE QUANTUM ANT BAIT", target: "ANTS", appMethod: "HAND" },
  { name: "Arena Granular Insecticide", code: "FB", material: "ARENA", target: "CHINCH BUGS", appMethod: "SPREADER" },
  { name: "Optigard Ant Gel Bait", code: "T", material: "OPTIGARD ANT GEL BAIT", target: "ANTS", appMethod: "HAND" },
  { name: "Optigard Cockroach Gel Bait", code: "T", material: "OPTIGARD COCKROACH GEL BAIT", target: null, appMethod: null },
  { name: "Speedzone Southern Herbicide", code: "J", material: "SPEEDZONE SOUTHERN HERBICIDE", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Premise Foam", code: "AC", material: "PREMISE FOAM", target: null, appMethod: null },
  { name: "Evo Bait Station", code: "BS", material: "BAIT STATIONS", target: "RODENTS", appMethod: null },
  { name: "PT Alpine", code: "AC", material: "PT ALPINE", target: null, appMethod: null },
  { name: "PT ALPINE WSG", code: "B", material: "PT ALPINE WSG (BOTTLE)", target: null, appMethod: null },
  { name: "PT Microcare CS", code: "AC", material: "PT  MICROCARE CS", target: null, appMethod: "SPRAYER" },
  { name: "PT Phantom", code: "AC", material: "PT PHANTOM", target: null, appMethod: null },
  { name: "PT Ultraside", code: "AC", material: "PT ULTRASIDE", target: "Flea", appMethod: null },
  { name: "PT wasp Freeze", code: "AC", material: "PT WASP FREEZE", target: null, appMethod: null },
  { name: "Safari SG", code: "J", material: "SAFARI SG", target: null, appMethod: null },
  { name: "Sector", code: "J", material: "SECTOR", target: null, appMethod: null },
  { name: "Sedgehammer Turf Herbicide", code: "B", material: "SEDGEHAMMER", target: "NUTSEDGE", appMethod: "SPRAYER" },
  { name: "Shockwave", code: "J", material: "SHOCKWAVE", target: "INSECTS", appMethod: "FOGGER" },
  { name: "Suspend SC", code: "J", material: "SUSPEND SC", target: "ANTS / ROACHES", appMethod: "SPRAYER" },
  { name: "Headway Fungicide", code: "FB", material: "HEADWAY", target: "FUNGUS", appMethod: "SPREADER" },
  { name: "Taurus SC", code: "B", material: "TAURUS SC", target: "ANTS", appMethod: "SPRAYER" },
  { name: "Termidor Foam", code: "AC", material: "TERMIDOR FOAM", target: "TERMITES", appMethod: "HAND" },
  { name: "Termidor SC", code: "J", material: "TERMIDOR SC", target: "TERMITES", appMethod: "SPRAYER" },
  { name: "Timbor", code: "BU", material: "TIMBOR", target: "TERMITES", appMethod: "SPRAYER" },
  { name: "Top Choice", code: "FB", material: "TOP CHOICE", target: "FIRE ANTS", appMethod: "HAND" },
  { name: "Transport Mikron Insecticide", code: "B", material: "TRANSPORT MIKRON", target: "ANTS / ROACHES", appMethod: "SPRAYER" },
  { name: "T-Rex Snap Trap", code: "RT", material: "T-REX SNAP TRAP", target: "RATS", appMethod: "HAND" },
  { name: "ULD BP-300", code: "J", material: "ULD BP-300", target: "ROACHES", appMethod: "SPRYAER" },
  { name: "Vendetta Plus", code: "T", material: "VENDETTA PLUS", target: "ROACHES", appMethod: "HAND" },
  { name: "Extinguish Plus", code: "FB", material: "EXTINGUISH PLUS", target: "ANTS", appMethod: "SPREADER" },
];

// Products seen in the transfer history but NOT on the approved sheet. Added as
// approved (units taken from the history) and flagged via `notes` so HR/admin
// can confirm the naming before the history-load build.
const ADD_NOTE = "Added from transfer history — confirm naming with HR/admin.";
const ADDED: ApprovedRow[] = [
  { name: "Artavia 2SC Fungicide", code: "J", material: "ARTAVIA 2SC", target: "FUNGUS", appMethod: "SPRAYER" },
  { name: "Lesco 25-0-10 Granular Fert", code: "FB", material: "LESCO 25-0-10", target: "FERT", appMethod: "SPREADER" },
  { name: "Suspend PolyZone Insecticide", code: "J", material: "SUSPEND POLYZONE", target: "GHP", appMethod: "SPRAYER" },
  { name: "Syngenta Heritage Granular Fungicide", code: "FB", material: "HERITAGE GRANULAR", target: "FUNGUS", appMethod: "SPREADER" },
  { name: "Victor M9 Pro Rat Trap", code: "EA", material: "VICTOR M9 PRO", target: "RATS", appMethod: "HAND" },
  { name: "Miscellaneous Chemical", code: "J", material: "MISC CHEMICAL", target: null, appMethod: null },
  { name: "Miscellaneous Fertilizer", code: "FB", material: "MISC FERTILIZER", target: null, appMethod: null },
];

export async function seedApprovedProducts(prisma: PrismaClient) {
  const all = [...APPROVED, ...ADDED.map((a) => ({ ...a, note: ADD_NOTE }))] as (ApprovedRow & { note?: string })[];

  // Existing products, indexed by normalized name (the stable upsert key).
  const existing = await prisma.product.findMany();
  const byNorm = new Map(existing.map((p) => [normalizeProductName(p.name), p]));
  const approvedNorms = new Set<string>();

  let created = 0;
  let updated = 0;
  for (const row of all) {
    const norm = normalizeProductName(row.name);
    approvedNorms.add(norm);
    const code = isUomCode(row.code) ? row.code.toUpperCase() : "EA";
    const category = categorizeProduct(row.name, "", row.target ?? "", code);
    const found = byNorm.get(norm);

    if (found) {
      await prisma.product.update({
        where: { id: found.id },
        data: {
          unitOfMeasure: code,
          approved: true,
          active: true,
          category: found.category ?? category,
          targetPest: found.targetPest ?? row.target ?? null,
          applicationMethod: found.applicationMethod ?? row.appMethod ?? null,
          // Keep an existing distributor SKU; otherwise stamp the PestPac code.
          distributorSku: found.distributorSku ?? row.material,
          ...(row.note ? { notes: row.note } : {}),
        },
      });
      updated++;
    } else {
      await prisma.product.create({
        data: {
          name: row.name,
          unitOfMeasure: code,
          approved: true,
          category,
          targetPest: row.target ?? null,
          applicationMethod: row.appMethod ?? null,
          distributorSku: row.material,
          notes: row.note ?? null,
        },
      });
      created++;
    }
  }

  // Everything not on the approved list is off-catalog: still usable, flagged.
  const offList = existing.filter((p) => !approvedNorms.has(normalizeProductName(p.name)));
  let demoted = 0;
  for (const p of offList) {
    if (p.approved) {
      await prisma.product.update({ where: { id: p.id }, data: { approved: false } });
      demoted++;
    }
  }

  return { created, updated, demoted, approvedTotal: all.length };
}

// Allow running directly against local dev.db: `tsx prisma/seed-products-approved.ts`
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await seedApprovedProducts(prisma);
    console.log(`approved-products seed: ${r.created} created, ${r.updated} updated, ${r.demoted} demoted to off-catalog.`);
    const approvedCount = await prisma.product.count({ where: { approved: true } });
    console.log(`approved products in catalog: ${approvedCount}`);
    const checks = ["Advion Ant Gel", "bifen XTS", "Contrac Rodent Bait Blox", "Artavia 2SC Fungicide", "Victor M9 Pro Rat Trap"];
    for (const name of checks) {
      const p = await prisma.product.findFirst({ where: { name }, select: { name: true, unitOfMeasure: true, approved: true } });
      console.log(`  ${name} -> ${p ? `${p.unitOfMeasure} (approved=${p.approved})` : "MISSING"}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when invoked as a script, not when imported by deploy-db.
if (process.argv[1] && /seed-products-approved\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
