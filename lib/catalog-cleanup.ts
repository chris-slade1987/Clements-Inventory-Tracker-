import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeProductName, PRODUCT_ALIASES } from "@/lib/product-aliases";
import { SITEONE_ALIASES } from "@/lib/invoice/siteone-aliases";
import { canonicalProductName, CATALOG_ITEM_NUMBERS, CATALOG_MERGES, CATALOG_UNIT_OVERRIDES, DISCONTINUED_PRODUCTS, PREVIOUS_FULL_NAMES } from "@/lib/catalog-names";
import { ensureReceiptsLoaded } from "@/lib/receipts-ensure";
import { packSizeFor, approvedCatalogShortNames, isHumanApproved, NON_CHEMICAL_PRODUCT_NAME } from "@/prisma/seed-products-approved";

// One-time approved-catalog cleanup (COO directive 2026-11-10). Undoes the 11/5
// "clear the review queues" change, which approved EVERY active product (demo seed
// rows like CimeXa Dust, a test row "Chemical X", sample imports like CoRoN, and the
// SiteOne-named twins of catalog products) instead of leaving them off the catalog.
//
//   1. MERGE duplicates into their catalog product — a row whose name is the
//      catalog product's short or full name, a PestPac alias of it, or carries one
//      of its SiteOne item numbers. Same mechanics as Product Review → Merge:
//      purchase lines, stock movements, barcodes, checkout lines and photos are
//      re-pointed (nothing deleted; on-hand consolidates onto one row), the twin is
//      deactivated.
//   2. RENAME each catalog product to its full description (lib/catalog-names.ts).
//   3. Everything else that is active and approved comes OFF the catalog — unless a
//      super admin approved it in-app (product request / Product Review → Approve):
//        - no stock at any branch → deactivated (filed as rejected, archived so it
//          doesn't refill the Rejected tab; Restore still works);
//        - stock somewhere → stays active but un-approved, so it lands in Product
//          Review → Off-catalog for an Approve / Merge / Discard decision.
//
// Never writes or deletes a stock movement's quantity — on-hand per product family
// is unchanged. Runs once (Setting marker), writes a report the Product Review page
// shows, non-fatal.

export const CATALOG_CLEANUP_REVISION = "2026-11-10";
const REV_KEY = "catalog_cleanup_rev";
export const CATALOG_CLEANUP_REPORT_KEY = "catalog_cleanup_report";
const DISCARD_MARK = "Discarded from confirm queue"; // = app/api/products/confirm + seed
const REJECTED_ARCHIVED_MARK = "Rejected backlog acknowledged"; // = lib/catalog-review.ts

type Stock = { warehouse: string; qty: number };
export type CatalogCleanupReport = {
  at: string;
  revision: string;
  renamed: { from: string; to: string }[];
  merged: { from: string; into: string; stock: Stock[] }[];
  deactivated: string[];
  offCatalogWithStock: { name: string; stock: Stock[] }[];
  keptApprovedInApp: string[];
  missingCatalogRows: string[];
};

let _run: Promise<void> | null = null;

export function ensureCatalogCleanup(): Promise<void> {
  if (!_run) _run = run().catch((e) => { console.error("ensureCatalogCleanup failed (non-fatal, will retry):", e); _run = null; });
  return _run;
}

async function run(): Promise<void> {
  const marker = await prisma.setting.findUnique({ where: { key: REV_KEY } });
  if (marker?.value !== CATALOG_CLEANUP_REVISION) {
    if (!(await runCleanup())) { _run = null; return; } // catalog not loaded yet — retry later
  }
  await runDecisions();
}

async function runCleanup(): Promise<boolean> {
  const report = await cleanupCatalog();
  if (!report) return false;
  const value = JSON.stringify(report);
  await prisma.setting.upsert({ where: { key: CATALOG_CLEANUP_REPORT_KEY }, update: { value }, create: { key: CATALOG_CLEANUP_REPORT_KEY, value } });
  await prisma.setting.upsert({ where: { key: REV_KEY }, update: { value: CATALOG_CLEANUP_REVISION }, create: { key: REV_KEY, value: CATALOG_CLEANUP_REVISION } });
  console.log(
    `ensureCatalogCleanup: ${report.renamed.length} renamed, ${report.merged.length} merged, ${report.deactivated.length} deactivated, ` +
      `${report.offCatalogWithStock.length} left off-catalog with stock, ${report.keptApprovedInApp.length} kept (approved in-app).`,
  );
  return true;
}

