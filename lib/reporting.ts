import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";
import { DIVISIONS, SUBDIVISIONS } from "@/lib/constants";

export type ReportFilters = {
  from?: Date;
  to?: Date;
  productId?: string;
  warehouseId?: string;
  category?: string;
};

/** Relation filter fragment applied to movement/invoice-line queries. */
function productFilter(f: ReportFilters) {
  return f.category ? { category: f.category } : undefined;
}

function dateWhere(f: ReportFilters) {
  if (!f.from && !f.to) return undefined;
  return {
    ...(f.from ? { gte: f.from } : {}),
    ...(f.to ? { lte: f.to } : {}),
  };
}

export type WarehouseMetrics = {
  purchasedQty: number;
  purchasedValue: number;
  dispersedQty: number;
  onHandQty: number;
};

/**
 * Purchased (from confirmed invoices) and dispersed (check_out movements) are
 * bounded by the date range; on-hand is always current (sum of all movements).
 * All three respect the optional product and warehouse filters.
 */
export async function warehouseMetrics(
  f: ReportFilters
): Promise<Map<string, WarehouseMetrics>> {
  const df = dateWhere(f);
  const metrics = new Map<string, WarehouseMetrics>();
  const ensure = (id: string) => {
    if (!metrics.has(id))
      metrics.set(id, {
        purchasedQty: 0,
        purchasedValue: 0,
        dispersedQty: 0,
        onHandQty: 0,
      });
    return metrics.get(id)!;
  };

  // PURCHASED — confirmed invoice lines (invoice carries the warehouse + date).
  const invLines = await prisma.invoiceLine.findMany({
    where: {
      productId: f.productId ?? undefined,
      product: productFilter(f),
      invoice: {
        status: "confirmed",
        warehouseId: f.warehouseId ?? undefined,
        ...(df ? { invoiceDate: df } : {}),
      },
    },
    select: {
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      invoice: { select: { warehouseId: true } },
    },
  });
  for (const l of invLines) {
    const m = ensure(l.invoice.warehouseId);
    m.purchasedQty += l.quantity;
    m.purchasedValue += l.lineTotal ?? l.quantity * (l.unitPrice ?? 0);
  }

  // DISPERSED — check_out movements (stored negative → flip sign).
  const outs = await prisma.stockMovement.groupBy({
    by: ["warehouseId"],
    where: {
      type: "check_out",
      productId: f.productId ?? undefined,
      product: productFilter(f),
      warehouseId: f.warehouseId ?? undefined,
      ...(df ? { createdAt: df } : {}),
    },
    _sum: { quantity: true },
  });
  for (const o of outs) {
    ensure(o.warehouseId).dispersedQty += -(o._sum.quantity ?? 0);
  }

  // ON-HAND — current, all movement types (not date-bounded).
  const onHand = await prisma.stockMovement.groupBy({
    by: ["warehouseId"],
    where: {
      productId: f.productId ?? undefined,
      product: productFilter(f),
      warehouseId: f.warehouseId ?? undefined,
    },
    _sum: { quantity: true },
  });
  for (const h of onHand) {
    ensure(h.warehouseId).onHandQty += h._sum.quantity ?? 0;
  }

  return metrics;
}

export type WarehouseProductRow = {
  productId: string;
  name: string;
  unit: string;
  purchasedQty: number;
  purchasedValue: number;
  dispersedQty: number;
  dispersedValue: number;
  onHandQty: number;
};

/**
 * Per-warehouse, per-product breakdown for the warehouse summary. Each product
 * line shows what came in (purchased qty + $) and went out (dispersed qty + $)
 * this window, plus current on-hand. Purchased/dispersed respect the date
 * range; on-hand is current. Dispersed $ is valued at the product's cost.
 */
