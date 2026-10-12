/**
 * 7/31/2026 on-hand inventory reconciliation — PREVIEW + APPLY.
 *
 * Loads the branch managers' on-hand snapshot (prisma/data/on-hand-2026-07-31.json,
 * parsed from the uploaded "On Hand Inventory 7/2026" workbook) and reconciles
 * every branch's recorded on-hand TO that snapshot, as of 2026-07-31.
 *
 * CORE DATA RULE (AGENTS.md / CLAUDE.md): on-hand for a product at a warehouse =
 * SUM(StockMovement.quantity). On-hand is NEVER mutated directly and movements
 * are NEVER hard-deleted. Reconciliation writes ONE `adjustment` movement per
 * (branch, product) = (target − current), dated 2026-07-31. A zero delta writes
 * nothing. A catalog product that currently holds stock at a branch but is NOT in
 * that branch's snapshot is adjusted to 0 (the "clear out").
 *
 * TWO MODES (this is sensitive production data — review the preview first):
 *   - preview (default): computes and PRINTS the full plan per branch
 *     (product, current → target, delta, created-new?) and totals. Writes nothing.
 *   - apply: performs the adjustments transactionally. GATED so it cannot run by
 *     accident — requires BOTH `--apply` (or argv "apply") AND env
 *     RECONCILE_ONHAND_2026_07_31=1.
 *
 * IDEMPOTENT: apply is guarded by the `onhand_reconcile_2026-07-31` Setting
 * marker (applies EXACTLY ONCE). Additionally, deltas are always recomputed from
 * live on-hand, so the plan naturally collapses to no-ops once applied.
 *
 *   Preview:  DATABASE_URL=... tsx scripts/reconcile-onhand-2026-07-31.ts
 *   Apply:    RECONCILE_ONHAND_2026_07_31=1 DATABASE_URL=... \
 *               tsx scripts/reconcile-onhand-2026-07-31.ts apply
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProductName, PRODUCT_ALIASES } from "../lib/product-aliases";
import { uomCode } from "../lib/uom";

const DATA_PATH = join(process.cwd(), "prisma", "data", "on-hand-2026-07-31.json");
export const MARKER_KEY = "onhand_reconcile_2026-07-31";
const EFFECTIVE_AT = new Date("2026-07-31T17:00:00Z");
const REASON = "7/31/2026 on-hand reconciliation from uploaded workbook";
export const APPLY_ENV = "RECONCILE_ONHAND_2026_07_31";

// Sheet tab -> Warehouse.name in the DB (one warehouse per branch).
const TAB_TO_WAREHOUSE: Record<string, string> = {
  "Vero Beach": "Vero Beach (HQ)",
  Stuart: "Stuart",
  Orlando: "Orlando",
  Naples: "Naples",
};

/**
 * Exact on-hand-workbook name/description variants -> approved catalog name.
 * Keys are normalizeProductName() of the sheet's Product Name (standard rows) or
 * Invoice Description ("Other Product" rows). Values are real Product.name values.
 * This extends the shared PestPac history alias map (lib/product-aliases.ts) for
 * strings that only appear on THIS 7/31 sheet, kept local so the history loader's
 * map is untouched.
 *
 * NOTE — LESCO Crosscheck 0.069% 0-0-7 granular: the 7/27 physical count recorded
 * this exact SKU (invoice description "LESCO Crosscheck 0.069% 0-0-7 AM
 * Insecticide Plus Fertilizer 50 lb.") under the catalog name
 * "0-0-7 Fertilizer + Insecticide" (Vero 24 / Stuart 9 / Orlando 7 / Naples 2).
 * The 7/31 sheet relabels the same SKU "CrossCheck 0.069% plus fertilizer (0-0-7)"
 * and also lists it once more in Orlando as the "Other Product" row
 * "LESCO CROSSCHECK PL Granular insecticide". We map BOTH to the catalog product
 * where the stock already sits ("0-0-7 Fertilizer + Insecticide") so identical
 * counts reconcile to ~zero movements instead of fabricating an offsetting
 * reclassification into the near-duplicate catalog entry "Crosscheck 0.069% Plus".
 * (Those two catalog names are duplicate entries for the same LESCO product; the
 * user may want to de-duplicate the catalog separately.)
 */