export async function readCatalogCleanupReport(): Promise<CatalogCleanupReport | null> {
  const row = await prisma.setting.findUnique({ where: { key: CATALOG_CLEANUP_REPORT_KEY } }).catch(() => null);
  if (!row) return null;
  try { return JSON.parse(row.value) as CatalogCleanupReport; } catch { return null; }
}

const EPS = 1e-6;
const splitCodes = (s: string | null | undefined) => (s ?? "").split(/[\s,;/|]+/).map((x) => x.trim()).filter(Boolean);

/** The cleanup itself (exported for the dev test script). Returns null when the
 *  approved catalog isn't loaded yet. */
export async function cleanupCatalog(): Promise<CatalogCleanupReport | null> {
  const [products, sums, warehouses, requests] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, name: true, active: true, approved: true, notes: true, distributorSku: true, vendorItemNumbers: true, barcode: true },
    }),
    prisma.stockMovement.groupBy({ by: ["productId", "warehouseId"], _sum: { quantity: true } }),
    prisma.warehouse.findMany({ select: { id: true, name: true } }),
    prisma.productRequest.findMany({ where: { productId: { not: null } }, select: { productId: true, status: true } }),
  ]);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const stockOf = (productId: string): Stock[] =>
    sums
      .filter((s) => s.productId === productId && Math.abs(s._sum.quantity ?? 0) > EPS)
      .map((s) => ({ warehouse: whName.get(s.warehouseId) ?? s.warehouseId, qty: Math.round((s._sum.quantity ?? 0) * 10000) / 10000 }));
  const requestApproved = new Set(requests.filter((r) => r.status === "approved").map((r) => r.productId!));
  const requestPending = new Set(requests.filter((r) => r.status === "pending").map((r) => r.productId!));

  const report: CatalogCleanupReport = {
    at: new Date().toISOString(), revision: CATALOG_CLEANUP_REVISION,
    renamed: [], merged: [], deactivated: [], offCatalogWithStock: [], keptApprovedInApp: [], missingCatalogRows: [],
  };

  // --- Catalog rows: short name -> full name, and every key that identifies it.
  const shorts = approvedCatalogShortNames();
  const keyToShort = new Map<string, string>(); // normalized short/full name -> short
  for (const s of shorts) {
    keyToShort.set(normalizeProductName(s), s);
    keyToShort.set(normalizeProductName(canonicalProductName(s)), s);
  }
  const itemToShort = new Map<string, string>(); // SiteOne item # -> short
  for (const [s, codes] of Object.entries(CATALOG_ITEM_NUMBERS)) for (const c of codes) itemToShort.set(c.toUpperCase(), s);
  for (const [code, name] of Object.entries(SITEONE_ALIASES)) {
    const s = keyToShort.get(normalizeProductName(name));
    if (s && !itemToShort.has(code.toUpperCase())) itemToShort.set(code.toUpperCase(), s);
  }

  const active = products.filter((p) => p.active);
  if (!active.some((p) => keyToShort.has(normalizeProductName(p.name)))) return null;

  // --- 1. The keeper row for each catalog product: the original short-named row
  // (it holds the 10/30 baseline + receipts) when present, else the full-named row.
  const keeper = new Map<string, (typeof products)[number]>(); // short -> product
  for (const s of shorts) {
    const nShort = normalizeProductName(s);
    const nFull = normalizeProductName(canonicalProductName(s));
    const cands = active.filter((p) => { const n = normalizeProductName(p.name); return n === nShort || n === nFull; });
    const pick = cands.find((p) => normalizeProductName(p.name) === nShort && p.approved)
      ?? cands.find((p) => normalizeProductName(p.name) === nShort)
      ?? cands.find((p) => p.approved) ?? cands[0];
    if (pick) keeper.set(s, pick);
    else report.missingCatalogRows.push(s);
  }
  const keeperIds = new Set([...keeper.values()].map((p) => p.id));

  // --- 2. Duplicates -> merge into their keeper.
  const catalogShortFor = (p: (typeof products)[number]): string | null => {
    const n = normalizeProductName(p.name);
    const direct = keyToShort.get(n);
    if (direct) return direct;
    const aliased = PRODUCT_ALIASES[n];
    if (aliased) { const s = keyToShort.get(normalizeProductName(aliased)); if (s) return s; }
    for (const c of [...splitCodes(p.distributorSku), ...splitCodes(p.vendorItemNumbers)]) {
      const s = itemToShort.get(c.toUpperCase());
      if (s) return s;
    }
    return null;
  };
  const mergedIds = new Set<string>();
  for (const p of active) {
    if (keeperIds.has(p.id) || p.name === NON_CHEMICAL_PRODUCT_NAME) continue;
    const s = catalogShortFor(p);
    const k = s ? keeper.get(s) : undefined;
    if (!k) continue;
    const fullName = canonicalProductName(s!);
    const stock = stockOf(p.id);
    await mergeProductInto(p, k, fullName, `by the catalog cleanup ${CATALOG_CLEANUP_REVISION}`);
    mergedIds.add(p.id);
    report.merged.push({ from: p.name, into: fullName, stock });
  }

  // --- 3. Rename every catalog product to its full description (and make sure it
  // is on the catalog).
  for (const [s, k] of keeper) {
    const fullName = canonicalProductName(s);
    if (k.name !== fullName || !k.approved) {
      await prisma.product.update({ where: { id: k.id }, data: { name: fullName, approved: true, active: true } });
      if (k.name !== fullName) report.renamed.push({ from: k.name, to: fullName });
    }
  }

  // --- 4. Everything else comes off the catalog.
  for (const p of active) {
    if (keeperIds.has(p.id) || mergedIds.has(p.id) || p.name === NON_CHEMICAL_PRODUCT_NAME) continue;
    if (isHumanApproved(p.notes) || requestApproved.has(p.id)) {
      if (p.approved) report.keptApprovedInApp.push(p.name);
      continue;
    }
    const stock = stockOf(p.id);
    if (stock.length > 0 || requestPending.has(p.id)) {
      if (p.approved) await prisma.product.update({ where: { id: p.id }, data: { approved: false, confirmed: true } });
      if (stock.length > 0) report.offCatalogWithStock.push({ name: p.name, stock });
      continue;
    }
    await prisma.product.update({
      where: { id: p.id },
      data: {
        active: false, approved: false, confirmed: true,
        notes: [p.notes, `${DISCARD_MARK} by the catalog cleanup on ${CATALOG_CLEANUP_REVISION} (not on the approved catalog, no stock). ${REJECTED_ARCHIVED_MARK}.`]
          .filter(Boolean).join(" "),
      },
    });
    report.deactivated.push(p.name);
  }

  const by = (f: (x: never) => string) => (x: unknown, y: unknown) => f(x as never).localeCompare(f(y as never));
  report.renamed.sort(by((r: { from: string }) => r.from));
  report.merged.sort(by((r: { from: string }) => r.from));
  report.offCatalogWithStock.sort(by((r: { name: string }) => r.name));
  report.deactivated.sort();
  report.keptApprovedInApp.sort();
  return report;
}

