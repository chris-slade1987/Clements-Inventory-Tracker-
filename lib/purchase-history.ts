// Historical purchase-data loader (Phase 2) — shared parser + resolver.
//
// ANALYSIS-ONLY. The four PestPac "Inventory Transfer History" exports (one per
// branch) are the authoritative structured record of what each warehouse
// received from a distributor between 2026-01-01 and 2026-07-20. They feed
// spend / price / purchasing analysis ONLY.
//
// The CEO sets on-hand by a physical month-end count, so this load MUST NOT
// change current on-hand. In this app:
//   - PURCHASED / spend metrics read from CONFIRMED Invoice lines
//     (see lib/reporting.ts: warehouseMetrics, purchasedDollarsByWarehouse,
//      spendByCategory, topProductsBySpend, …)
//   - ON-HAND reads from StockMovement.
// Therefore this loader creates Invoice + InvoiceLine rows (status "confirmed")
// and NEVER creates a StockMovement. On-hand is left untouched.
//
// Idempotent: every imported invoice gets a deterministic invoiceNumber prefixed
// "HIST-<BRANCH>-<YYYYMMDD>-<seq>". Re-running skips any invoice whose number is
// already present, so deploys never double-import.
//
// Source data lives in prisma/data/purchase-history/<slug>.json — a faithful
// row-for-row extract of each transfer report (footer/summary rows already
// dropped). This module parses the raw "quantity" (e.g. "8.0000 J") and "cost"
// (e.g. "$1,000.00") strings so the parsing logic stays here in one place.

import { PRODUCT_ALIASES, normalizeProductName } from "@/lib/product-aliases";
import { isUomCode } from "@/lib/uom";

export type HistoryReceipt = {
  date: string; // ISO "YYYY-MM-DD"
  source: string | null; // distributor
  destination: string | null;
  material: string | null;
  quantity: string | null; // raw, e.g. "8.0000 J"
  cost: string | null; // raw, e.g. "$1,000.00" or "237.5"
  transferredBy: string | null;
};

export type HistoryFile = {
  branchSlug: string;
  warehouse: string; // Warehouse.name
  source: string;
  receipts: HistoryReceipt[];
};

export type BranchConfig = { slug: string; warehouse: string; prefix: string; file: string };

// slug -> Warehouse.name (must match the seeded warehouse names exactly).
export const HISTORY_BRANCHES: BranchConfig[] = [
  { slug: "vero", warehouse: "Vero Beach (HQ)", prefix: "VERO", file: "vero.json" },
  { slug: "stuart", warehouse: "Stuart", prefix: "STU", file: "stuart.json" },
  { slug: "orlando", warehouse: "Orlando", prefix: "ORL", file: "orlando.json" },
  { slug: "naples", warehouse: "Naples", prefix: "NAP", file: "naples.json" },
];

/** Split a raw PestPac quantity like "8.0000 J" into { value, unit }. */
export function parseQuantity(raw: string | null | undefined): { value: number; unit: string | null } {
  const s = (raw ?? "").trim();
  if (!s) return { value: 0, unit: null };
  const m = s.match(/^([\d.,]+)\s+([A-Za-z0-9]+)$/);
  if (m) return { value: Number(m[1].replace(/,/g, "")), unit: m[2].toUpperCase() };
  const n = s.match(/^([\d.,]+)$/);
  if (n) return { value: Number(n[1].replace(/,/g, "")), unit: null };
  return { value: 0, unit: null };
}

