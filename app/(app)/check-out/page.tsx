import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onHandMatrix } from "@/lib/inventory";
import CheckOutClient from "./CheckOutClient";

export const dynamic = "force-dynamic";

export default async function CheckOutPage() {
  const user = await requireUser();

  const [warehouses, technicians, products, matrix] = await Promise.all([
    prisma.warehouse.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.technician.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    onHandMatrix(),
  ]);

  // Serialise the on-hand matrix to a plain object for the client.
  const onHand: Record<string, Record<string, number>> = {};
  for (const [wid, m] of matrix) {
    onHand[wid] = Object.fromEntries(m);
  }

  return (
    <>
      <PageHeader
        title="Check-Out"
        subtitle="Disperse products from a warehouse to a technician's truck."
      />
      <CheckOutClient
        defaultWarehouseId={user.warehouseId ?? warehouses[0]?.id ?? ""}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        technicians={technicians.map((t) => ({
          id: t.id,
          name: t.name,
          homeWarehouseId: t.homeWarehouseId,
        }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unitOfMeasure,
          barcode: p.barcode,
          category: p.category,
          manufacturer: p.manufacturer,
        }))}
        onHand={onHand}
      />
    </>
  );
}
