import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomCode } from "@/lib/uom";
import HistoryClient from "./HistoryClient";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  if (user.role !== "admin" && user.role !== "manager") redirect("/me");

  const sp = await searchParams;
  const isAdmin = user.role === "admin";

  // Branch scope: managers see only their own branch; admins see all (or ?branch).
  const where: { warehouseId?: string } = {};
  if (!isAdmin && user.warehouseId) where.warehouseId = user.warehouseId;
  else if (isAdmin && (sp.branch ?? "").trim()) where.warehouseId = (sp.branch ?? "").trim();

  const [warehouses, checkouts] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.checkout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        warehouse: { select: { name: true } },
        technician: { select: { name: true } },
        issuedBy: { select: { name: true } },
        lines: { include: { product: { select: { name: true, unitOfMeasure: true } } } },
      },
    }),
  ]);

  return (
    <>
      <PageHeader title="Checkout History" subtitle="Scan-to-issue checkouts, with undo/void and CSV export." />
      <InventorySubnav isAdmin={isAdmin} />
      <HistoryClient
        isAdmin={isAdmin}
        userId={user.id}
        branchFilter={isAdmin ? ((sp.branch ?? "").trim() || null) : (user.warehouseId ?? null)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        checkouts={checkouts.map((c) => ({
          id: c.id,
          warehouse: c.warehouse.name,
          technician: c.technician.name,
          issuedBy: c.issuedBy.name,
          issuedByUserId: c.issuedByUserId,
          status: c.status,
          submittedAt: (c.submittedAt ?? c.createdAt).toISOString(),
          voidReason: c.voidReason,
          lines: c.lines.map((l) => ({
            name: l.product.name,
            quantity: l.quantity,
            unit: uomCode(l.product.unitOfMeasure) ?? l.product.unitOfMeasure,
            identifiedBy: l.identifiedBy,
            photoUrl: l.photoUrl,
          })),
        }))}
      />
    </>
  );
}
