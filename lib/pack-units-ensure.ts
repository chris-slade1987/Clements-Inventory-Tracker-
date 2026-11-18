import "server-only";
import { prisma } from "@/lib/prisma";
import { packProductFor } from "@/lib/pack-units";
import { isCountReason } from "@/lib/stock-count";

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
  if (!_run) _run = convert().then(correctPastCheckouts).then(applyCountDirectives).catch((e) => { console.error("ensurePackUnits failed (non-fatal, will retry):", e); _run = null; });
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
      // Is existing on-hand counted in outer units (packs/boxes/cases)? "auto" decides
      // by price: a recorded price above singleMaxPrice is a case price.
      const inOuter = rule.onHandIn === "outer" || (packPrice != null && rule.singleMaxPrice != null && packPrice > rule.singleMaxPrice);
      const factor = inOuter ? rule.per : 1;
      const unitPrice = packPrice != null ? Math.round((packPrice / factor) * 1000) / 1000 : null;
      const reason = inOuter
        ? `Unit change (COO 2026-11-18): now issued as single ${rule.single}s — 1 ${rule.outer} = ${rule.per} ${rule.single}s, so on-hand ×${rule.per} and cost ÷${rule.per} (value unchanged)`
        : `Unit change (COO 2026-11-18): now issued as single ${rule.single}s; on-hand was already in single ${rule.single}s, so unchanged — check-ins now take ${rule.outer}s of ${rule.per}`;

      // All-or-nothing per product, so a retry can never convert the same stock twice.
      const byWh = await prisma.$transaction(async (tx) => {
        const rows = await tx.stockMovement.groupBy({ by: ["warehouseId"], where: { productId: p.id }, _sum: { quantity: true } });
        let posted = 0;
        for (const w of rows) {
          const onHand = w._sum.quantity ?? 0;
          if (!inOuter || Math.abs(onHand) < 1e-9) continue;
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
      const line = `${p.name}: ${byWh.map((w) => `${w._sum.quantity ?? 0}→${(w._sum.quantity ?? 0) * factor}`).join(", ") || "no stock"}; $${packPrice ?? "?"}/${inOuter ? rule.outer : rule.single} → $${unitPrice ?? "?"}/${rule.single}`;
      log.push(line);
      await prisma.setting.update({ where: { key: `${MARKER_PREFIX}${p.id}` }, data: { value: JSON.stringify({ at: new Date().toISOString(), line }) } });
    } catch (e) {
      await prisma.setting.delete({ where: { key: `${MARKER_PREFIX}${p.id}` } }).catch(() => {});
      throw e;
    }
  }
  if (log.length) console.log(`ensurePackUnits: converted ${log.length} pack product(s) — ${log.join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Past check-outs of pack items were single TUBES handed out, but on-hand was kept
// in packs, so each one took a whole pack (COO 2026-11-18: "if it should have just
// been a tube rather than a whole case, update the check out records"). After the
// ×per conversion above, each such check-out has taken `per` single units instead
// of 1, so per warehouse we add back (per − 1) × the units issued — as ONE positive
// `adjustment` (never editing or deleting the original check-out, whose quantity
// now reads correctly in single units). Only check-outs that on-hand still reflects
// are corrected: those AFTER the warehouse's last stock count before the switch
// (a count already reset on-hand) and BEFORE the switch; voided ones (reversed)
// and Aug–Sep import rows the log recorded as whole boxes ("TB") are left alone.
// Once per product (Setting marker), transactional.
// ---------------------------------------------------------------------------

/** Aug–Sep 2026 import rows logged as whole boxes ("TB") — genuinely a pack, not a tube. */
const BOX_LOGGED_REFS = new Set([
  "Vero Beach#row869", "Vero Beach#row843", "Vero Beach#row844", "Vero Beach#row825",
  "Vero Beach#row829", "Vero Beach#row856", "Vero Beach#row885",
]);
const FIX_PREFIX = "pack_checkout_fix_v1:";

async function correctPastCheckouts(): Promise<void> {
  const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true } });
  for (const p of products) {
    const rule = packProductFor(p.name);
    if (!rule || !rule.correctPast) continue;
    const conv = await prisma.setting.findUnique({ where: { key: `${MARKER_PREFIX}${p.id}` } });
    if (!conv || conv.value.includes('"status":"running"')) continue; // not converted yet
    try {
      await prisma.setting.create({ data: { key: `${FIX_PREFIX}${p.id}`, value: JSON.stringify({ status: "running", at: new Date().toISOString() }) } });
    } catch {
      continue; // done (or another instance is on it)
    }
    try {
      const cutoff = conv.updatedAt;
      const summary = await prisma.$transaction(async (tx) => {
        const moves = await tx.stockMovement.findMany({
          where: { productId: p.id, createdAt: { lte: cutoff } },
          select: { id: true, type: true, warehouseId: true, quantity: true, reason: true, externalRef: true, reversalOfId: true, movementDate: true, createdAt: true, unitPrice: true },
        });
        const reversed = new Set(moves.map((m) => m.reversalOfId).filter(Boolean) as string[]);
        const when = (m: { movementDate: Date | null; createdAt: Date }) => (m.movementDate ?? m.createdAt).getTime();
        const unitPrice = (await tx.product.findUnique({ where: { id: p.id }, select: { lastUnitCost: true } }))?.lastUnitCost ?? null;
        const out: string[] = [];
        for (const wh of new Set(moves.map((m) => m.warehouseId))) {
          const here = moves.filter((m) => m.warehouseId === wh);
          const lastCount = Math.max(0, ...here.filter((m) => m.type === "adjustment" && isCountReason(m.reason)).map(when));
          const tubes = here.filter(
            (m) => m.type === "check_out" && m.quantity < 0 && when(m) > lastCount && !reversed.has(m.id) && !(m.externalRef && BOX_LOGGED_REFS.has(m.externalRef)),
          );
          const issued = tubes.reduce((s, m) => s + Math.abs(m.quantity), 0);
          if (issued <= 0) continue;
          const addBack = issued * (rule.per - 1);
          await tx.stockMovement.create({
            data: {
              type: "adjustment", productId: p.id, warehouseId: wh, quantity: addBack, unit: rule.unit, unitPrice,
              reason: `Check-out correction (COO 2026-11-18): ${tubes.length} earlier check-out${tubes.length === 1 ? "" : "s"} here (${issued} ${rule.single}${issued === 1 ? "" : "s"}) were single ${rule.single}s, not whole packs — adds back ${rule.per - 1} ${rule.single}s each (+${addBack})`,
            },
          });
          out.push(`${wh}: +${addBack} (${tubes.length} check-outs)`);
        }
        return out;
      });
      await prisma.setting.update({ where: { key: `${FIX_PREFIX}${p.id}` }, data: { value: JSON.stringify({ at: new Date().toISOString(), summary }) } });
      if (summary.length) console.log(`correctPastCheckouts: ${p.name} — ${summary.join("; ")}`);
    } catch (e) {
      await prisma.setting.delete({ where: { key: `${FIX_PREFIX}${p.id}` } }).catch(() => {});
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Physical counts reported to the COO, applied as a stock-count adjustment (the
// reason contains "count", so the product shows as counted there). Each sets
// on-hand to exactly `onHand` and records what the portal showed before. Once each.
// ---------------------------------------------------------------------------
// `asOf` = when the count was reported: check-outs made AFTER it still come off the
// counted number, so the result is right whichever lands first (e.g. Jason issues
// the 3 tubes to Brian before this deploy reaches production → 0, not 3).
const COUNT_DIRECTIVES: { key: string; product: string; branch: string; onHand: number; asOf: string; by: string }[] = [
  { key: "vero-advion-evolution-2026-11-18", product: "Advion Evolution Cockroach Gel Bait 4x30g (4 pack)", branch: "vero", onHand: 3, asOf: "2026-11-18T19:15:00Z", by: "Jason Colontrelle (reported via the COO, 2026-11-18)" },
];
const COUNT_PREFIX = "count_directive_v1:";

async function applyCountDirectives(): Promise<void> {
  for (const d of COUNT_DIRECTIVES) {
    const marker = `${COUNT_PREFIX}${d.key}`;
    if (await prisma.setting.findUnique({ where: { key: marker } })) continue;
    const rule = packProductFor(d.product);
    const product = (await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, lastUnitCost: true } })).find((p) => packProductFor(p.name) === rule);
    const wh = (await prisma.warehouse.findMany({ where: { active: true }, select: { id: true, name: true } })).find((w) => w.name.toLowerCase().includes(d.branch));
    if (!product || !wh || !rule) continue;
    // Only after this product's conversion + correction have landed.
    if (!(await prisma.setting.findUnique({ where: { key: `${FIX_PREFIX}${product.id}` } }))) continue;
    try {
      await prisma.setting.create({ data: { key: marker, value: JSON.stringify({ status: "running", at: new Date().toISOString() }) } });
    } catch {
      continue;
    }
    try {
      const before = (await prisma.stockMovement.aggregate({ where: { productId: product.id, warehouseId: wh.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;
      // Movements since the count was reported (other than this healer's own) still apply.
      const since = (await prisma.stockMovement.aggregate({
        where: { productId: product.id, warehouseId: wh.id, createdAt: { gt: new Date(d.asOf) }, NOT: { reason: { startsWith: "Check-out correction" } } },
        _sum: { quantity: true },
      }))._sum.quantity ?? 0;
      const target = d.onHand + since;
      const delta = target - before;
      await prisma.stockMovement.create({
        data: {
          type: "adjustment", productId: product.id, warehouseId: wh.id, quantity: delta, unit: rule.unit, unitPrice: product.lastUnitCost,
          reason: `Stock count — ${d.by}: ${d.onHand} ${rule.single}s on hand as of ${d.asOf.slice(0, 16).replace("T", " ")} UTC (portal showed ${before - since} then${since ? `; ${since} since` : ""}; ${delta >= 0 ? "+" : ""}${delta})`,
        },
      });
      await prisma.setting.update({ where: { key: marker }, data: { value: JSON.stringify({ at: new Date().toISOString(), before, since, after: target }) } });
      console.log(`applyCountDirectives: ${d.product} at ${wh.name} — portal showed ${before}, set to ${target} (${d.onHand} counted, ${since} since).`);
    } catch (e) {
      await prisma.setting.delete({ where: { key: marker } }).catch(() => {});
      throw e;
    }
  }

}

/** Individual steps, for tests (production uses ensurePackUnits). */
export const __packSteps = { convert, correctPastCheckouts, applyCountDirectives };
