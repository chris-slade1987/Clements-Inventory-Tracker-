import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import ManageProducts from "./ManageProducts";

export const dynamic = "force-dynamic";

export default async function ManageProductsPage() {
  // Catalog editing is super-admin-only (Chris, Julie, April). Everyone else —
  // including branch managers — uses check-out identify and the "Request new
  // product" flow instead. See lib/access-catalog.ts.
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");
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
