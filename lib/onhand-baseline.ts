import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeProductName, PRODUCT_ALIASES } from "@/lib/product-aliases";
import baseline from "@/prisma/data/inventory-counts/2026-10-30.json";

// Runtime GO-LIVE on-hand baseline loader (physical count as of 2026-10-30).
//
// Why this exists: the build-time deploy-db seed doesn't reliably reach the LIVE
// production DB (same reason the catalog/org-chart/MBR need runtime heal). This
// is the real starting point for route/technician inventory tracking, so it runs
// from the shared authenticated layout and self-heals in prod on first load.
//
// What it does, per the core data rule (on-hand = SUM(movements); never mutate
// on-hand directly, never hard-delete): it reconciles every warehouse to the
// sheet by posting ONE "adjustment" movement per product per branch equal to
// (counted - current). This is a FULL RESET to the sheet — any product with
// current stock that the sheet does not list is driven to 0, because the physical
// count is authoritative for go-live. Matched by normalizeProductName + the
// confirmed PRODUCT_ALIASES. It NEVER creates, renames, or deletes a product;
// unlisted sheet rows that don't match the catalog are reported, not invented.
// Idempotent (Setting marker), non-fatal, add-only to the movement ledger.

const MARKER = "onhand_baseline_2026-10-30";
const COUNT_AT = new Date("2026-10-30T12:00:00Z");
const REASON = "Go-live on-hand baseline 10/30/2026";

// Count-sheet tab label -> canonical warehouse name.
const TAB_TO_WAREHOUSE: Record<string, string> = {
  "Vero Beach": "Vero Beach (HQ)",
  Stuart: "Stuart",
  Orlando: "Orlando",
  Naples: "Naples",
};

export type BaselineResult = {
  applied: boolean;
  reason?: string;
  adjustments: number;
  set: number; // product-branch cells set to a non-zero count
  zeroed: number; // product-branch cells reset to 0 (not on the sheet)
  unmatched: string[]; // sheet rows that matched no catalog product
};

let _ran = false;

export async function ensureOnHandBaseline(): Promise<void> {
  if (_ran) return;
  try {
    const marker = await prisma.setting.findUnique({ where: { key: MARKER } });
    if (marker) {
      _ran = true;
      return;
    }
    const res = await applyOnHandBaseline();
    if (res.applied) {
      _ran = true;
      console.log(
        `ensureOnHandBaseline: applied ${res.adjustments} adjustments (${res.set} set, ${res.zeroed} zeroed); unmatched: ${res.unmatched.join(", ") || "none"}`,
      );
    }
    // If not applied (catalog/warehouses not ready yet) leave _ran false so a
    // later request retries once the prerequisites exist.
  } catch (e) {
    console.error("ensureOnHandBaseline failed (non-fatal):", e);
  }
}

export async function applyOnHandBaseline(): Promise<BaselineResult> {
  const empty: BaselineResult = { applied: false, adjustments: 0, set: 0, zeroed: 0, unmatched: [] };

  const existing = await prisma.setting.findUnique({ where: { key: MARKER } });
  if (existing) return { ...empty, reason: "already applied" };

  // Need the catalog seeded first; bail (without marking) so we retry later.
  const products = await prisma.product.findMany({ select: { id: true, name: true, approved: true } });
  if (products.length === 0) return { ...empty, reason: "catalog not seeded yet" };

  // Normalized catalog index. Prefer an approved product when two normalize alike.
  const byNorm = new Map<string, { id: string; name: string; approved: boolean }>();
  for (const p of products) {
    const n = normalizeProductName(p.name);
    const prev = byNorm.get(n);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(n, p);
  }

  const resolve = (sheetName: string) => {
    const norm = normalizeProductName(sheetName);
    const direct = byNorm.get(norm);
    if (direct) return direct;
    const aliased = PRODUCT_ALIASES[norm];
    if (aliased) return byNorm.get(normalizeProductName(aliased)) ?? null;
    return null;
  };

  const branches = (baseline as { branches: Record<string, Record<string, number>> }).branches;

  // Resolve all four warehouses up front; if any is missing, bail without marking.
  const warehouses: { tab: string; id: string; counts: Record<string, number> }[] = [];
  for (const [tab, counts] of Object.entries(branches)) {
    const whName = TAB_TO_WAREHOUSE[tab];
    if (!whName) continue;
    const wh = await prisma.warehouse.findFirst({ where: { name: whName }, select: { id: true } });
    if (!wh) return { ...empty, reason: `warehouse "${whName}" not found yet` };
    warehouses.push({ tab, id: wh.id, counts });
  }

  const unmatched = new Set<string>();
  let adjustments = 0;
  let set = 0;
  let zeroed = 0;

  for (const wh of warehouses) {
    // Target on-hand per catalog product for this branch (matched sheet rows,
    // summed when two rows resolve to the same product). Everything else = 0.
    const target = new Map<string, number>();
    for (const [rawName, rawQty] of Object.entries(wh.counts)) {
      const prod = resolve(rawName);
      const qty = Number(rawQty) || 0;
      if (!prod) {
        if (qty !== 0) unmatched.add(rawName); // only flag rows that carry stock
        continue;
      }
      target.set(prod.id, (target.get(prod.id) ?? 0) + qty);
    }

    // Current on-hand per product at this branch.
    const agg = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { warehouseId: wh.id },
      _sum: { quantity: true },
    });
    const current = new Map<string, number>();
    for (const a of agg) current.set(a.productId, a._sum.quantity ?? 0);

    // One adjustment per product whose current != target (full reset to sheet).
    const moves: {
      type: string;
      productId: string;
      warehouseId: string;
      quantity: number;
      reason: string;
      createdAt: Date;
    }[] = [];
    for (const p of products) {
      const tgt = target.get(p.id) ?? 0;
      const cur = current.get(p.id) ?? 0;
      const delta = tgt - cur;
      if (delta === 0) continue;
      moves.push({
        type: "adjustment",
        productId: p.id,
        warehouseId: wh.id,
        quantity: delta,
        reason: REASON,
        createdAt: COUNT_AT,
      });
      if (tgt === 0) zeroed++;
      else set++;
    }
    if (moves.length) {
      await prisma.stockMovement.createMany({ data: moves });
      adjustments += moves.length;
    }
  }

  await prisma.setting.upsert({
    where: { key: MARKER },
    update: { value: new Date().toISOString() },
    create: { key: MARKER, value: new Date().toISOString() },
  });

  return { applied: true, adjustments, set, zeroed, unmatched: [...unmatched] };
}
