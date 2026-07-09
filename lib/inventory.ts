import { prisma } from "@/lib/prisma";

/**
 * On-hand quantity for a single product in a single warehouse.
 * = SUM(stock_movements.quantity) for that product+warehouse.
 */
export async function onHand(
  productId: string,
  warehouseId: string
): Promise<number> {
  const agg = await prisma.stockMovement.aggregate({
    _sum: { quantity: true },
    where: { productId, warehouseId },
  });
  return agg._sum.quantity ?? 0;
}

/**
 * On-hand for many products in one warehouse at once.
 * Returns a Map keyed by productId.
 */
export async function onHandByWarehouse(
  warehouseId: string
): Promise<Map<string, number>> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { warehouseId },
    _sum: { quantity: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.productId, r._sum.quantity ?? 0);
  return map;
}

/**
 * On-hand for every product+warehouse pair. Returns a nested Map:
 * warehouseId -> (productId -> qty).
 */
export async function onHandMatrix(): Promise<
  Map<string, Map<string, number>>
> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["warehouseId", "productId"],
    _sum: { quantity: true },
  });
  const matrix = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!matrix.has(r.warehouseId)) matrix.set(r.warehouseId, new Map());
    matrix.get(r.warehouseId)!.set(r.productId, r._sum.quantity ?? 0);
  }
  return matrix;
}
