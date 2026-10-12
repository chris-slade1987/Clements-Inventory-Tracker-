import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { normalizeProductName } from "@/lib/product-aliases";
import { categorizeProduct } from "@/lib/constants";
import { uomCode } from "@/lib/uom";
import { SITEONE_ALIASES, SURCHARGE_ITEMS } from "@/lib/invoice/siteone-aliases";

// Catalog CSV import — ADD/UPDATE products from the committed SiteOne line-item
// files (prisma/data/purchase-invoices/*.json, parsed from the owner's SiteOne
// line-item CSVs). The catalog is already seeded from these, so this must ADD or
// UPDATE in place — never duplicate.
//
// One Product per distinct item_number. Fuel-surcharge item #s and negative /
// credit-memo lines are excluded. distributorSku + category + UoM are set.
// Product has NO lastUnitCost field, so cost context is read but not stored.
//
// Idempotent: a re-run produces ZERO changes (acceptance test 11). Existing
// products are matched by distributorSku/item#, then by the SiteOne alias name,
// then by normalized name; a genuinely-new one is created approved=false,
// confirmed=false (the same confirm gate as invoice auto-adds). Updates are
// diffed so an unchanged field is never rewritten.

const DATA_DIR = join(process.cwd(), "prisma", "data", "purchase-invoices");

type JsonLine = {
  line: number | string;
  itemNumber: string;
  description: string;
  uom: string;
  qtyShipped: number;
  netUnitPrice: number;
  extPrice: number;
  category: string;
  subcategory: string;
};
type JsonInvoice = { invoiceNumber: string; invoiceDate: string; branch: string; subtotalShipped: number; lines: JsonLine[] };
type JsonDoc = { vendor: string; invoices: JsonInvoice[] };

type Aggregated = {
  itemNumber: string;
  description: string;
  uom: string;
  category: string;
  subcategory: string;
  latestDate: string;
  latestNetUnitPrice: number | null;
};

export type CatalogImportRow = {
  itemNumber: string;
  name: string;
  action: "created" | "updated" | "unchanged";
  productId?: string;
  changes?: string[];
};

export type CatalogImportReport = {
  applied: boolean;
  files: string[];
  distinctItems: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedSurcharge: number;
  skippedCredit: number;
  rows: CatalogImportRow[];
};

/** Title-case a SiteOne ALL-CAPS description into a usable catalog name. */
function nameFromDescription(desc: string): string {
  const cleaned = desc
    .replace(/\s+/g, " ")
    .trim()
    // Drop a trailing size/packaging clause so the name stays about the product.
    .replace(/\s+\d+(\.\d+)?\s*(OZ|FL OZ|LB|GM|G|GAL|QT|PT|ML|L)\b.*$/i, "")
    .trim();
  const base = (cleaned || desc.trim()).slice(0, 80);
  return base
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}

/** Aggregate every priced, shipped, non-surcharge line to one row per item #. */
function aggregate(docs: JsonDoc[]): { items: Map<string, Aggregated>; skippedSurcharge: number; skippedCredit: number } {
  const items = new Map<string, Aggregated>();
  let skippedSurcharge = 0;
  let skippedCredit = 0;
  for (const doc of docs) {
    for (const inv of doc.invoices ?? []) {
      for (const l of inv.lines ?? []) {
        const item = (l.itemNumber ?? "").trim();
        if (!item) continue;
        if (SURCHARGE_ITEMS.has(item)) {
          skippedSurcharge++;
          continue;
        }
        // Exclude credit memos / negative lines — they don't define a product.
        if ((l.qtyShipped ?? 0) < 0 || (l.extPrice ?? 0) < 0 || (l.netUnitPrice ?? 0) < 0) {
          skippedCredit++;
          continue;
        }
        const existing = items.get(item);
        const price = Number.isFinite(l.netUnitPrice) ? l.netUnitPrice : null;
        if (!existing) {
          items.set(item, {
            itemNumber: item,
            description: l.description ?? "",
            uom: l.uom ?? "",
            category: l.category ?? "",
            subcategory: l.subcategory ?? "",
            latestDate: inv.invoiceDate ?? "",
            latestNetUnitPrice: price,
          });
        } else {
          // Keep the longest description + the latest-dated price.
          if ((l.description ?? "").length > existing.description.length) existing.description = l.description;
          if ((inv.invoiceDate ?? "") >= existing.latestDate) {
            existing.latestDate = inv.invoiceDate ?? existing.latestDate;
            if (price != null) existing.latestNetUnitPrice = price;
          }
        }
      }
    }
  }
  return { items, skippedSurcharge, skippedCredit };
}

/**
 * Run the catalog import. `apply: false` (default) previews; `apply: true` writes.
 * Always idempotent — a second apply reports every row as "unchanged".
 */
export async function importCatalog(
  prisma: PrismaClient,
  opts: { apply?: boolean } = {},
): Promise<CatalogImportReport> {
  const apply = opts.apply === true;
  const files = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort()
    : [];
  const docs: JsonDoc[] = files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")) as JsonDoc);

  const { items, skippedSurcharge, skippedCredit } = aggregate(docs);

  // Load the catalog once for name/SKU matching.
  const products = await prisma.product.findMany();
  const bySku = new Map<string, (typeof products)[number]>();
  const byName = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    if (p.distributorSku) bySku.set(p.distributorSku.trim(), p);
    byName.set(normalizeProductName(p.name), p);
  }

  const rows: CatalogImportRow[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [item, agg] of [...items.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const aliasName = SITEONE_ALIASES[item] ?? null;
    const resolvedName = aliasName ?? nameFromDescription(agg.description);
    const normResolved = normalizeProductName(resolvedName);

    // Match: distributorSku === item #, then alias/resolved name.
    const match = bySku.get(item) ?? byName.get(normResolved);

    const uom = uomCode(agg.uom) ?? "EA";
    const category = categorizeProduct(resolvedName, "", "", uom);

    if (match) {
      const changes: string[] = [];
      const data: Record<string, unknown> = {};
      if (!match.distributorSku) {
        data.distributorSku = item;
        changes.push(`distributorSku=${item}`);
      }
      if (!match.category) {
        data.category = category;
        changes.push(`category=${category}`);
      }
      if (!match.unitOfMeasure || !uomCode(match.unitOfMeasure)) {
        data.unitOfMeasure = uom;
        changes.push(`unit=${uom}`);
      }
      if (changes.length === 0) {
        unchanged++;
        rows.push({ itemNumber: item, name: match.name, action: "unchanged", productId: match.id });
        continue;
      }
      if (apply) await prisma.product.update({ where: { id: match.id }, data });
      updated++;
      rows.push({ itemNumber: item, name: match.name, action: "updated", productId: match.id, changes });
    } else {
      if (apply) {
        const createdProduct = await prisma.product.create({
          data: {
            name: resolvedName,
            unitOfMeasure: uom,
            category,
            distributorSku: item,
            approved: false,
            confirmed: false,
            active: true,
            notes: `Added from SiteOne catalog CSV import (item ${item}) — confirm naming/UoM/classification before check-out.`,
          },
        });
        // Keep in-memory maps current so a duplicate item # in the same run matches.
        bySku.set(item, createdProduct);
        byName.set(normResolved, createdProduct);
        rows.push({ itemNumber: item, name: resolvedName, action: "created", productId: createdProduct.id });
      } else {
        rows.push({ itemNumber: item, name: resolvedName, action: "created" });
      }
      created++;
    }
  }

  return {
    applied: apply,
    files,
    distinctItems: items.size,
    created,
    updated,
    unchanged,
    skippedSurcharge,
    skippedCredit,
    rows,
  };
}
