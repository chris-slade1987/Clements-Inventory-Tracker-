import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invoiceReaderMode } from "@/lib/invoice/parse";
import CheckInClient from "./CheckInClient";

export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  const user = await requireUser();
  const [warehouses, products] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Check-In"
        subtitle="Receive products into a warehouse from a distributor invoice."
      />
      <CheckInClient
        mode={invoiceReaderMode()}
        defaultWarehouseId={user.warehouseId ?? warehouses[0]?.id ?? ""}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unitOfMeasure,
        }))}
      />
    </>
  );
}
