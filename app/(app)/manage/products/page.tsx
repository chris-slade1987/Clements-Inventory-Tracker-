import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import ManageProducts from "./ManageProducts";

export const dynamic = "force-dynamic";

export default async function ManageProductsPage() {
  await requireAdmin();
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return (
    <ManageProducts
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        manufacturer: p.manufacturer,
        epaRegNumber: p.epaRegNumber,
        unitOfMeasure: p.unitOfMeasure,
        category: p.category,
        activeIngredient: p.activeIngredient,
        targetPest: p.targetPest,
        applicationMethod: p.applicationMethod,
        barcode: p.barcode,
        distributorSku: p.distributorSku,
        active: p.active,
        approved: p.approved,
        notes: p.notes,
      }))}
    />
  );
}
