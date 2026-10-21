/**
 * Canonical catalog reconcile — the single source of truth is the OWNER-reconciled
 * master `prisma/data/inventory-reset/01_product_catalog.csv`, keyed by the SiteOne
 * ITEM NUMBER (the invoice identity). This is what makes "the invoice data is the
 * approved product" real, and it is what correctly tells apart look-alikes that are
 * genuinely different (the three Cross-Checks, every distinct-NPK fertilizer) — they
 * have different item numbers, so they stay separate; only rows that resolve to the
 * SAME canonical product are merged.
 *
 * Per canonical row we FIND-OR-CREATE the one survivor product (match by item # →
 * exact name → the owner's short name) and mark it approved + confirmed with the
 * owner's proper name, all its item numbers, and cost. Then every OTHER active
 * product that resolves to that same canonical (by item #, name, short name, an
 * explicit junk-row override, or the PestPac alias map) is MERGED into the survivor —
 * all history (movements, invoice lines, barcodes, checkout lines) repointed so
 * on-hand consolidates, the duplicate deactivated (never hard-deleted). The survivor
 * inherits classification / unit / enrichment from a merged row where it was missing,
 * so the bulk-upload's good data isn't lost. Finally, any active product that resolves
 * to NO canonical row is demoted to off-catalog (approved=false) for human review.
 *
 * Idempotent: once a duplicate is merged it's inactive and won't re-resolve; the
 * approved-products seed skips rows marked "Merged into …" so they're never
 * resurrected. Never hard-deletes; never edits on-hand directly.
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProductName, PRODUCT_ALIASES } from "../lib/product-aliases";
import { isUomCode } from "../lib/uom";

const CSV_PATH = join(process.cwd(), "prisma", "data", "inventory-reset", "01_product_catalog.csv");
const OVERRIDES_PATH = join(process.cwd(), "prisma", "data", "catalog-overrides.json");
export const MERGED_MARK = "Merged into";

// Human-editable consolidation overrides (prisma/data/catalog-overrides.json).
// forceMerge: name/item# -> canonical name to fold it into (incl. the owner's
// all-caps junk rows). keepSeparate: pairs that must never merge. rename: canonical
// display-name overrides. Edited directly, or by Claude from docs/CATALOG-NOTES.md.
type Overrides = { forceMerge: Record<string, string>; keepSeparate: [string, string][]; rename: Record<string, string> };
function loadOverrides(): Overrides {
  try {
    const raw = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")) as Record<string, unknown>;
    const fm = (raw.forceMerge ?? {}) as Record<string, string>;
    const forceMerge: Record<string, string> = {};
    for (const [k, v] of Object.entries(fm)) if (!k.startsWith("_") && typeof v === "string") forceMerge[k] = v;
    const ks = (raw.keepSeparate ?? {}) as { pairs?: [string, string][] };
    const rn = (raw.rename ?? {}) as Record<string, string>;
    const rename: Record<string, string> = {};
    for (const [k, v] of Object.entries(rn)) if (!k.startsWith("_") && !k.startsWith("example") && typeof v === "string") rename[k] = v;
    return { forceMerge, keepSeparate: Array.isArray(ks.pairs) ? ks.pairs : [], rename };
  } catch {
    return { forceMerge: {}, keepSeparate: [], rename: {} };
  }
}

type CsvRow = Record<string, string>;
function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ""; }
    } else field += c;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** Infer a canonical UoM code from an owner product name when we have nothing better. */
function inferUom(name: string): string {
  const n = name.toLowerCase();
  if (/\baerosol|wasp.*freeze|spray can|pressurized|17\.5 oz|14 oz can\b/.test(n)) return "AC";
  if (/\bgel bait|gm tube|syringe|tube\b/.test(n)) return "T";
  if (/\bbait (block|station)|station\b/.test(n)) return "BS";
  if (/\bsnap trap|trap\b/.test(n)) return "RT";
  if (/\b2\.5 gal|1 gal|gallon|liquid.*gal\b/.test(n)) return "J";
  if (/\bqt\.|quart\b/.test(n)) return "QT";
  if (/\bpt\.|pint\b/.test(n)) return "PT";
  if (/\b50 ?lb|40 ?lb|30 ?lb|25 ?lb|granular|fertilizer|bag\b/.test(n)) return "FB";
  if (/\blb\.?\b/.test(n)) return "LB";
  if (/\boz\.?\b/.test(n)) return "OZ";
  return "EA";
}