export async function warehouseProductBreakdown(
  f: ReportFilters,
  cost: Map<string, number>
): Promise<Map<string, WarehouseProductRow[]>> {
  const df = dateWhere(f);
  const byWh = new Map<string, Map<string, WarehouseProductRow>>();
  const ensure = (w: string, p: string) => {
    if (!byWh.has(w)) byWh.set(w, new Map());
    const inner = byWh.get(w)!;
    if (!inner.has(p))
      inner.set(p, { productId: p, name: "", unit: "", purchasedQty: 0, purchasedValue: 0, dispersedQty: 0, dispersedValue: 0, onHandQty: 0 });
    return inner.get(p)!;
  };

  // PURCHASED — confirmed invoice lines.
  const invLines = await prisma.invoiceLine.findMany({
    where: {
      productId: f.productId ?? undefined,
      product: productFilter(f),
      invoice: { status: "confirmed", warehouseId: f.warehouseId ?? undefined, ...(df ? { invoiceDate: df } : {}) },
    },
    select: { productId: true, quantity: true, unitPrice: true, lineTotal: true, invoice: { select: { warehouseId: true } } },
  });
  for (const l of invLines) {
    if (!l.productId) continue; // unmatched invoice lines aren't stocked
    const r = ensure(l.invoice.warehouseId, l.productId);
    r.purchasedQty += l.quantity;
    r.purchasedValue += l.lineTotal ?? l.quantity * (l.unitPrice ?? 0);
  }

  // DISPERSED — check_out movements (stored negative).
  const outs = await prisma.stockMovement.groupBy({
    by: ["warehouseId", "productId"],
    where: { type: "check_out", productId: f.productId ?? undefined, product: productFilter(f), warehouseId: f.warehouseId ?? undefined, ...(df ? { createdAt: df } : {}) },
    _sum: { quantity: true },
  });
  for (const o of outs) {
    const r = ensure(o.warehouseId, o.productId);
    const q = -(o._sum.quantity ?? 0);
    r.dispersedQty += q;
    r.dispersedValue += q * (cost.get(o.productId) ?? 0);
  }

  // ON-HAND — current (all movement types).
  const onHand = await prisma.stockMovement.groupBy({
    by: ["warehouseId", "productId"],
    where: { productId: f.productId ?? undefined, product: productFilter(f), warehouseId: f.warehouseId ?? undefined },
    _sum: { quantity: true },
  });
  for (const h of onHand) ensure(h.warehouseId, h.productId).onHandQty += h._sum.quantity ?? 0;

  // Resolve names/units and drop empty rows.
  const pids = new Set<string>();
  for (const inner of byWh.values()) for (const pid of inner.keys()) pids.add(pid);
  const products = await prisma.product.findMany({ where: { id: { in: [...pids] } }, select: { id: true, name: true, unitOfMeasure: true } });
  const pById = new Map(products.map((p) => [p.id, p]));

  const out = new Map<string, WarehouseProductRow[]>();
  for (const [w, inner] of byWh) {
    const rows = [...inner.values()]
      .map((r) => ({ ...r, name: pById.get(r.productId)?.name ?? "Unknown", unit: uomLabel(pById.get(r.productId)?.unitOfMeasure) }))
      .filter((r) => r.purchasedQty > 0 || Math.abs(r.dispersedQty) > 1e-6 || Math.abs(r.onHandQty) > 1e-6)
      .sort((a, b) => a.name.localeCompare(b.name));
    out.set(w, rows);
  }
  return out;
}

export type ProductRow = {
  productId: string;
  name: string;
  unit: string;
  category: string;
  byWarehouse: Record<string, number>;
  total: number;
};

/** Current on-hand per product per warehouse (for the on-hand table). */
export async function onHandByProduct(
  f: Pick<ReportFilters, "productId" | "warehouseId" | "category">
): Promise<ProductRow[]> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    where: {
      productId: f.productId ?? undefined,
      product: f.category ? { category: f.category } : undefined,
      warehouseId: f.warehouseId ?? undefined,
    },
    _sum: { quantity: true },
  });

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, unitOfMeasure: true, category: true },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  const byProduct = new Map<string, ProductRow>();
  for (const r of rows) {
    const p = pById.get(r.productId);
    if (!p) continue;
    if (!byProduct.has(r.productId)) {
      byProduct.set(r.productId, {
        productId: r.productId,
        name: p.name,
        unit: uomLabel(p.unitOfMeasure),
        category: p.category ?? "Other",
        byWarehouse: {},
        total: 0,
      });
    }
    const row = byProduct.get(r.productId)!;
    const q = r._sum.quantity ?? 0;
    row.byWarehouse[r.warehouseId] = q;
    row.total += q;
  }

  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---- On-hand by line of service (division / subdivision) ----------------