type MergeRow = { id: string; name: string; notes: string | null; barcode: string | null };

/** Merge one product row into another (same mechanics as Product Review → Merge):
 *  re-point purchase lines, stock movements, barcodes, checkout lines and photos;
 *  deactivate the twin and rename it "… (merged)" so it never collides in a lookup.
 *  No movement quantity is written or deleted. */
async function mergeProductInto(p: MergeRow, k: MergeRow, fullName: string, by: string): Promise<void> {
  const moveBarcode = !!p.barcode && !k.barcode;
  await prisma.$transaction([
    prisma.invoiceLine.updateMany({ where: { productId: p.id }, data: { productId: k.id } }),
    prisma.stockMovement.updateMany({ where: { productId: p.id }, data: { productId: k.id } }),
    prisma.productBarcode.updateMany({ where: { productId: p.id }, data: { productId: k.id } }),
    prisma.checkoutLine.updateMany({ where: { productId: p.id }, data: { productId: k.id } }),
    prisma.productPhoto.updateMany({ where: { productId: p.id }, data: { productId: k.id, primary: false } }),
    prisma.product.update({
      where: { id: p.id },
      data: {
        active: false, approved: false, confirmed: true,
        name: `${p.name} (merged)`,
        ...(moveBarcode ? { barcode: null } : {}),
        notes: [p.notes, `Merged into "${fullName}" (${k.id}) ${by}.`].filter(Boolean).join(" "),
      },
    }),
    ...(moveBarcode ? [prisma.product.update({ where: { id: k.id }, data: { barcode: p.barcode } })] : []),
  ]);
  if (moveBarcode) k.barcode = p.barcode;
}

