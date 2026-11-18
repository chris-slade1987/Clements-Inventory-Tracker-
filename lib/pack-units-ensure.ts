import "server-only";
import { prisma } from "@/lib/prisma";
import { packProductFor } from "@/lib/pack-units";

// ---------------------------------------------------------------------------
// One-time conversion of pack-sold products to single units (COO 2026-11-18).
// See lib/pack-units.ts for the list and the why.
//
// Per product (once — Setting marker per product id):
//   1. unitsPerCase = per, unitOfMeasure = the single unit (tube / each);
//   2. lastUnitCost = pack price ÷ per;
//   3. each warehouse's on-hand (SUM of movements, counted in packs until now) is
//      converted with ONE offsetting `adjustment` of on-hand × (per − 1), priced
//      at the per-unit cost — so on-hand becomes single units and the inventory
//      $ value (latest unit price × on-hand) is unchanged. Never edits or deletes
//      a movement. The reason text avoids the word "count" so it isn't mistaken
//      for a stock count (lib/stock-count.ts isCountReason).
//   4. if no warehouse holds any, a 0-quantity adjustment records the per-unit
//      price so dispersals are valued per unit from now on.
// Non-fatal; runs at most once per server instance.
// ---------------------------------------------------------------------------

const MARKER_PREFIX = "pack_units_v1:";
let _run: Promise<void> | null = null;

export function ensurePackUnits(): Promise<void> {
  if (!_run) _run = convert().catch((e) => { console.error("ensurePackUnits failed (non-fatal, will retry):", e); _run = null; });
  return _run;
}

async function convert(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, name: true, unitOfMeasure: true, unitsPerCase: true, lastUnitCost: true },
  });
  const targets = products.map((p) => ({ p, rule: packProductFor(p.name) })).filter((x) => x.rule);
  if (!targets.length) return;
  const done = new Set(
    (await prisma.setting.findMany({ where: { key: { startsWith: MARKER_PREFIX } }, select: { key: true } })).map((s) => s.key.slice(MARKER_PREFIX.length)),
  );
  const log: string[] = [];
  for (const { p, rule } of targets) {
    if (!rule || done.has(p.id)) continue;
    // Claim first so two cold starts can't both convert the same product.
    try {
      await prisma.setting.create({ data: { key: `${MARKER_PREFIX}${p.id}`, value: JSON.stringify({ status: "running", at: new Date().toISOString() }) } });
    } catch {
      continue;
    }
    try {
      const packPrice =
        p.lastUnitCost ??
        (await prisma.stockMovement.findFirst({ where: { productId: p.id, unitPrice: { not: null } }, orderBy: { createdAt: "desc" }, select: { unitPrice: true } }))?.unitPrice ??
        null;
      const unitPrice = packPrice != null ? Math.round((packPrice / rule.per) * 1000) / 1000 : null;
      const reason = `Unit change (COO 2026-11-18): now issued as single ${rule.single}s — 1 pack = ${rule.per} ${rule.single}s, so on-hand ×${rule.per} and cost ÷${rule.per} (value unchanged)`;

      // All-or-nothing per product, so a retry can never convert the same stock twice.
      const byWh = await prisma.$transaction(async (tx) => {
        const rows = await tx.stockMovement.groupBy({ by: ["warehouseId"], where: { productId: p.id }, _sum: { quantity: true } });
        let posted = 0;
        for (const w of rows) {
          const onHand = w._sum.quantity ?? 0;
          if (Math.abs(onHand) < 1e-9) continue;
          await tx.stockMovement.create({
            data: { type: "adjustment", productId: p.id, warehouseId: w.warehouseId, quantity: onHand * (rule.per - 1), unit: rule.unit, unitPrice, reason },
          });
          posted++;
        }
        if (!posted && unitPrice != null) {
          const wh = await tx.warehouse.findFirst({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } });
          if (wh) await tx.stockMovement.create({ data: { type: "adjustment", productId: p.id, warehouseId: wh.id, quantity: 0, unit: rule.unit, unitPrice, reason } });
        }
        await tx.product.update({
          where: { id: p.id },
          data: { unitsPerCase: rule.per, unitOfMeasure: rule.unit, ...(unitPrice != null ? { lastUnitCost: unitPrice } : {}) },
        });
        return rows;
      });
      const line = `${p.name}: ${byWh.map((w) => `${w._sum.quantity ?? 0}→${(w._sum.quantity ?? 0) * rule.per}`).join(", ") || "no stock"}; $${packPrice ?? "?"}/pack → $${unitPrice ?? "?"}/${rule.single}`;
      log.push(line);
      await prisma.setting.update({ where: { key: `${MARKER_PREFIX}${p.id}` }, data: { value: JSON.stringify({ at: new Date().toISOString(), line }) } });
    } catch (e) {
      await prisma.setting.delete({ where: { key: `${MARKER_PREFIX}${p.id}` } }).catch(() => {});
      throw e;
    }
  }
  if (log.length) console.log(`ensurePackUnits: converted ${log.length} pack product(s) — ${log.join(" | ")}`);
}
