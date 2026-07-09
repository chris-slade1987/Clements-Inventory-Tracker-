import { prisma } from "@/lib/prisma";

export type ReportFilters = {
  from?: Date;
  to?: Date;
  productId?: string;
  warehouseId?: string;
};

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
  byWarehouse: Record<string, number>;
  total: number;
};

/** Current on-hand per product per warehouse (for the on-hand table). */
export async function onHandByProduct(
  f: Pick<ReportFilters, "productId" | "warehouseId">
): Promise<ProductRow[]> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    where: {
      productId: f.productId ?? undefined,
      warehouseId: f.warehouseId ?? undefined,
    },
    _sum: { quantity: true },
  });

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, unitOfMeasure: true },
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

export function parseFilters(sp: Record<string, string | undefined>): ReportFilters {
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : undefined;
  return {
    from: from && !isNaN(from.getTime()) ? from : undefined,
    to: to && !isNaN(to.getTime()) ? to : undefined,
    productId: sp.productId || undefined,
    warehouseId: sp.warehouseId || undefined,
  };
}