const SHEET_ALIASES: Record<string, string> = {
  "crosscheck 0.069% plus fertilizer (0-0-7)": "0-0-7 Fertilizer + Insecticide",
  "lesco crosscheck pl granular insecticide": "0-0-7 Fertilizer + Insecticide",
  "pt pi pressurized contact insecticide 14 oz can": "PT PI Pressurized Contact",
  "lesco 25-0-10 granular fert 50lb bag": "Lesco 25-0-10 Granular Fert",
  "lesco l&o palm 8-0-10 granular 50lb bag": "Fertilizer 8-0-10 (Shrub)",
};

type SheetItem = {
  productName: string;
  invoiceDescription: string;
  quantity: number;
  unit: string | null;
  otherProduct?: boolean;
};
type SheetData = {
  asOf: string;
  source: string;
  branches: Record<string, SheetItem[]>;
};

export type PlannedChange = {
  productId: string | null; // null => a product to be CREATED on apply
  productName: string;
  current: number;
  target: number;
  delta: number;
  isNew: boolean;
  unit: string | null;
  contributors: Array<{ productName: string; quantity: number }>;
};

export type BranchPlan = {
  tab: string;
  warehouse: string;
  found: boolean;
  sheetRows: number;
  matched: number;
  newProducts: string[];
  changes: PlannedChange[]; // only non-zero deltas
  adjustments: number;
  zeroed: number;
  netUnitsDelta: number;
};

export type ReconcileResult = {
  mode: "preview" | "apply";
  applied: boolean;
  reason?: string;
  asOf: string;
  marker: string;
  totals: { adjustments: number; newProducts: number; zeroed: number; netUnitsDelta: number };
  perBranch: Record<string, BranchPlan>;
};

function keyNew(name: string): string {
  return `new::${normalizeProductName(name)}`;
}

