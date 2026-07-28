import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProductName } from "../lib/product-aliases";

/**
 * Load the CEO's REAL physical on-hand counts (as of 2026-07-27) for all four
 * branches and reconcile recorded on-hand to match them.
 *
 * Core data rule (AGENTS.md / CLAUDE.md): on-hand for a product at a warehouse =
 * SUM(StockMovement.quantity). On-hand is NEVER mutated directly and movements
 * are NEVER hard-deleted. A physical count is reconciled by writing ONE
 * `adjustment` movement per product = (counted − current_on_hand); a zero delta
 * writes nothing.
 *
 * IDEMPOTENT — a physical count must apply EXACTLY ONCE, ever. A Setting marker
 * (`onhand_count_2026-07-27`) guards the whole run: once set, re-running is a
 * no-op that creates zero movements, so it can never clobber live check-in /
 * check-out activity posted after the count.
 *
 * Source data: prisma/data/inventory-counts/2026-07-27.json —
 *   { "<TabName>": { "<Product Name>": <qty>, ... }, ... }
 * A blank cell in the sheet is 0 (the branch holds none). Product names are
 * matched to the approved catalog with the SAME normalizer the catalog uses
 * (normalizeProductName). Unmatched names are reported, never auto-created.
 */

const COUNT_SETTING_KEY = "onhand_count_2026-07-27";
// Effective timestamp of the physical count (the movements are dated to it).
const COUNT_AT = new Date("2026-07-27T17:00:00Z");
const COUNT_REASON = "Physical count 07/27/2026";

// Sheet tab -> Warehouse.name in the DB.
const TAB_TO_WAREHOUSE: Record<string, string> = {
  "Vero Beach": "Vero Beach (HQ)",
  Stuart: "Stuart",
  Orlando: "Orlando",
  Naples: "Naples",
};

type CountData = Record<string, Record<string, number>>;

export type PerWarehouseResult = {
  warehouse: string;
  found: boolean;
  matched: number;
  adjustmentsCreated: number;
  productsZeroed: number;
  unmatched: string[];
};

export type OnHandCountResult = {
  applied: boolean;
  reason?: string;
  adjustmentsCreated: number;
  productsZeroed: number;
  unmatched: string[];
  perWarehouse: Record<string, PerWarehouseResult>;
};

function readCountData(): CountData {
  const path = join(process.cwd(), "prisma", "data", "inventory-counts", "2026-07-27.json");
  return JSON.parse(readFileSync(path, "utf8")) as CountData;
}

export async function seedOnHandCount(prisma: PrismaClient): Promise<OnHandCountResult> {
  // --- Idempotency guard: apply EXACTLY ONCE ---
  const marker = await prisma.setting.findUnique({ where: { key: COUNT_SETTING_KEY } }).catch(() => null);
  if (marker) {
    return { applied: false, reason: "already applied", adjustmentsCreated: 0, productsZeroed: 0, unmatched: [], perWarehouse: {} };
  }

  const data = readCountData();

  // Product lookup keyed by normalized name; prefer approved on collision.
  const products = await prisma.product.findMany({ select: { id: true, name: true, approved: true } });
  const byNorm = new Map<string, { id: string; name: string; approved: boolean }>();
  for (const p of products) {
    const norm = normalizeProductName(p.name);
    const prev = byNorm.get(norm);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(norm, p);
  }

  let adjustmentsCreated = 0;
  let productsZeroed = 0;
  const unmatchedAll = new Set<string>();
  const perWarehouse: Record<string, PerWarehouseResult> = {};

  for (const [tab, counts] of Object.entries(data)) {
    const whName = TAB_TO_WAREHOUSE[tab];
    if (!whName) {
      console.warn(`seed-onhand-count: no warehouse mapping for tab "${tab}" — skipping.`);
      continue;
    }
    const wh = await prisma.warehouse.findFirst({ where: { name: whName } });
    if (!wh) {
      console.warn(`seed-onhand-count: warehouse "${whName}" not found — skipping tab "${tab}".`);
      perWarehouse[whName] = { warehouse: whName, found: false, matched: 0, adjustmentsCreated: 0, productsZeroed: 0, unmatched: [] };
      continue;
    }

    let whMatched = 0;
    let whAdjustments = 0;
    let whZeroed = 0;
    const whUnmatched: string[] = [];

    for (const [name, rawQty] of Object.entries(counts)) {
      const prod = byNorm.get(normalizeProductName(name));
      if (!prod) {
        unmatchedAll.add(name);
        whUnmatched.push(name);
        continue;
      }
      whMatched++;
      const counted = Number(rawQty) || 0;

      // current on-hand = SUM(quantity) of this product's movements at this branch.
      const agg = await prisma.stockMovement.aggregate({
        _sum: { quantity: true },
        where: { productId: prod.id, warehouseId: wh.id },
      });
      const current = agg._sum.quantity ?? 0;
      const delta = counted - current;
      if (delta === 0) continue; // already correct — no movement.

      try {
        await prisma.stockMovement.create({
          data: {
            type: "adjustment",
            productId: prod.id,
            warehouseId: wh.id,
            quantity: delta,
            reason: COUNT_REASON,
            createdAt: COUNT_AT,
          },
        });
        whAdjustments++;
        if (counted === 0) whZeroed++;
      } catch (e) {
        // Keep resilient — one bad row must not abort the whole load.
        console.error(`seed-onhand-count: failed to adjust "${prod.name}" @ ${whName}:`, e);
      }
    }

    adjustmentsCreated += whAdjustments;
    productsZeroed += whZeroed;
    perWarehouse[whName] = {
      warehouse: whName,
      found: true,
      matched: whMatched,
      adjustmentsCreated: whAdjustments,
      productsZeroed: whZeroed,
      unmatched: whUnmatched,
    };
  }

  // Mark the count as applied so it can never run twice.
  await prisma.setting.upsert({
    where: { key: COUNT_SETTING_KEY },
    update: { value: new Date().toISOString() },
    create: { key: COUNT_SETTING_KEY, value: new Date().toISOString() },
  });

  return { applied: true, adjustmentsCreated, productsZeroed, unmatched: [...unmatchedAll], perWarehouse };
}

// Standalone run: `tsx prisma/seed-onhand-count.ts`
if (process.argv[1] && /seed-onhand-count\.ts$/.test(process.argv[1])) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedOnHandCount(prisma);
      console.log("seed-onhand-count:", JSON.stringify(r, null, 2));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