export type DivisionOnHand = {
  division: string; // canonical code, or "UNCLASSIFIED"
  products: number; // distinct products with on-hand > 0
  qty: number; // total on-hand units
  subdivisions: { subdivision: string; products: number; qty: number }[];
};

/**
 * Current on-hand (SUM of movements per product) rolled up by division and
 * subdivision. Point-in-time snapshot — never date-bounded. Scoped to a branch
 * when `warehouseId` is given. Only products with positive on-hand are counted.
 */
export async function onHandByDivision(warehouseId?: string): Promise<DivisionOnHand[]> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { warehouseId: warehouseId ?? undefined },
    _sum: { quantity: true },
  });
  const withStock = rows
    .map((r) => ({ productId: r.productId, qty: r._sum.quantity ?? 0 }))
    .filter((r) => r.qty > 0);
  if (withStock.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: withStock.map((r) => r.productId) } },
    select: { id: true, division: true, subdivision: true },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  const byDiv = new Map<string, { products: number; qty: number; subs: Map<string, { products: number; qty: number }> }>();
  for (const r of withStock) {
    const p = pById.get(r.productId);
    const division = p?.division ?? "UNCLASSIFIED";
    const subdivision = p?.subdivision ?? "—";
    if (!byDiv.has(division)) byDiv.set(division, { products: 0, qty: 0, subs: new Map() });
    const d = byDiv.get(division)!;
    d.products += 1;
    d.qty += r.qty;
    if (!d.subs.has(subdivision)) d.subs.set(subdivision, { products: 0, qty: 0 });
    const s = d.subs.get(subdivision)!;
    s.products += 1;
    s.qty += r.qty;
  }

  return [...byDiv.entries()].map(([division, d]) => ({
    division,
    products: d.products,
    qty: d.qty,
    subdivisions: [...d.subs.entries()]
      .map(([subdivision, s]) => ({ subdivision, products: s.products, qty: s.qty }))
      .sort((a, b) => b.qty - a.qty),
  }));
}

// ---- Consolidated ledger: line of service → subcategory → product ------
// One hierarchy carrying, per product, current on-hand (point-in-time, all
// movements) plus purchased (check_in) and dispersed (abs check_out) for the
// selected window. Rolled up at subdivision + division level. This is the
// single source for the dashboard's "On-hand by line of service" panel and
// replaces the separate on-hand-matrix and product-movement views.
export type LedgerProduct = {
  productId: string;
  name: string;
  unit: string | null;
  onHand: number;
  purchased: number;
  dispersed: number;
};
export type LedgerSub = {
  subdivision: string;
  onHand: number;
  purchased: number;
  dispersed: number;
  products: LedgerProduct[];
};
export type DivisionLedger = {
  division: string; // canonical code, or "UNCLASSIFIED"
  onHand: number;
  purchased: number;
  dispersed: number;
  productCount: number;
  subdivisions: LedgerSub[];
};

const LEDGER_OTHER_SUB = "Other"; // trailing bucket for products with no subdivision

/**
 * Product ledger grouped by division → subdivision. For each active product:
 *  - onHand    = SUM of ALL movements (point-in-time; NOT window-bounded)
 *  - purchased = check_in quantity within [from, to]
 *  - dispersed = |check_out quantity| within [from, to]
 * A product row is INCLUDED when it has nonzero on-hand OR moved (purchased or
 * dispersed) in the window, so "what moved" shows even at zero on-hand. Scoped
 * to a branch when `warehouseId` is given. Divisions sort by DIVISIONS order
 * (Unclassified last); subdivisions by SUBDIVISIONS order ("Other" last);
 * products by name. Aggregated in memory — no N+1.
 */
