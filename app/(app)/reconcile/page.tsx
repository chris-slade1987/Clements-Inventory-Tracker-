import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import ReconcileClient from "./ReconcileClient";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : undefined;
  const q = sp.q?.trim();

  const where: Prisma.StockMovementWhereInput = {
    warehouseId: sp.warehouseId || undefined,
    productId: sp.productId || undefined,
    technicianId: sp.technicianId || undefined,
    type: sp.type || undefined,
    ...(from || to
      ? {
          createdAt: {
            ...(from && !isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { reason: { contains: q } },
            { product: { name: { contains: q } } },
            { sourceInvoice: { invoiceNumber: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, movements, warehouses, products, technicians] =
    await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          product: { select: { name: true } },
          warehouse: { select: { name: true } },
          technician: { select: { name: true } },
          user: { select: { name: true } },
          sourceInvoice: { select: { invoiceNumber: true } },
          reversedBy: { select: { id: true } },
        },
      }),
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.technician.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

  const rows = movements.map((m) => ({
    id: m.id,
    createdAt: m.createdAt.toISOString(),
    type: m.type,
    quantity: m.quantity,
    unitPrice: m.unitPrice,
    reason: m.reason,
    productName: m.product.name,
    warehouseName: m.warehouse.name,
    technicianName: m.technician?.name ?? null,
    userName: m.user?.name ?? null,
    invoiceNumber: m.sourceInvoice?.invoiceNumber ?? null,
    isReversal: m.reversalOfId != null,
    isReversed: m.reversedBy != null,
  }));

  return (
    <>
      <PageHeader
        title="Reconcile"
        subtitle="Every stock movement, with reversals and adjustments. Nothing is deleted."
      />
      <ReconcileClient
        rows={rows}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        products={products}
        technicians={technicians}
        initial={sp}
      />
    </>
  );
}