// ───────────────────────────────────────────────────────────────────────────
// Julie's catalog decisions (2026-11-11), applied once after the 11/10 cleanup:
//   - the 20 drafted full names confirmed (lib/catalog-names.ts), incl. a corrected
//     20-20-20 name, plus unit fixes (Atrazine = 50 lb bag, Suspend PolyZone =
//     bottle, 20-20-20 = pail/bucket);
//   - two catalog rows merged into the product they duplicate (Crosscheck 0.069%
//     Plus → LESCO Crosscheck 0-0-7; Lesco Macron → 20-20-20);
//   - the PestPac "Miscellaneous Chemical" / "Miscellaneous Fertilizer" categories
//     discontinued: any on-hand is zeroed by an offsetting adjustment (audit trail
//     kept) and the products are deactivated.
export const CATALOG_DECISIONS_REVISION = "2026-11-13";
const DECISIONS_REV_KEY = "catalog_decisions_rev";
export const CATALOG_DECISIONS_REPORT_KEY = "catalog_decisions_report";

export type CatalogDecisionsReport = {
  at: string;
  renamed: { from: string; to: string }[];
  unitsChanged: { name: string; from: string; to: string }[];
  merged: { from: string; into: string; stock: Stock[] }[];
  discontinued: { name: string; removed: Stock[] }[];
  /** Products whose auto-filled case size was cleared (never assume a case). */
  caseSizesCleared?: number;
};

async function runDecisions(): Promise<void> {
  const marker = await prisma.setting.findUnique({ where: { key: DECISIONS_REV_KEY } });
  if (marker?.value === CATALOG_DECISIONS_REVISION) return;
  // Receipt-line removals (the Orlando Misc line) must land BEFORE the discontinued
  // zeroing, or the two would double-count the removal.
  await ensureReceiptsLoaded();
  const report = await applyCatalogDecisions();
  // Keep earlier rounds of decisions on the record: append this round to the last.
  const prev = await readCatalogDecisionsReport();
  if (prev) {
    report.renamed = [...prev.renamed, ...report.renamed];
    report.unitsChanged = [...prev.unitsChanged, ...report.unitsChanged];
    report.merged = [...prev.merged, ...report.merged];
    report.discontinued = [...prev.discontinued, ...report.discontinued];
    report.caseSizesCleared = (prev.caseSizesCleared ?? 0) + (report.caseSizesCleared ?? 0);
  }
  const value = JSON.stringify(report);
  await prisma.setting.upsert({ where: { key: CATALOG_DECISIONS_REPORT_KEY }, update: { value }, create: { key: CATALOG_DECISIONS_REPORT_KEY, value } });
  await prisma.setting.upsert({ where: { key: DECISIONS_REV_KEY }, update: { value: CATALOG_DECISIONS_REVISION }, create: { key: DECISIONS_REV_KEY, value: CATALOG_DECISIONS_REVISION } });
  console.log(`ensureCatalogCleanup (decisions): ${report.renamed.length} renamed, ${report.unitsChanged.length} unit fixes, ${report.merged.length} merged, ${report.discontinued.length} discontinued.`);
}

export async function readCatalogDecisionsReport(): Promise<CatalogDecisionsReport | null> {
  const row = await prisma.setting.findUnique({ where: { key: CATALOG_DECISIONS_REPORT_KEY } }).catch(() => null);
  if (!row) return null;
  try { return JSON.parse(row.value) as CatalogDecisionsReport; } catch { return null; }
}

