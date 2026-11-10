import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeProductName, PRODUCT_ALIASES } from "@/lib/product-aliases";
import { SITEONE_ALIASES } from "@/lib/invoice/siteone-aliases";
import { canonicalProductName, CATALOG_ITEM_NUMBERS } from "@/lib/catalog-names";
import { approvedCatalogShortNames, isHumanApproved, NON_CHEMICAL_PRODUCT_NAME } from "@/prisma/seed-products-approved";

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
  if (marker?.value === CATALOG_CLEANUP_REVISION) return;
  const report = await cleanupCatalog();
  if (!report) { _run = null; return; } // catalog not loaded yet — retry later
  const value = JSON.stringify(report);
  await prisma.setting.upsert({ where: { key: CATALOG_CLEANUP_REPORT_KEY }, update: { value }, create: { key: CATALOG_CLEANUP_REPORT_KEY, value } });
  await prisma.setting.upsert({ where: { key: REV_KEY }, update: { value: CATALOG_CLEANUP_REVISION }, create: { key: REV_KEY, value: CATALOG_CLEANUP_REVISION } });
  console.log(
    `ensureCatalogCleanup: ${report.renamed.length} renamed, ${report.merged.length} merged, ${report.deactivated.length} deactivated, ` +
      `${report.offCatalogWithStock.length} left off-catalog with stock, ${report.keptApprovedInApp.length} kept (approved in-app).`,
  );
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
          // Renamed so it never collides with the catalog row's name in a lookup.
          name: `${p.name} (merged)`,
          ...(moveBarcode ? { barcode: null } : {}),
          notes: [p.notes, `Merged into "${fullName}" (${k.id}) by the catalog cleanup ${CATALOG_CLEANUP_REVISION}.`].filter(Boolean).join(" "),
        },
      }),
      ...(moveBarcode ? [prisma.product.update({ where: { id: k.id }, data: { barcode: p.barcode } })] : []),
    ]);
    if (moveBarcode) k.barcode = p.barcode;
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
