import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onHandByWarehouse } from "@/lib/inventory";
import { resolveWarehouseId } from "@/lib/inventory-scope";
import { countedProductIds } from "@/lib/stock-count";
import { uomCode } from "@/lib/uom";
import StockCountClient from "./StockCountClient";

export const dynamic = "force-dynamic";

export default async function StockCountPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  if (user.role !== "admin" && user.role !== "manager") redirect("/me");

  const sp = await searchParams;
  const isAdmin = user.role === "admin";
  const warehouseId = (await resolveWarehouseId(user, sp.branch)) ?? "";

  const [warehouses, products, onHand, counted] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ approved: "desc" }, { name: "asc" }] }),
    warehouseId ? onHandByWarehouse(warehouseId) : Promise.resolve(new Map<string, number>()),
    warehouseId ? countedProductIds(warehouseId) : Promise.resolve(new Set<string>()),
  ]);

  return (
    <>
      <PageHeader title="Stock count" subtitle="Enter a physical count; the portal posts the adjustment to match." />
      <InventorySubnav isAdmin={isAdmin} />
      <StockCountClient
        isAdmin={isAdmin}
        branchId={warehouseId}
        branchName={warehouses.find((w) => w.id === warehouseId)?.name ?? ""}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
          distributorSku: p.distributorSku,
          category: p.category,
          onHand: onHand.get(p.id) ?? 0,
          counted: counted.has(p.id),
        }))}
      />
    </>
  );
}