type Survivor = { id: string; name: string };

export async function reconcileCanonicalCatalog(prisma: PrismaClient, opts: { apply: boolean }): Promise<{
  canonical: number; created: number; merged: number; demoted: number; log: string[];
}> {
  const apply = opts.apply;
  const result = { canonical: 0, created: 0, merged: 0, demoted: 0, log: [] as string[] };
  const csv = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const overrides = loadOverrides();
  const renameFor = (name: string) => overrides.rename[name] ?? name;
  // keepSeparate as a set of normalized unordered pairs.
  const keepSep = new Set(overrides.keepSeparate.map(([a, b]) => [normalizeProductName(a), normalizeProductName(b)].sort().join("||")));
  const isSeparated = (a: string, b: string) => keepSep.has([normalizeProductName(a), normalizeProductName(b)].sort().join("||"));

  // Canonical rows = every master row EXCEPT the flagged junk/dup rows (handled via
  // overrides.forceMerge). Rows missing an item # or cost are still real products
  // (e.g. Certainty, Termidor SC) — they just resolve by name/short-name.
  const canonRows = csv.filter((r) => r.inventory_product && !(r.inventory_product in overrides.forceMerge));
  const itemsOf = (r: CsvRow) => (r.siteone_item_numbers || "").split(",").map((s) => s.trim()).filter(Boolean);

  const existing = await prisma.product.findMany({
    select: { id: true, name: true, active: true, approved: true, confirmed: true, category: true, division: true, subdivision: true, unitOfMeasure: true, manufacturer: true, activeIngredient: true, epaRegNumber: true, sdsUrl: true, distributorSku: true, vendorItemNumbers: true, notes: true },
  });
  const byNorm = new Map(existing.map((p) => [normalizeProductName(p.name), p]));
  const byItem = new Map<string, (typeof existing)[number]>();
  for (const p of existing) {
    for (const it of [p.distributorSku, ...((p.vendorItemNumbers ?? "").split(","))]) {
      const t = (it ?? "").trim();
      if (t && !byItem.has(t)) byItem.set(t, p);
    }
  }

  // ── Phase 1: ensure a survivor product per canonical row ────────────────────
  const survivorByCanonName = new Map<string, Survivor>();
  for (const r of canonRows) {
    result.canonical++;
    const canonName = r.inventory_product;
    const name = renameFor(canonName); // display name (rename override applied)
    const items = itemsOf(r);
    const short = r.july_count_short_name?.trim();
    let found =
      items.map((it) => byItem.get(it)).find(Boolean) ||
      byNorm.get(normalizeProductName(canonName)) ||
      byNorm.get(normalizeProductName(name)) ||
      (short && short !== "Other Product" ? byNorm.get(normalizeProductName(short)) : undefined);

    const data = {
      name,
      approved: true, confirmed: true, active: true,
      category: r.category || found?.category || null,
      vendorItemNumbers: items.join(",") || found?.vendorItemNumbers || null,
      distributorSku: items[0] || found?.distributorSku || null,
      lastUnitCost: r.unit_cost ? Number(r.unit_cost) : undefined,
      unitOfMeasure: found && isUomCode(found.unitOfMeasure) ? found.unitOfMeasure : inferUom(name),
    };

    let survivorId: string;
    if (found) {
      survivorId = found.id;
      if (apply) await prisma.product.update({ where: { id: found.id }, data });
    } else {
      result.created++;
      if (apply) {
        const created = await prisma.product.create({ data: { ...data, lastUnitCost: data.lastUnitCost ?? null, notes: "Canonical catalog (owner master)." } });
        survivorId = created.id;
      } else survivorId = `preview:${name}`;
    }
    const survivor = { id: survivorId, name };
    survivorByCanonName.set(normalizeProductName(canonName), survivor);
    if (normalizeProductName(name) !== normalizeProductName(canonName)) survivorByCanonName.set(normalizeProductName(name), survivor);
  }

  // ── Build the resolver: any key → canonical survivor ────────────────────────
  const resolve = new Map<string, Survivor>();
  const put = (key: string | null | undefined, s: Survivor) => { const k = (key ?? "").trim(); if (k) resolve.set(k.toLowerCase(), s); const n = normalizeProductName(key); if (n) resolve.set(`n:${n}`, s); };
  for (const r of canonRows) {
    const s = survivorByCanonName.get(normalizeProductName(r.inventory_product));
    if (!s) continue;
    put(r.inventory_product, s);
    for (const it of itemsOf(r)) resolve.set(it.toLowerCase(), s);
    const short = r.july_count_short_name?.trim();
    if (short && short !== "Other Product") put(short, s);
  }
  // Human overrides: forceMerge maps a name OR item # → the canonical it folds into.
  for (const [key, canon] of Object.entries(overrides.forceMerge)) {
    const s = survivorByCanonName.get(normalizeProductName(canon)) ?? resolve.get(`n:${normalizeProductName(canon)}`);
    if (s) put(key, s); // registers both the raw key (e.g. an item #) and its normalized name
  }
  // PestPac aliases: alias value is a short/approved name → map to its canonical survivor.
  for (const [aliasKey, aliasVal] of Object.entries(PRODUCT_ALIASES)) {
    const s = resolve.get(`n:${normalizeProductName(aliasVal)}`);
    if (s) resolve.set(`n:${normalizeProductName(aliasKey)}`, s);
  }

  const survivorIds = new Set([...survivorByCanonName.values()].map((s) => s.id));
  const resolveProduct = (p: (typeof existing)[number]): Survivor | undefined => {
    for (const it of [p.distributorSku, ...((p.vendorItemNumbers ?? "").split(","))]) {
      const t = (it ?? "").trim().toLowerCase();
      if (t && resolve.has(t)) return resolve.get(t);
    }
    return resolve.get(`n:${normalizeProductName(p.name)}`);
  };

  // ── Phase 2: merge every non-survivor that resolves to a canonical ──────────
  for (const p of existing) {
    if (!p.active || survivorIds.has(p.id)) continue;
    if ((p.notes ?? "").includes(MERGED_MARK)) continue;
    const s = resolveProduct(p);
    if (!s || s.id === p.id || s.id.startsWith("preview:")) continue;
    // Honor keep-separate: never fold a row into a product it's explicitly kept apart from.
    if (isSeparated(p.name, s.name)) { result.log.push(`SKIP (keep-separate) "${p.name}" ✗ "${s.name}"`); continue; }
    result.merged++;
    result.log.push(`"${p.name}" (${p.id}) → "${s.name}"`);
    if (!apply) continue;
    // Enrich the survivor from this row where the survivor is missing data.
    const survivor = await prisma.product.findUnique({ where: { id: s.id } });
    if (survivor) {
      const enrich: Record<string, unknown> = {};
      if (!survivor.division && p.division) { enrich.division = p.division; enrich.subdivision = p.subdivision; }
      if ((!survivor.unitOfMeasure || !isUomCode(survivor.unitOfMeasure)) && isUomCode(p.unitOfMeasure)) enrich.unitOfMeasure = p.unitOfMeasure;
      if (!survivor.manufacturer && p.manufacturer) enrich.manufacturer = p.manufacturer;
      if (!survivor.activeIngredient && p.activeIngredient) enrich.activeIngredient = p.activeIngredient;
      if (!survivor.epaRegNumber && p.epaRegNumber) enrich.epaRegNumber = p.epaRegNumber;
      if (!survivor.sdsUrl && p.sdsUrl) enrich.sdsUrl = p.sdsUrl;
      if (Object.keys(enrich).length) await prisma.product.update({ where: { id: s.id }, data: enrich });
    }
    await prisma.$transaction([
      prisma.invoiceLine.updateMany({ where: { productId: p.id }, data: { productId: s.id } }),
      prisma.stockMovement.updateMany({ where: { productId: p.id }, data: { productId: s.id } }),
      prisma.productBarcode.updateMany({ where: { productId: p.id }, data: { productId: s.id } }),
      prisma.checkoutLine.updateMany({ where: { productId: p.id }, data: { productId: s.id } }),
      prisma.product.update({ where: { id: p.id }, data: { active: false, confirmed: true, approved: false, notes: [p.notes, `${MERGED_MARK} "${s.name}" by canonical catalog reconcile.`].filter(Boolean).join(" ") } }),
    ]);
  }

  // ── Phase 3: demote leftover active non-canonical rows to off-catalog ───────
  const refreshed = await prisma.product.findMany({ where: { active: true, approved: true }, select: { id: true, name: true, notes: true } });
  for (const p of refreshed) {
    if (survivorIds.has(p.id)) continue;
    result.demoted++;
    if (apply) await prisma.product.update({ where: { id: p.id }, data: { approved: false } });
  }

  return result;
}
