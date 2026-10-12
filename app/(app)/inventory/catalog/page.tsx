import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomCode } from "@/lib/uom";
import CatalogClient from "./CatalogClient";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  await requireAdmin();
  const products = await prisma.product.findMany({
    orderBy: [{ approved: "desc" }, { name: "asc" }],
    include: { barcodes: { orderBy: { createdAt: "asc" } } },
  });
  return (
    <>
      <PageHeader title="Catalog admin" subtitle="Manage barcodes, edit basic fields, and import the catalog CSV." />
      <InventorySubnav isAdmin />
      <CatalogClient
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          manufacturer: p.manufacturer,
          epaRegNumber: p.epaRegNumber,
          category: p.category,
          activeIngredient: p.activeIngredient,
          targetPest: p.targetPest,
          applicationMethod: p.applicationMethod,
          legacyBarcode: p.barcode,
          distributorSku: p.distributorSku,
          unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
          approved: p.approved,
          confirmed: p.confirmed,
          barcodes: p.barcodes.map((b) => ({ id: b.id, code: b.code, symbology: b.symbology })),
        }))}
      />
    </>
  );
}
