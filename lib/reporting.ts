import { prisma } from "@/lib/prisma";

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
        unit: p.unitOfMeasure,
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

/** Top technicians by product consumed (check_out) in a range, valued via cost map. */
export async function topTechniciansByUsage(
  from: Date,
  to: Date | undefined,
  cost: Map<string, number>,
  limit = 8,
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
