import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomCode } from "@/lib/uom";
import LabelsClient from "./LabelsClient";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  await requireAdmin();
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ approved: "desc" }, { name: "asc" }],
    select: { id: true, name: true, distributorSku: true, unitOfMeasure: true, category: true },
  });
  return (
    <>
      <PageHeader title="Shelf QR labels" subtitle="Print QR labels (scan to identify a product) on Avery sheets." />
      <InventorySubnav isAdmin />
      <LabelsClient
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          distributorSku: p.distributorSku,
          unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
          category: p.category,
        }))}
      />
    </>
  );
}
