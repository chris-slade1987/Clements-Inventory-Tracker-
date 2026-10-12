import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onHandByWarehouse } from "@/lib/inventory";
import { resolveWarehouseId } from "@/lib/inventory-scope";
import { countedProductIds } from "@/lib/stock-count";
import { uomCode } from "@/lib/uom";
import StockClient from "./StockClient";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  if (user.role !== "admin" && user.role !== "manager") redirect("/me");

  const sp = await searchParams;
  const isAdmin = user.role === "admin";
  const warehouseId = (await resolveWarehouseId(user, sp.branch)) ?? "";

  const [warehouses, onHand, counted, lastMoves, products] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    warehouseId ? onHandByWarehouse(warehouseId) : Promise.resolve(new Map<string, number>()),
    warehouseId ? countedProductIds(warehouseId) : Promise.resolve(new Set<string>()),
    warehouseId
      ? prisma.stockMovement.groupBy({ by: ["productId"], where: { warehouseId }, _max: { createdAt: true } })
      : Promise.resolve([] as { productId: string; _max: { createdAt: Date | null } }[]),
    prisma.product.findMany({ select: { id: true, name: true, unitOfMeasure: true, distributorSku: true, category: true } }),
  ]);

  const lastById = new Map(lastMoves.map((m) => [m.productId, m._max.createdAt]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const rows = [...onHand.entries()]
    .map(([productId, qty]) => {
      const p = productById.get(productId);
      if (!p) return null;
      return {
        productId,
        name: p.name,
        unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
        distributorSku: p.distributorSku,
        category: p.category,
        onHand: qty,
        counted: counted.has(productId),
        lastMovement: lastById.get(productId)?.toISOString() ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Stock on hand" subtitle="Current on-hand by product for the branch, with last movement." />
      <InventorySubnav isAdmin={isAdmin} />
      <StockClient
        isAdmin={isAdmin}
        branchId={warehouseId}
        branchName={warehouses.find((w) => w.id === warehouseId)?.name ?? ""}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        rows={rows}
      />
    </>
  );
}
