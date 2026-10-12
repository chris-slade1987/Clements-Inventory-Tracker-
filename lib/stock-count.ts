import { prisma } from "@/lib/prisma";

/**
 * Physical stock-count support for the scan-to-issue flow.
 *
 * A product is considered "counted at a branch" when at least one `adjustment`
 * movement whose reason marks it as a physical count/reconciliation exists for
 * that product at that warehouse. We never store a separate counted flag — like
 * on-hand, counted-state is derived from the movement ledger (CORE DATA RULE).
 *
 * The stock-count screen (`/inventory/stock-count`) writes one `adjustment`
 * movement per product = (counted − current). When the delta is zero we still
 * write a 0-quantity count adjustment so the product is recorded as counted
 * (on-hand is unchanged — adding 0 — and the audit trail shows "counted, no
 * change").
 *
 * Products that have NEVER been counted get a conservative check-out cap of 40
 * units (we can't trust their on-hand), with a "Not yet counted" badge; once
 * counted, the cap is the real on-hand.
 */

/** Marker written into a count adjustment's reason (prefix). */
export const COUNT_REASON_PREFIX = "Physical count";

/** Cap on check-out quantity for a product that has never been counted. */
export const NOT_COUNTED_CAP = 40;

/** True when a movement reason marks it as a physical count / reconciliation. */
export function isCountReason(reason: string | null | undefined): boolean {
  return /count|reconcil/i.test(reason ?? "");
}

/**
 * The set of product ids that have been counted at a warehouse (any count/
 * reconciliation adjustment exists for them there). Computed in JS so the
 * reason match is case-reliable across SQLite (local) and Postgres (prod).
 */
export async function countedProductIds(warehouseId: string): Promise<Set<string>> {
  const rows = await prisma.stockMovement.findMany({
    where: { warehouseId, type: "adjustment" },
    select: { productId: true, reason: true },
  });
  const set = new Set<string>();
  for (const r of rows) {
    if (isCountReason(r.reason)) set.add(r.productId);
  }
  return set;
}
