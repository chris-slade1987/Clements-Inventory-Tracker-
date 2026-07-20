import { prisma } from "@/lib/prisma";
import { qty } from "@/lib/format";

// The reorder / low-stock agent. Runs alongside the anomaly + savings agents
// (on invoice confirm and "run checks now"). It learns each product's
// PURCHASING PATTERN and USAGE RUN-RATE purely from the stock-movement ledger —
// no schema change — and files "low_stock" alerts (upserted by a stable
// dedupeKey, so re-runs don't pile up and a user's dismissal stays dismissed).
//
// Everything is computed from StockMovement history:
//   - run-rate    = check-out (usage) units per day, averaged over a trailing
//                   window (TRAILING_DAYS). runRate30 = that × 30 for display.
//   - cadence     = mean interval (days) between check-in (receiving) events —
//                   this is the "how often we reorder" purchasing pattern.
//   - reorderQty  = mean check-in quantity — the typical reorder size.
//   - on-hand     = SUM(quantity) of all movements (check_out is negative).
//   - coverDays   = on-hand / daily-run-rate — how long current stock lasts.
//
// Derived reorder point (heuristic, documented so it can be tuned):
//   You want enough on hand to last until the next typical reorder lands, so the
//   reorder point is one replenishment cycle of usage: dailyRunRate × cadence,
//   with the cadence clamped to [REORDER_MIN_DAYS, REORDER_MAX_DAYS] so a very
//   short or very long observed cadence can't produce a silly trigger. A product
//   is flagged when on-hand has fallen to/below that reorder point OR when cover
//   has dropped under COVER_THRESHOLD_DAYS (a hard floor that catches irregular
//   items too). Severity escalates to critical when the item is out of stock, or
//   when there is a CLEAR REGULAR pattern (low cadence variance) and cover has
//   already dropped below the cadence — i.e. a reorder is evidently overdue.
//
// Only products with a real signal are considered (≥ MIN_CHECKINS receipts and
// some check-out usage), so brand-new / never-used products don't emit noise.

const TRAILING_DAYS = 90; // window for the usage run-rate
const COVER_THRESHOLD_DAYS = 21; // flag when days-of-cover drops below this floor
const REORDER_MIN_DAYS = 14; // clamp floor for the cadence-based reorder point
const REORDER_MAX_DAYS = 60; // clamp cap for the cadence-based reorder point
const MIN_CHECKINS = 2; // need a purchasing pattern (≥2 receipts)
const CADENCE_CV_REGULAR = 0.4; // coefficient-of-variation ≤ this ⇒ "regular" cadence

export type ReorderFinding = {
  productId: string;
  productName: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  branch: string | null; // branch key (vero|stuart|orlando|naples), from the warehouse name
  onHand: number;
  dailyRunRate: number;
  runRate30: number; // usage units per 30 days (display)
  coverDays: number; // how many days current on-hand lasts at the run-rate
  cadenceDays: number; // typical interval between reorders (check-ins)
  reorderQty: number; // typical reorder size (avg check-in qty)
  reorderPointUnits: number;
  regular: boolean; // low cadence variance ⇒ a dependable purchasing pattern
  outOfStock: boolean;
  severity: "warning" | "critical";
  message: string;
};

export type ReorderSummary = { low_stock: number };

/** Map a warehouse name ("Vero Beach (HQ)", "Stuart", …) to a branch key. */
function branchKeyFromWarehouseName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("vero")) return "vero";
  if (n.includes("stuart")) return "stuart";
  if (n.includes("orlando")) return "orlando";
  if (n.includes("naples")) return "naples";
  return null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/**
 * Compute the low-stock / reorder-due findings across every product+warehouse
 * with enough history to be meaningful. Pure read — files nothing. Reused by the
 * alert filer, the manager reminders, and the dashboard tile.
 */