/** Exported for the dev test script. */
export async function applyCatalogDecisions(): Promise<CatalogDecisionsReport> {
  const report: CatalogDecisionsReport = { at: new Date().toISOString(), renamed: [], unitsChanged: [], merged: [], discontinued: [] };
  const [products, sums, warehouses] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, approved: true, notes: true, barcode: true, unitOfMeasure: true, unitsPerCase: true } }),
    prisma.stockMovement.groupBy({ by: ["productId", "warehouseId"], _sum: { quantity: true } }),
    prisma.warehouse.findMany({ select: { id: true, name: true } }),
  ]);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const stockOf = (productId: string): (Stock & { warehouseId: string })[] =>
    sums
      .filter((x) => x.productId === productId && Math.abs(x._sum.quantity ?? 0) > EPS)
      .map((x) => ({ warehouseId: x.warehouseId, warehouse: whName.get(x.warehouseId) ?? x.warehouseId, qty: Math.round((x._sum.quantity ?? 0) * 10000) / 10000 }));
  const n = normalizeProductName;
  const keysFor = (short: string) => new Set([short, canonicalProductName(short), ...(PREVIOUS_FULL_NAMES[short] ?? [])].map(n));
  const findRow = (short: string) => {
    const keys = keysFor(short);
    const c = products.filter((p) => keys.has(n(p.name)));
    return c.find((p) => n(p.name) === n(short) && p.approved) ?? c.find((p) => p.approved) ?? c[0] ?? null;
  };
  const gone = new Set<string>();

  // 1) Merges (before renames, so the twin's name never collides).
  // Targets: every merge target plus every catalog row whose name changed (its old
  // listing may survive as a separate row — e.g. "LESCO K-Flow …" vs the catalog's
  // "LESCO Liquid Fertilizer 0-0-25 …"). Sources: the listed names plus any other
  // active row carrying the target's current / previous names.
  const compact = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sourcesByTarget = new Map<string, string[]>();
  for (const [src, tgt] of Object.entries(CATALOG_MERGES)) sourcesByTarget.set(tgt, [...(sourcesByTarget.get(tgt) ?? []), src]);
  for (const tgt of Object.keys(PREVIOUS_FULL_NAMES)) if (!sourcesByTarget.has(tgt)) sourcesByTarget.set(tgt, []);
  for (const [tgt, srcs] of sourcesByTarget) {
    const k = findRow(tgt);
    if (!k) continue;
    const srcKeys = new Set([...srcs, ...keysFor(tgt)].map(compact));
    for (const p of products) {
      if (p.id === k.id || gone.has(p.id) || !srcKeys.has(compact(p.name))) continue;
      const fullName = canonicalProductName(tgt);
      report.merged.push({ from: p.name, into: fullName, stock: stockOf(p.id).map(({ warehouse, qty }) => ({ warehouse, qty })) });
      await mergeProductInto(p, k, fullName, `per Julie's catalog review ${CATALOG_DECISIONS_REVISION}`);
      gone.add(p.id);
    }
  }

  // 2) Renames + unit fixes for every catalog row.
  for (const short of approvedCatalogShortNames()) {
    const k = findRow(short);
    if (!k || gone.has(k.id)) continue;
    const fullName = canonicalProductName(short);
    const unit = CATALOG_UNIT_OVERRIDES[short];
    const data: { name?: string; unitOfMeasure?: string } = {};
    if (k.name !== fullName) { data.name = fullName; report.renamed.push({ from: k.name, to: fullName }); }
    if (unit && k.unitOfMeasure !== unit) { data.unitOfMeasure = unit; report.unitsChanged.push({ name: fullName, from: k.unitOfMeasure, to: unit }); }
    if (Object.keys(data).length) await prisma.product.update({ where: { id: k.id }, data });
  }

  // 3) Discontinued catch-alls: zero any on-hand (offsetting adjustment), deactivate.
  for (const name of DISCONTINUED_PRODUCTS) {
    for (const p of products.filter((x) => n(x.name) === n(name) && !gone.has(x.id))) {
      const stock = stockOf(p.id);
      for (const st of stock) {
        await prisma.stockMovement.create({
          data: {
            type: "adjustment", productId: p.id, warehouseId: st.warehouseId, quantity: -st.qty,
            reason: `Category discontinued — "${p.name}" is no longer tracked (Julie, ${CATALOG_DECISIONS_REVISION}); on-hand removed.`,
            source: "catalog_decision",
          },
        });
      }
      await prisma.product.update({
        where: { id: p.id },
        data: {
          active: false, approved: false, confirmed: true,
          notes: [p.notes, `${DISCARD_MARK} — category discontinued (Julie, ${CATALOG_DECISIONS_REVISION}). ${REJECTED_ARCHIVED_MARK}.`].filter(Boolean).join(" "),
        },
      });
      report.discontinued.push({ name: p.name, removed: stock.map(({ warehouse, qty }) => ({ warehouse, qty })) });
    }
  }
  // 4) Never assume a case (Julie 2026-11-13): clear the case size the old seed
  // stamped on every catalog row (4 for tubes, else 12). Case packaging is now set
  // per product on its profile (Packaging).
  let cleared = 0;
  for (const p of products) {
    if (gone.has(p.id) || p.unitsPerCase == null) continue;
    if (p.unitsPerCase === packSizeFor(p.unitOfMeasure) || p.unitsPerCase === 12 || p.unitsPerCase === 4) {
      await prisma.product.update({ where: { id: p.id }, data: { unitsPerCase: null } });
      cleared++;
    }
  }
  report.caseSizesCleared = cleared;
  return report;
}