export async function productLedgerByDivision(
  from: Date,
  to: Date,
  warehouseId?: string
): Promise<DivisionLedger[]> {
  const [products, onHandRows, purchasedRows, dispersedRows] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      select: { id: true, name: true, unitOfMeasure: true, division: true, subdivision: true },
    }),
    // ON-HAND — current, all movement types (not date-bounded).
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { warehouseId: warehouseId ?? undefined },
      _sum: { quantity: true },
    }),
    // PURCHASED — check_in quantity within the window.
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { type: "check_in", warehouseId: warehouseId ?? undefined, createdAt: { gte: from, lte: to } },
      _sum: { quantity: true },
    }),
    // DISPERSED — check_out quantity within the window (stored negative).
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { type: "check_out", warehouseId: warehouseId ?? undefined, createdAt: { gte: from, lte: to } },
      _sum: { quantity: true },
    }),
  ]);

  const onHand = new Map<string, number>();
  for (const r of onHandRows) onHand.set(r.productId, r._sum.quantity ?? 0);
  const purchased = new Map<string, number>();
  for (const r of purchasedRows) purchased.set(r.productId, r._sum.quantity ?? 0);
  const dispersed = new Map<string, number>();
  for (const r of dispersedRows) dispersed.set(r.productId, Math.abs(r._sum.quantity ?? 0));

  const EPS = 1e-6;
  type SubAgg = { subdivision: string; onHand: number; purchased: number; dispersed: number; products: LedgerProduct[] };
  type DivAgg = { division: string; onHand: number; purchased: number; dispersed: number; subs: Map<string, SubAgg> };
  const byDiv = new Map<string, DivAgg>();

  for (const p of products) {
    const oh = onHand.get(p.id) ?? 0;
    const pu = purchased.get(p.id) ?? 0;
    const di = dispersed.get(p.id) ?? 0;
    if (Math.abs(oh) < EPS && pu < EPS && di < EPS) continue; // nothing on hand, nothing moved

    const division = p.division ?? "UNCLASSIFIED";
    const subdivision = p.subdivision ?? LEDGER_OTHER_SUB;
    if (!byDiv.has(division)) byDiv.set(division, { division, onHand: 0, purchased: 0, dispersed: 0, subs: new Map() });
    const d = byDiv.get(division)!;
    d.onHand += oh; d.purchased += pu; d.dispersed += di;
    if (!d.subs.has(subdivision)) d.subs.set(subdivision, { subdivision, onHand: 0, purchased: 0, dispersed: 0, products: [] });
    const s = d.subs.get(subdivision)!;
    s.onHand += oh; s.purchased += pu; s.dispersed += di;
    s.products.push({ productId: p.id, name: p.name, unit: uomLabel(p.unitOfMeasure) || null, onHand: oh, purchased: pu, dispersed: di });
  }

  const known = DIVISIONS as readonly string[];
  const divOrder = (code: string) => {
    const i = known.indexOf(code);
    return i === -1 ? known.length + 1 : i; // unknown / UNCLASSIFIED trail the canonical order
  };
  const subOrder = (division: string, sub: string) => {
    if (sub === LEDGER_OTHER_SUB) return 1e6; // trailing "Other" bucket last
    const list = (SUBDIVISIONS as Record<string, string[]>)[division] ?? [];
    const i = list.indexOf(sub);
    return i === -1 ? 1e5 : i;
  };

  return [...byDiv.values()]
    .sort((a, b) => divOrder(a.division) - divOrder(b.division) || a.division.localeCompare(b.division))
    .map((d) => ({
      division: d.division,
      onHand: d.onHand,
      purchased: d.purchased,
      dispersed: d.dispersed,
      productCount: [...d.subs.values()].reduce((n, s) => n + s.products.length, 0),
      subdivisions: [...d.subs.values()]
        .sort((a, b) => subOrder(d.division, a.subdivision) - subOrder(d.division, b.subdivision) || a.subdivision.localeCompare(b.subdivision))
        .map((s) => ({
          subdivision: s.subdivision,
          onHand: s.onHand,
          purchased: s.purchased,
          dispersed: s.dispersed,
          products: s.products.sort((x, y) => x.name.localeCompare(y.name)),
        })),
    }));
}

/** On-hand totals grouped by product category. */
export type CategoryRow = { category: string; qty: number };
export async function onHandByCategory(
  f: Pick<ReportFilters, "warehouseId" | "category">
): Promise<CategoryRow[]> {
  const rows = await onHandByProduct(f);
  const totals = new Map<string, number>();
  for (const r of rows) {
    totals.set(r.category, (totals.get(r.category) ?? 0) + r.total);
  }
  return [...totals.entries()]
    .map(([category, qty]) => ({ category, qty }))
    .sort((a, b) => b.qty - a.qty);
}