export async function computeReorderFindings(): Promise<ReorderFinding[]> {
  const since = new Date(Date.now() - TRAILING_DAYS * 864e5);

  const [onHandRows, checkouts, checkins, warehouses] = await Promise.all([
    // Current on-hand per product+warehouse (all movement types).
    prisma.stockMovement.groupBy({
      by: ["productId", "warehouseId"],
      _sum: { quantity: true },
    }),
    // Usage (check-out) volume in the trailing window.
    prisma.stockMovement.groupBy({
      by: ["productId", "warehouseId"],
      where: { type: "check_out", createdAt: { gte: since } },
      _sum: { quantity: true },
    }),
    // Every check-in (receiving) event — for cadence + typical reorder size.
    prisma.stockMovement.findMany({
      where: { type: "check_in" },
      select: { productId: true, warehouseId: true, quantity: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.warehouse.findMany({ select: { id: true, name: true } }),
  ]);

  const key = (p: string, w: string) => `${p}::${w}`;
  const onHand = new Map<string, number>();
  for (const r of onHandRows) onHand.set(key(r.productId, r.warehouseId), r._sum.quantity ?? 0);
  const usage = new Map<string, number>();
  for (const r of checkouts) usage.set(key(r.productId, r.warehouseId), Math.abs(r._sum.quantity ?? 0));

  // Group check-ins per product+warehouse (already time-ordered).
  const receipts = new Map<string, { date: Date; qty: number }[]>();
  for (const c of checkins) {
    const k = key(c.productId, c.warehouseId);
    if (!receipts.has(k)) receipts.set(k, []);
    receipts.get(k)!.push({ date: c.createdAt, qty: Math.abs(c.quantity) });
  }

  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  // Resolve product names/units only for the pairs we might report.
  const candidateProductIds = new Set<string>();
  for (const [k, list] of receipts) {
    if (list.length >= MIN_CHECKINS) candidateProductIds.add(k.split("::")[0]);
  }
  const products = await prisma.product.findMany({
    where: { id: { in: [...candidateProductIds] } },
    select: { id: true, name: true, unitOfMeasure: true, active: true },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  const findings: ReorderFinding[] = [];

  for (const [k, list] of receipts) {
    if (list.length < MIN_CHECKINS) continue; // no purchasing pattern yet
    const [productId, warehouseId] = k.split("::");
    const product = pById.get(productId);
    if (!product || !product.active) continue;

    const used = usage.get(k) ?? 0;
    if (used <= 0) continue; // no usage signal → can't judge cover; skip noise

    const dailyRunRate = used / TRAILING_DAYS;
    if (dailyRunRate <= 0) continue;
    const runRate30 = dailyRunRate * 30;

    const stock = onHand.get(k) ?? 0;
    const coverDays = stock / dailyRunRate; // stock ≤ 0 ⇒ ≤ 0 (out of stock)

    // Cadence (days between receipts) + typical reorder size.
    const intervals: number[] = [];
    for (let i = 1; i < list.length; i++) {
      intervals.push((list[i].date.getTime() - list[i - 1].date.getTime()) / 864e5);
    }
    const cadenceDays = mean(intervals);
    const reorderQty = mean(list.map((r) => r.qty));

    // Regularity: coefficient of variation of the intervals. Needs ≥2 intervals
    // (≥3 receipts) to be meaningful — a single interval is always "perfect".
    let regular = false;
    if (intervals.length >= 2 && cadenceDays > 0) {
      const variance = mean(intervals.map((d) => (d - cadenceDays) ** 2));
      const cv = Math.sqrt(variance) / cadenceDays;
      regular = cv <= CADENCE_CV_REGULAR;
    }

    // Derived reorder point: one replenishment cycle of usage.
    const clampedCadence = cadenceDays > 0 ? Math.min(REORDER_MAX_DAYS, Math.max(REORDER_MIN_DAYS, cadenceDays)) : REORDER_MIN_DAYS;
    const reorderPointUnits = dailyRunRate * clampedCadence;

    const outOfStock = stock <= 0;
    const low = outOfStock || stock <= reorderPointUnits || coverDays <= COVER_THRESHOLD_DAYS;
    if (!low) continue;

    // Escalate: out of stock, or a dependable pattern with cover already under
    // the cadence (a reorder is evidently overdue).
    let severity: "warning" | "critical" = "warning";
    if (outOfStock) severity = "critical";
    else if (regular && cadenceDays > 0 && coverDays < cadenceDays) severity = "critical";

    const name = product.name;
    const unit = product.unitOfMeasure;
    const whFull = whName.get(warehouseId) ?? "warehouse";
    const wh = whFull.replace(" (HQ)", "");
    const cadenceStr = regular
      ? `; typically reordered every ~${Math.round(cadenceDays)} days`
      : `; usage ~${qty(Math.round(runRate30))}/30d`;
    const message = outOfStock
      ? `${name} — ${wh}: OUT OF STOCK with steady usage (~${qty(Math.round(runRate30))}/30d)${regular ? `; typically reordered every ~${Math.round(cadenceDays)} days` : ""}. Reorder ~${qty(Math.round(reorderQty))} ${unit}.`
      : `${name} — ${wh}: ${qty(stock)} on hand (~${Math.max(0, Math.round(coverDays))} days cover)${cadenceStr}. Reorder ~${qty(Math.round(reorderQty))} ${unit}.`;

    findings.push({
      productId,
      productName: name,
      unit,
      warehouseId,
      warehouseName: whFull,
      branch: branchKeyFromWarehouseName(whFull),
      onHand: stock,
      dailyRunRate,
      runRate30,
      coverDays,
      cadenceDays,
      reorderQty,
      reorderPointUnits,
      regular,
      outOfStock,
      severity,
      message,
    });
  }

  // Most urgent first: critical before warning, then least cover.
  const rank = { critical: 0, warning: 1 } as const;
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.coverDays - b.coverDays);
}

/**
 * Low-stock findings for a branch (or all branches when branch is null/omitted).
 * Reused by manager reminders and the dashboard tile.
 */
export async function lowStockForBranch(branch?: string | null): Promise<ReorderFinding[]> {
  const findings = await computeReorderFindings();
  return branch ? findings.filter((f) => f.branch === branch) : findings;
}

/**
 * File low-stock findings as alerts, mirroring the anomaly agent: upsert by a
 * stable dedupeKey (never overriding the user's status), and auto-close open
 * low-stock alerts whose product+warehouse has recovered so the list stays true.
 */
export async function runReorderChecks(): Promise<ReorderSummary> {
  const findings = await computeReorderFindings();
  const live = new Set<string>();

  for (const f of findings) {
    const dedupeKey = `low_stock:${f.productId}:${f.warehouseId}`;
    live.add(dedupeKey);
    await prisma.alert.upsert({
      where: { dedupeKey },
      create: {
        dedupeKey,
        type: "low_stock",
        productId: f.productId,
        message: f.message,
        severity: f.severity,
        status: "open",
      },
      // Refresh wording/severity but never override the user's status choice.
      update: { message: f.message, severity: f.severity },
    });
  }

  // Recovered items: close any still-open low-stock alert that no longer trips,
  // so a restocked product drops off the active list on the next scan.
  const openLow = await prisma.alert.findMany({
    where: { type: "low_stock", status: { in: ["open", "acknowledged"] } },
    select: { id: true, dedupeKey: true },
  });
  const stale = openLow.filter((a) => a.dedupeKey && !live.has(a.dedupeKey)).map((a) => a.id);
  if (stale.length > 0) {
    await prisma.alert.updateMany({ where: { id: { in: stale } }, data: { status: "dismissed" } });
  }

  return { low_stock: findings.length };
}
