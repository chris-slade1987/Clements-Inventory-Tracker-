/**
 * Catalog cleanup — "one source of truth per product" (whiteboard Phases 1–4).
 *
 * The invoice is the source of truth, not the catalog. This pass:
 *   1. CANONICALIZES each product from its invoice history (fill-null only, so a
 *      human-set value is never overwritten): distributorSku ← most-common invoice
 *      itemNumber, vendorItemNumbers ← the set of item numbers seen, lastUnitCost ←
 *      the most recent invoice unit cost.
 *   2. DEDUPES high-confidence duplicate products, repointing ALL history
 *      (invoice lines, stock movements, barcodes, checkout lines) onto one survivor
 *      so on-hand consolidates, then deactivating the loser (active=false). A loser
 *      with NO history at all is hard-deleted (nothing to preserve). Two products
 *      are duplicates when they share a non-null distributorSku OR an identical
 *      normalized name — the only signals safe to merge automatically.
 *   3. ROUTES-TO-QUEUE: an off-catalog (approved=false), active product with NO
 *      invoice backing is flagged confirmed=false so it surfaces in the Confirm
 *      Queue for a human to catalog or discard.
 *
 * Survivor selection prefers an approved+confirmed product, then the one with the
 * most invoice lines, then one that has a SKU, then the oldest id (stable). Never
 * hard-deletes a product that carries any stock history (the core data rule).
 *
 * Safe to pass { apply:false } for a dry-run report. The deploy wires it once
 * behind the `catalog_cleanup_v1` Setting marker.
 */
import type { PrismaClient } from "@prisma/client";

export type CleanupResult = {
  productsScanned: number;
  canonicalized: { skuSet: number; vendorItemsSet: number; costSet: number };
  clusters: number;
  merged: number;
  hardDeleted: number;
  routedToQueue: number;
  mergeLog: string[];
};

/** Normalize a product name for exact-duplicate detection. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Most frequent value in a list (first-seen wins ties); null if empty. */
function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