/** Build the plan for every branch (read-only). */
async function buildPlan(prisma: PrismaClient): Promise<ReconcileResult> {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8")) as SheetData;

  // Catalog lookup keyed by normalized name; prefer approved on collision.
  const products = await prisma.product.findMany({ select: { id: true, name: true, approved: true } });
  const byNorm = new Map<string, { id: string; name: string; approved: boolean }>();
  for (const p of products) {
    const norm = normalizeProductName(p.name);
    const prev = byNorm.get(norm);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(norm, p);
  }

  const resolve = (it: SheetItem): { id: string; name: string } | null => {
    const normName = normalizeProductName(it.productName);
    let hit = byNorm.get(normName);
    if (hit) return hit;
    const sheetAlias = SHEET_ALIASES[normName];
    if (sheetAlias) {
      hit = byNorm.get(normalizeProductName(sheetAlias));
      if (hit) return hit;
    }
    const histAlias = PRODUCT_ALIASES[normName];
    if (histAlias) {
      hit = byNorm.get(normalizeProductName(histAlias));
      if (hit) return hit;
    }
    // "Other Product" rows carry identity in the invoice description (already
    // copied into productName by the parser); the lookups above cover them.
    return null;
  };

  const perBranch: Record<string, BranchPlan> = {};
  let totAdj = 0;
  let totNew = 0;
  let totZero = 0;
  let totNet = 0;

  for (const [tab, items] of Object.entries(data.branches)) {
    const whName = TAB_TO_WAREHOUSE[tab];
    const plan: BranchPlan = {
      tab,
      warehouse: whName ?? `(unmapped: ${tab})`,
      found: false,
      sheetRows: items.length,
      matched: 0,
      newProducts: [],
      changes: [],
      adjustments: 0,
      zeroed: 0,
      netUnitsDelta: 0,
    };

    const wh = whName ? await prisma.warehouse.findFirst({ where: { name: whName } }) : null;
    if (!wh) {
      perBranch[plan.warehouse] = plan;
      continue;
    }
    plan.found = true;

    // Aggregate targets by resolved product (existing) or synthetic new key.
    type Agg = { productId: string | null; name: string; unit: string | null; target: number; contributors: Array<{ productName: string; quantity: number }>; isNew: boolean };
    const targets = new Map<string, Agg>();
    for (const it of items) {
      const r = resolve(it);
      if (r) {
        plan.matched++;
        const k = r.id;
        const a = targets.get(k) ?? { productId: r.id, name: r.name, unit: null, target: 0, contributors: [], isNew: false };
        a.target += it.quantity;
        a.contributors.push({ productName: it.productName, quantity: it.quantity });
        targets.set(k, a);
      } else {
        const k = keyNew(it.productName);
        const a = targets.get(k) ?? { productId: null, name: it.productName.trim(), unit: uomCode(it.unit) ?? "EA", target: 0, contributors: [], isNew: true };
        a.target += it.quantity;
        a.contributors.push({ productName: it.productName, quantity: it.quantity });
        targets.set(k, a);
      }
    }

    // Current on-hand for every product at this warehouse.
    const currentRows = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { warehouseId: wh.id },
      _sum: { quantity: true },
    });
    const currentByProduct = new Map<string, number>();
    for (const row of currentRows) currentByProduct.set(row.productId, row._sum.quantity ?? 0);

    const targetedProductIds = new Set<string>();

    // 1) Targets from the sheet.
    for (const a of targets.values()) {
      const current = a.productId ? currentByProduct.get(a.productId) ?? 0 : 0;
      if (a.productId) targetedProductIds.add(a.productId);
      const delta = a.target - current;
      if (delta === 0) continue;
      plan.changes.push({
        productId: a.productId,
        productName: a.name,
        current,
        target: a.target,
        delta,
        isNew: a.isNew,
        unit: a.unit,
        contributors: a.contributors.length > 1 ? a.contributors : [],
      });
      if (a.isNew) {
        plan.newProducts.push(a.name);
      }
      if (a.target === 0) plan.zeroed++;
    }

    // 2) Clear out: products currently holding stock but NOT in the sheet.
    for (const [productId, current] of currentByProduct.entries()) {
      if (current === 0 || targetedProductIds.has(productId)) continue;
      const prod = products.find((p) => p.id === productId);
      plan.changes.push({
        productId,
        productName: prod?.name ?? productId,
        current,
        target: 0,
        delta: -current,
        isNew: false,
        unit: null,
        contributors: [],
      });
      plan.zeroed++;
    }

    plan.changes.sort((x, y) => x.productName.localeCompare(y.productName));
    plan.adjustments = plan.changes.length;
    plan.netUnitsDelta = plan.changes.reduce((s, c) => s + c.delta, 0);

    totAdj += plan.adjustments;
    totNew += plan.newProducts.length;
    totZero += plan.zeroed;
    totNet += plan.netUnitsDelta;
    perBranch[plan.warehouse] = plan;
  }

  return {
    mode: "preview",
    applied: false,
    asOf: data.asOf,
    marker: MARKER_KEY,
    totals: { adjustments: totAdj, newProducts: totNew, zeroed: totZero, netUnitsDelta: totNet },
    perBranch,
  };
}

