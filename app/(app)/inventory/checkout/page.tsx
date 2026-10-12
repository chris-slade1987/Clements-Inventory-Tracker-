import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onHandMatrix } from "@/lib/inventory";
import { isCountReason } from "@/lib/stock-count";
import { uomCode } from "@/lib/uom";
import ScanCheckoutClient from "./ScanCheckoutClient";

export const dynamic = "force-dynamic";

export default async function ScanCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  // Technicians (role employee) cannot check out; managers/admins can.
  if (user.role !== "admin" && user.role !== "manager") redirect("/me");

  const sp = await searchParams;
  const isAdmin = user.role === "admin";

  const [warehouses, technicians, products, matrix, adjustments] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.technician.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ approved: "desc" }, { name: "asc" }] }),
    onHandMatrix(),
    prisma.stockMovement.findMany({ where: { type: "adjustment" }, select: { productId: true, warehouseId: true, reason: true } }),
  ]);

  // Default branch: a manager is pinned to their own warehouse; an admin may pass
  // ?branch=<warehouseId>, else their home, else the first warehouse.
  const lockedWarehouseId = user.warehouseId ?? "";
  const requested = (sp.branch ?? "").trim();
  const defaultWarehouseId = isAdmin
    ? (warehouses.find((w) => w.id === requested)?.id ?? lockedWarehouseId ?? warehouses[0]?.id ?? "")
    : (lockedWarehouseId || warehouses[0]?.id || "");

  // on-hand matrix → plain object.
  const onHand: Record<string, Record<string, number>> = {};
  for (const [wid, m] of matrix) onHand[wid] = Object.fromEntries(m);

  // counted-at-branch sets (from count/reconciliation adjustments).
  const countedByWarehouse: Record<string, string[]> = {};
  const countedSets: Record<string, Set<string>> = {};
  for (const a of adjustments) {
    if (!isCountReason(a.reason)) continue;
    (countedSets[a.warehouseId] ??= new Set()).add(a.productId);
  }
  for (const [wid, set] of Object.entries(countedSets)) countedByWarehouse[wid] = [...set];

  return (
    <>
      <PageHeader title="Scan Checkout" subtitle="Scan or photograph a product and issue it to a technician." />
      <InventorySubnav isAdmin={isAdmin} />
      <ScanCheckoutClient
        branchLocked={!isAdmin}
        defaultWarehouseId={defaultWarehouseId}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        technicians={technicians.map((t) => ({ id: t.id, name: t.name, homeWarehouseId: t.homeWarehouseId }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
          distributorSku: p.distributorSku,
          manufacturer: p.manufacturer,
          category: p.category,
          approved: p.approved,
          confirmed: p.confirmed,
        }))}
        onHand={onHand}
        countedByWarehouse={countedByWarehouse}
      />
    </>
  );
}