export async function cleanupCatalog(prisma: PrismaClient, opts: { apply: boolean }): Promise<CleanupResult> {
  const apply = opts.apply;
  const result: CleanupResult = {
    productsScanned: 0,
    canonicalized: { skuSet: 0, vendorItemsSet: 0, costSet: 0 },
    clusters: 0,
    merged: 0,
    hardDeleted: 0,
    routedToQueue: 0,
    mergeLog: [],
  };

  const products = await prisma.product.findMany({
    where: { active: true },
    select: {
      id: true, name: true, approved: true, confirmed: true,
      distributorSku: true, vendorItemNumbers: true, lastUnitCost: true, notes: true,
    },
  });
  result.productsScanned = products.length;

  // Invoice history keyed by product.
  const invLines = await prisma.invoiceLine.findMany({
    select: { productId: true, itemNumber: true, unitCost: true, unitPrice: true, invoice: { select: { invoiceDate: true } } },
  });
  type Agg = { count: number; itemNumbers: string[]; latest: { date: Date; cost: number | null } | null };
  const byProduct = new Map<string, Agg>();
  for (const l of invLines) {
    if (!l.productId) continue;
    const a = byProduct.get(l.productId) ?? { count: 0, itemNumbers: [], latest: null };
    a.count += 1;
    if (l.itemNumber) a.itemNumbers.push(l.itemNumber.trim());
    const cost = l.unitCost ?? l.unitPrice ?? null;
    const date = l.invoice?.invoiceDate ?? new Date(0);
    if (!a.latest || date > a.latest.date) a.latest = { date, cost };
    byProduct.set(l.productId, a);
  }

  // ── 1. Canonicalize (fill-null) from invoice data ───────────────────────────
  for (const p of products) {
    const agg = byProduct.get(p.id);
    if (!agg) continue;
    const data: Record<string, unknown> = {};
    if (!p.distributorSku) {
      const sku = mode(agg.itemNumbers);
      if (sku) { data.distributorSku = sku; result.canonicalized.skuSet++; }
    }
    if (!p.vendorItemNumbers && agg.itemNumbers.length) {
      const distinct = [...new Set(agg.itemNumbers)];
      if (distinct.length) { data.vendorItemNumbers = distinct.join(", "); result.canonicalized.vendorItemsSet++; }
    }
    if (p.lastUnitCost == null && agg.latest?.cost != null) {
      data.lastUnitCost = agg.latest.cost; result.canonicalized.costSet++;
    }
    if (Object.keys(data).length && apply) {
      await prisma.product.update({ where: { id: p.id }, data });
      // reflect for the dedupe pass below
      if (data.distributorSku) p.distributorSku = data.distributorSku as string;
    } else if (data.distributorSku) {
      p.distributorSku = data.distributorSku as string;
    }
  }

  // ── 2. Dedupe — union products that share a SKU or an identical normalized name
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const p of products) parent.set(p.id, p.id);

  const bySku = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const p of products) {
    if (p.distributorSku) {
      const k = p.distributorSku.trim().toLowerCase();
      (bySku.get(k) ?? bySku.set(k, []).get(k)!).push(p.id);
    }
    const nk = normName(p.name);
    if (nk) (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(p.id);
  }
  for (const ids of bySku.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  for (const ids of byName.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  // Build clusters.
  const clusters = new Map<string, string[]>();
  for (const p of products) {
    const root = find(p.id);
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(p.id);
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const mergedLosers = new Set<string>();

  for (const ids of clusters.values()) {
    if (ids.length < 2) continue;
    result.clusters++;
    // Choose the survivor.
    const ranked = ids.map((id) => productById.get(id)!).sort((a, b) => {
      const ac = (a.approved && a.confirmed) ? 1 : 0, bc = (b.approved && b.confirmed) ? 1 : 0;
      if (ac !== bc) return bc - ac;
      const an = byProduct.get(a.id)?.count ?? 0, bn = byProduct.get(b.id)?.count ?? 0;
      if (an !== bn) return bn - an;
      const as = a.distributorSku ? 1 : 0, bs = b.distributorSku ? 1 : 0;
      if (as !== bs) return bs - as;
      return a.id < b.id ? -1 : 1;
    });
    const survivor = ranked[0];
    for (const loser of ranked.slice(1)) {
      mergedLosers.add(loser.id);
      // Repoint ALL history onto the survivor so on-hand consolidates.
      const [mv, il, bc, cl] = await Promise.all([
        prisma.stockMovement.count({ where: { productId: loser.id } }),
        prisma.invoiceLine.count({ where: { productId: loser.id } }),
        prisma.productBarcode.count({ where: { productId: loser.id } }),
        prisma.checkoutLine.count({ where: { productId: loser.id } }),
      ]);
      const hasHistory = mv + il + bc + cl > 0;
      result.mergeLog.push(`"${loser.name}" (${loser.id}) → "${survivor.name}" (${survivor.id}) [${mv}mv/${il}inv/${bc}bc/${cl}co]${hasHistory ? "" : " (hard-delete)"}`);
      if (!apply) { result.merged++; if (!hasHistory) result.hardDeleted++; continue; }
      if (hasHistory) {
        await prisma.$transaction([
          prisma.stockMovement.updateMany({ where: { productId: loser.id }, data: { productId: survivor.id } }),
          prisma.invoiceLine.updateMany({ where: { productId: loser.id }, data: { productId: survivor.id } }),
          prisma.productBarcode.updateMany({ where: { productId: loser.id }, data: { productId: survivor.id } }),
          prisma.checkoutLine.updateMany({ where: { productId: loser.id }, data: { productId: survivor.id } }),
          prisma.product.update({
            where: { id: loser.id },
            data: {
              active: false, confirmed: true,
              notes: [loser.notes, `Merged into "${survivor.name}" (${survivor.id}) by catalog cleanup.`].filter(Boolean).join(" "),
            },
          }),
        ]);
        result.merged++;
      } else {
        await prisma.product.delete({ where: { id: loser.id } });
        result.merged++;
        result.hardDeleted++;
      }
    }
  }

  // ── 3. Route-to-queue: off-catalog, invoice-less products → Confirm Queue ────
  const QUEUE_MARK = "Flagged for review by catalog cleanup";
  for (const p of products) {
    if (mergedLosers.has(p.id)) continue; // a merged-away duplicate, already deactivated
    const agg = byProduct.get(p.id);
    const orphan = !p.approved && p.confirmed && (!agg || agg.count === 0) && !(p.notes ?? "").includes(QUEUE_MARK);
    if (!orphan) continue;
    result.routedToQueue++;
    if (apply) {
      await prisma.product.update({
        where: { id: p.id },
        data: { confirmed: false, notes: [p.notes, `${QUEUE_MARK}: off-catalog with no invoice backing — catalog or discard.`].filter(Boolean).join(" ") },
      });
    }
  }

  return result;
}

/**
 * Phase 4 — clear every product-linked photo so the fresh scanning pass starts
 * from a clean slate. Today the only product-linked photos are the AI/scan photos
 * captured on checkout lines (CheckoutLine.photoUrl); this nulls those references.
 * The historical checkout record itself is untouched. Returns how many were cleared.
 */
export async function clearProductPhotos(prisma: PrismaClient, opts: { apply: boolean }): Promise<{ cleared: number }> {
  const count = await prisma.checkoutLine.count({ where: { photoUrl: { not: null } } });
  if (opts.apply && count > 0) {
    await prisma.checkoutLine.updateMany({ where: { photoUrl: { not: null } }, data: { photoUrl: null } });
  }
  return { cleared: count };
}