/** Parse a raw cost string ("$1,000.00", "237.5") into a number, or null. */
export function parseCost(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A distributor name, treating blank / "None" as Unknown. */
export function normalizeDistributor(source: string | null | undefined): string {
  const s = (source ?? "").trim();
  if (!s || /^none$/i.test(s)) return "Unknown";
  return s;
}

/** UTC date from an ISO "YYYY-MM-DD" string (no timezone drift). */
export function historyDate(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(iso);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// Product index for resolution: normalized name and normalized SKU (Material Code).
export type ProductIndex = {
  byName: Map<string, { id: string; name: string }>;
  bySku: Map<string, { id: string; name: string }>;
};

export function buildProductIndex(
  products: { id: string; name: string; distributorSku: string | null }[]
): ProductIndex {
  const byName = new Map<string, { id: string; name: string }>();
  const bySku = new Map<string, { id: string; name: string }>();
  for (const p of products) {
    byName.set(normalizeProductName(p.name), { id: p.id, name: p.name });
    if (p.distributorSku) bySku.set(normalizeProductName(p.distributorSku), { id: p.id, name: p.name });
  }
  return { byName, bySku };
}

export type ResolveResult = {
  productId: string | null;
  productName: string | null;
  how: "alias" | "direct" | "sku" | "non_chemical" | "unmatched";
  aliasTarget?: string; // the approved name an alias pointed to (for reporting)
};

// The generic non-chemical catalog line (Part F). Must match the seed's
// NON_CHEMICAL_PRODUCT_NAME in prisma/seed-products-approved.ts.
export const NON_CHEMICAL_PRODUCT_NAME = "Non-Chemical Purchase";

// Keywords for clearly non-chemical line items (gloves, hose reels, tools, PPE,
// shop/office supplies). Deliberately conservative so a chemical is never
// misrouted here; chemical MISC catch-alls stay separate.
const NON_CHEMICAL_KEYWORDS = [
  "glove", "hose reel", "hose", "reel", "nozzle", "backpack sprayer", "sprayer part",
  "spray tip", "wand", "fitting", "gasket", "o-ring", "seal kit", "repair kit",
  "ppe", "respirator", "mask", "goggle", "face shield", "boot", "coverall", "apron",
  "uniform", "shirt", "hat", "safety", "first aid", "flashlight", "batter",
  "tarp", "ladder", "cooler", "gas can", "fuel can", "funnel", "bucket lid",
  "measuring cup", "office", "shop supply", "paper towel", "trash bag", "duct tape",
];

/** True when a material name looks like a clearly non-chemical purchase. */
export function isNonChemicalMaterial(name: string | null | undefined): boolean {
  const s = normalizeProductName(name);
  if (!s) return false;
  return NON_CHEMICAL_KEYWORDS.some((k) => s.includes(k));
}

/**
 * Resolve a transfer-history material name to an approved product, per the
 * contract in lib/product-aliases.ts: PRODUCT_ALIASES first, then a direct
 * normalized-name match, then the Material Code (distributorSku) hook.
 */
export function resolveHistoryMaterial(material: string | null | undefined, idx: ProductIndex): ResolveResult {
  const norm = normalizeProductName(material);
  if (!norm) return { productId: null, productName: null, how: "unmatched" };

  const aliasTarget = PRODUCT_ALIASES[norm];
  if (aliasTarget) {
    const hit = idx.byName.get(normalizeProductName(aliasTarget));
    if (hit) return { productId: hit.id, productName: hit.name, how: "alias", aliasTarget };
    // Alias points at a name with no product — treat as unmatched (never force).
    return { productId: null, productName: null, how: "unmatched", aliasTarget };
  }

  const direct = idx.byName.get(norm);
  if (direct) return { productId: direct.id, productName: direct.name, how: "direct" };

  const sku = idx.bySku.get(norm);
  if (sku) return { productId: sku.id, productName: sku.name, how: "sku" };

  // Part F: route clearly non-chemical items (gloves, hose reels, tools, PPE) to
  // the generic non-chemical line when it exists in the catalog.
  if (isNonChemicalMaterial(material)) {
    const nc = idx.byName.get(normalizeProductName(NON_CHEMICAL_PRODUCT_NAME));
    if (nc) return { productId: nc.id, productName: nc.name, how: "non_chemical" };
  }

  return { productId: null, productName: null, how: "unmatched" };
}

// ---------------------------------------------------------------------------
// Invoice grouping
// ---------------------------------------------------------------------------

export type BuiltLine = {
  material: string;
  productId: string | null;
  productName: string | null;
  how: ResolveResult["how"];
  aliasTarget?: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  anomaly?: string;
};

export type BuiltInvoice = {
  invoiceNumber: string;
  distributor: string;
  invoiceDate: Date;
  total: number;
  lines: BuiltLine[];
};

/** True for a fractional-unit quantity typo (e.g. 0.0078 J at a full-jug price). */
export function quantityAnomaly(qty: number, cost: number | null): string | undefined {
  if (qty > 0 && qty < 0.1) return `fractional quantity ${qty} at cost $${(cost ?? 0).toFixed(2)}`;
  return undefined;
}

/**
 * Group a branch's receipts into invoices, one per (date, distributor), and
 * resolve every line. Deterministic invoiceNumber so the load is idempotent.
 */
export function buildInvoices(file: HistoryFile, idx: ProductIndex, cfg: BranchConfig): BuiltInvoice[] {
  // group key -> receipts
  const groups = new Map<string, { date: string; distributor: string; receipts: HistoryReceipt[] }>();
  for (const r of file.receipts) {
    if (!r.date) continue;
    const distributor = normalizeDistributor(r.source);
    const key = `${r.date}__${distributor}`;
    if (!groups.has(key)) groups.set(key, { date: r.date, distributor, receipts: [] });
    groups.get(key)!.receipts.push(r);
  }

  // Order groups by date then distributor so the per-date seq is stable.
  const ordered = [...groups.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.distributor.localeCompare(b.distributor)
  );

  const seqByDate = new Map<string, number>();
  const invoices: BuiltInvoice[] = [];
  for (const g of ordered) {
    const ymd = g.date.replace(/-/g, "");
    const seq = (seqByDate.get(ymd) ?? 0) + 1;
    seqByDate.set(ymd, seq);
    const invoiceNumber = `HIST-${cfg.prefix}-${ymd}-${seq}`;

    const lines: BuiltLine[] = g.receipts.map((r) => {
      const { value, unit } = parseQuantity(r.quantity);
      const cost = parseCost(r.cost);
      const res = resolveHistoryMaterial(r.material, idx);
      const unitPrice = cost != null && value > 0 ? cost / value : null;
      return {
        material: r.material ?? "",
        productId: res.productId,
        productName: res.productName,
        how: res.how,
        aliasTarget: res.aliasTarget,
        quantity: value,
        unit: unit && isUomCode(unit) ? unit.toUpperCase() : unit,
        unitPrice,
        lineTotal: cost,
        anomaly: quantityAnomaly(value, cost),
      };
    });
    const total = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
    invoices.push({ invoiceNumber, distributor: g.distributor, invoiceDate: historyDate(g.date), total, lines });
  }
  return invoices;
}