// ---- Dashboard: purchasing $ per warehouse for a date range ------------
export async function purchasedDollarsByWarehouse(
  from: Date,
  to?: Date
): Promise<Map<string, number>> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: { status: "confirmed", invoiceDate: { gte: from, ...(to ? { lte: to } : {}) } },
    },
    select: {
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      invoice: { select: { warehouseId: true } },
    },
  });
  const map = new Map<string, number>();
  for (const l of lines) {
    const v = l.lineTotal ?? l.quantity * (l.unitPrice ?? 0);
    map.set(l.invoice.warehouseId, (map.get(l.invoice.warehouseId) ?? 0) + v);
  }
  return map;
}

export type PurchasedProduct = { name: string; qty: number; value: number };

/** Products purchased (confirmed invoices) per warehouse within a range. */
export async function productsPurchasedByWarehouse(
  from: Date,
  to?: Date
): Promise<Map<string, PurchasedProduct[]>> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: { status: "confirmed", invoiceDate: { gte: from, ...(to ? { lte: to } : {}) } },
    },
    select: {
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      descriptionRaw: true,
      product: { select: { name: true } },
      invoice: { select: { warehouseId: true } },
    },
  });
  const byWh = new Map<string, Map<string, PurchasedProduct>>();
  for (const l of lines) {
    const wid = l.invoice.warehouseId;
    const name = l.product?.name ?? l.descriptionRaw;
    if (!byWh.has(wid)) byWh.set(wid, new Map());
    const inner = byWh.get(wid)!;
    const row = inner.get(name) ?? { name, qty: 0, value: 0 };
    row.qty += l.quantity;
    row.value += l.lineTotal ?? l.quantity * (l.unitPrice ?? 0);
    inner.set(name, row);
  }
  const out = new Map<string, PurchasedProduct[]>();
  for (const [wid, inner] of byWh) {
    out.set(wid, [...inner.values()].sort((a, b) => b.value - a.value));
  }
  return out;
}

export type ProductFlow = { name: string; purchased: number; dispersed: number; onHand: number };

/**
 * Per-product view, optionally scoped to one warehouse:
 *  - purchased  = quantity checked IN this window (confirmed receipts)
 *  - dispersed  = quantity checked OUT this window (to technicians)
 *  - onHand     = current stock (SUM of ALL movements, all-time — includes the
 *                 stock-count import, so this is accurate from day one even
 *                 before any invoices/check-outs are entered)
 * Returns every product that has stock on hand OR movement in the window,
 * most stock first. This is the "what we have / what moved" view.
 */
export async function productFlow(
  from: Date,
  to: Date | undefined,
  warehouseId?: string
): Promise<ProductFlow[]> {
  const [flowRows, onHandRows] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["productId", "type"],
      where: {
        type: { in: ["check_in", "check_out"] },
        warehouseId: warehouseId ?? undefined,
        createdAt: { gte: from, ...(to ? { lte: to } : {}) },
      },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { warehouseId: warehouseId ?? undefined },
      _sum: { quantity: true },
    }),
  ]);
  const byProduct = new Map<string, { purchased: number; dispersed: number; onHand: number }>();
  const ensure = (id: string) => {
    if (!byProduct.has(id)) byProduct.set(id, { purchased: 0, dispersed: 0, onHand: 0 });
    return byProduct.get(id)!;
  };
  for (const r of flowRows) {
    const cur = ensure(r.productId);
    const q = r._sum.quantity ?? 0;
    if (r.type === "check_in") cur.purchased += q;
    else cur.dispersed += Math.abs(q);
  }
  for (const r of onHandRows) ensure(r.productId).onHand = r._sum.quantity ?? 0;

  const ids = [...byProduct.keys()];
  if (ids.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return ids
    .map((id) => ({ name: nameById.get(id) ?? "Unknown", ...byProduct.get(id)! }))
    .filter((r) => r.purchased > 0 || r.dispersed > 0 || Math.abs(r.onHand) > 1e-6)
    .sort((a, b) => b.onHand - a.onHand || b.purchased + b.dispersed - (a.purchased + a.dispersed));
}

export type EmployeeDispersal = { technicianId: string; name: string; units: number; lines: number };