/** Preview (default) or apply the reconciliation. */
export async function reconcileOnHand20260731(
  prisma: PrismaClient,
  opts: { apply: boolean } = { apply: false }
): Promise<ReconcileResult> {
  const result = await buildPlan(prisma);

  if (!opts.apply) {
    result.mode = "preview";
    return result;
  }

  result.mode = "apply";

  // Hard gate: refuse to write unless the env opt-in is set.
  if (process.env[APPLY_ENV] !== "1") {
    result.applied = false;
    result.reason = `apply blocked: set ${APPLY_ENV}=1 to perform writes`;
    return result;
  }

  // Idempotency: apply EXACTLY ONCE.
  const marker = await prisma.setting.findUnique({ where: { key: MARKER_KEY } }).catch(() => null);
  if (marker) {
    result.applied = false;
    result.reason = `already applied at ${marker.value}`;
    return result;
  }

  await prisma.$transaction(
    async (tx) => {
      for (const plan of Object.values(result.perBranch)) {
        if (!plan.found) continue;
        const wh = await tx.warehouse.findFirst({ where: { name: plan.warehouse } });
        if (!wh) continue;
        for (const c of plan.changes) {
          let productId = c.productId;
          if (!productId) {
            const created = await tx.product.create({
              data: {
                name: c.productName,
                unitOfMeasure: c.unit ?? "EA",
                approved: false,
                confirmed: false,
                active: true,
                notes: "Added from 7/31/2026 on-hand reconciliation workbook (not on approved catalog) — confirm catalog naming.",
              },
            });
            productId = created.id;
          }
          if (c.delta === 0) continue;
          await tx.stockMovement.create({
            data: {
              type: "adjustment",
              productId,
              warehouseId: wh.id,
              quantity: c.delta,
              reason: REASON,
              createdAt: EFFECTIVE_AT,
            },
          });
        }
      }
      await tx.setting.upsert({
        where: { key: MARKER_KEY },
        update: { value: new Date().toISOString() },
        create: { key: MARKER_KEY, value: new Date().toISOString() },
      });
    },
    { timeout: 120_000, maxWait: 15_000 }
  );

  result.applied = true;
  return result;
}

function printPlan(r: ReconcileResult): void {
  console.log(`\n=== 7/31/2026 on-hand reconciliation — ${r.mode.toUpperCase()} ===`);
  console.log(`as-of ${r.asOf} | marker ${r.marker}${r.applied ? " | APPLIED" : ""}${r.reason ? ` | ${r.reason}` : ""}`);
  for (const plan of Object.values(r.perBranch)) {
    console.log(`\n-- ${plan.warehouse} ${plan.found ? "" : "(WAREHOUSE NOT FOUND)"}`);
    console.log(`   sheet rows ${plan.sheetRows} | matched ${plan.matched} | adjustments ${plan.adjustments} | zeroed ${plan.zeroed} | net units ${plan.netUnitsDelta >= 0 ? "+" : ""}${plan.netUnitsDelta}`);
    if (plan.newProducts.length) console.log(`   NEW products: ${plan.newProducts.join(", ")}`);
    for (const c of plan.changes) {
      const tag = c.isNew ? " [NEW]" : "";
      const contrib = c.contributors.length ? `  (from: ${c.contributors.map((x) => `${x.productName}=${x.quantity}`).join(" + ")})` : "";
      console.log(`     ${c.productName}${tag}: ${c.current} -> ${c.target} (${c.delta >= 0 ? "+" : ""}${c.delta})${contrib}`);
    }
  }
  console.log(`\nTOTALS: adjustments ${r.totals.adjustments} | new products ${r.totals.newProducts} | zeroed ${r.totals.zeroed} | net units ${r.totals.netUnitsDelta >= 0 ? "+" : ""}${r.totals.netUnitsDelta}`);
}

// Standalone CLI.
if (process.argv[1] && /reconcile-onhand-2026-07-31\.ts$/.test(process.argv[1])) {
  const apply = process.argv.slice(2).some((a) => a === "apply" || a === "--apply");
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await reconcileOnHand20260731(prisma, { apply });
      printPlan(r);
      console.log("\nJSON:\n" + JSON.stringify(r, null, 2));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