/** Dispersed (check_out) per employee per warehouse within a range. */
export async function dispersedByEmployeeByWarehouse(
  from: Date,
  to?: Date
): Promise<Map<string, EmployeeDispersal[]>> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["warehouseId", "technicianId"],
    where: { type: "check_out", createdAt: { gte: from, ...(to ? { lte: to } : {}) } },
    _sum: { quantity: true },
    _count: true,
  });
  const techIds = [...new Set(rows.map((r) => r.technicianId).filter(Boolean))] as string[];
  const techs = await prisma.technician.findMany({
    where: { id: { in: techIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(techs.map((t) => [t.id, t.name]));
  const out = new Map<string, EmployeeDispersal[]>();
  for (const r of rows) {
    if (!r.technicianId) continue;
    if (!out.has(r.warehouseId)) out.set(r.warehouseId, []);
    out.get(r.warehouseId)!.push({
      technicianId: r.technicianId,
      name: nameById.get(r.technicianId) ?? "Unknown",
      units: -(r._sum.quantity ?? 0),
      lines: r._count,
    });
  }
  for (const list of out.values()) list.sort((a, b) => b.units - a.units);
  return out;
}

// ---- Dollar valuation: latest known unit cost per product -------------
// Uses the most recent priced movement (check-in or stock-count import), so
// on-hand and dispersal can be valued in $ even before invoicing begins.
export async function productCostMap(): Promise<Map<string, number>> {
  const rows = await prisma.stockMovement.findMany({
    where: { unitPrice: { not: null } },
    select: { productId: true, unitPrice: true },
    orderBy: { createdAt: "asc" },
  });
  const m = new Map<string, number>();
  for (const r of rows) if (r.unitPrice != null) m.set(r.productId, r.unitPrice);
  return m;
}

export type Ranked = { key: string; label: string; value: number; qty: number };

/** Spend ($) by product category from confirmed invoices in a range. */
export async function spendByCategory(from: Date, to?: Date, warehouseId?: string): Promise<Ranked[]> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        status: "confirmed",
        warehouseId: warehouseId ?? undefined,
        invoiceDate: { gte: from, ...(to ? { lte: to } : {}) },
      },
    },
    select: {
      quantity: true, unitPrice: true, lineTotal: true,
      product: { select: { category: true } },
    },
  });
  const m = new Map<string, Ranked>();
  for (const l of lines) {
    const cat = l.product?.category ?? "Other";
    const v = l.lineTotal ?? l.quantity * (l.unitPrice ?? 0);
    const r = m.get(cat) ?? { key: cat, label: cat, value: 0, qty: 0 };
    r.value += v; r.qty += l.quantity;
    m.set(cat, r);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/** Top products by spend ($) from confirmed invoices in a range. */
export async function topProductsBySpend(from: Date, to: Date | undefined, limit = 8, warehouseId?: string): Promise<Ranked[]> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        status: "confirmed",
        warehouseId: warehouseId ?? undefined,
        invoiceDate: { gte: from, ...(to ? { lte: to } : {}) },
      },
    },
    select: { quantity: true, unitPrice: true, lineTotal: true, descriptionRaw: true, product: { select: { name: true } } },
  });
  const m = new Map<string, Ranked>();
  for (const l of lines) {
    const name = l.product?.name ?? l.descriptionRaw;
    const v = l.lineTotal ?? l.quantity * (l.unitPrice ?? 0);
    const r = m.get(name) ?? { key: name, label: name, value: 0, qty: 0 };
    r.value += v; r.qty += l.quantity;
    m.set(name, r);
  }
  return [...m.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

export type TechUsage = { name: string; branch: string; units: number; value: number; lines: number };

/**
 * Technicians by product consumed (check_out) in a range, valued via cost map,
 * sorted by value desc. `limit` caps the list; pass `undefined` for every
 * technician with usage in scope (see `allTechniciansByUsage`).
 */
export async function topTechniciansByUsage(
  from: Date,
  to: Date | undefined,
  cost: Map<string, number>,
  limit?: number,
  warehouseId?: string
): Promise<TechUsage[]> {
  const movements = await prisma.stockMovement.findMany({
    where: {
      type: "check_out",
      technicianId: { not: null },
      warehouseId: warehouseId ?? undefined,
      createdAt: { gte: from, ...(to ? { lte: to } : {}) },
    },
    select: {
      productId: true, quantity: true, technicianId: true,
      technician: { select: { name: true, homeWarehouse: { select: { name: true } } } },
    },
  });
  const m = new Map<string, TechUsage>();
  for (const mv of movements) {
    if (!mv.technicianId) continue;
    const units = -mv.quantity;
    const r = m.get(mv.technicianId) ?? {
      name: mv.technician?.name ?? "Unknown",
      branch: mv.technician?.homeWarehouse?.name ?? "—",
      units: 0, value: 0, lines: 0,
    };
    r.units += units;
    r.value += units * (cost.get(mv.productId) ?? 0);
    r.lines += 1;
    m.set(mv.technicianId, r);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || b.units - a.units).slice(0, limit);
}

/** Every technician with usage (check_out) in scope, valued via cost map, value desc — no limit. */
export async function allTechniciansByUsage(
  from: Date,
  to: Date | undefined,
  cost: Map<string, number>,
  warehouseId?: string
): Promise<TechUsage[]> {
  return topTechniciansByUsage(from, to, cost, undefined, warehouseId);
}

/** Dispersed (check_out) $ value per warehouse within a range, valued at cost. */
export async function dispersedValueByWarehouse(
  from: Date,
  to: Date | undefined,
  cost: Map<string, number>
): Promise<Map<string, number>> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["warehouseId", "productId"],
    where: { type: "check_out", createdAt: { gte: from, ...(to ? { lte: to } : {}) } },
    _sum: { quantity: true },
  });
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = Math.abs(r._sum.quantity ?? 0) * (cost.get(r.productId) ?? 0);
    m.set(r.warehouseId, (m.get(r.warehouseId) ?? 0) + v);
  }
  return m;
}

/** Current on-hand units + $ value per warehouse. */
export async function onHandValueByWarehouse(
  cost: Map<string, number>
): Promise<Map<string, { units: number; value: number }>> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["warehouseId", "productId"],
    _sum: { quantity: true },
  });
  const out = new Map<string, { units: number; value: number }>();
  for (const r of rows) {
    const q = r._sum.quantity ?? 0;
    const cur = out.get(r.warehouseId) ?? { units: 0, value: 0 };
    cur.units += q;
    cur.value += q * (cost.get(r.productId) ?? 0);
    out.set(r.warehouseId, cur);
  }
  return out;
}

/** Current on-hand $ value grouped by product category. */
export async function onHandValueByCategory(cost: Map<string, number>, warehouseId?: string): Promise<Ranked[]> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: warehouseId ? { warehouseId } : undefined,
    _sum: { quantity: true },
  });
  const productIds = rows.map((r) => r.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, category: true },
  });
  const catById = new Map(products.map((p) => [p.id, p.category ?? "Other"]));
  const m = new Map<string, Ranked>();
  for (const r of rows) {
    const cat = catById.get(r.productId) ?? "Other";
    const q = r._sum.quantity ?? 0;
    const rk = m.get(cat) ?? { key: cat, label: cat, value: 0, qty: 0 };
    rk.value += q * (cost.get(r.productId) ?? 0);
    rk.qty += q;
    m.set(cat, rk);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/** Top products on hand by $ value, optionally scoped to one warehouse. */
export async function topProductsOnHand(
  cost: Map<string, number>,
  warehouseId?: string,
  limit = 8
): Promise<Ranked[]> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: warehouseId ? { warehouseId } : undefined,
    _sum: { quantity: true },
  });
  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return rows
    .map((r) => {
      const q = r._sum.quantity ?? 0;
      return {
        key: r.productId,
        label: nameById.get(r.productId) ?? "Unknown",
        qty: q,
        value: q * (cost.get(r.productId) ?? 0),
      };
    })
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function parseFilters(sp: Record<string, string | undefined>): ReportFilters {
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : undefined;
  return {
    from: from && !isNaN(from.getTime()) ? from : undefined,
    to: to && !isNaN(to.getTime()) ? to : undefined,
    productId: sp.productId || undefined,
    warehouseId: sp.warehouseId || undefined,
    category: sp.category || undefined,
  };
}
