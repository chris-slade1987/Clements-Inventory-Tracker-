import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomCode } from "@/lib/uom";
import { pendingPhotos, assignedPhotos } from "@/lib/product-photos";
import PhotoCatalogClient from "./PhotoCatalogClient";

export const dynamic = "force-dynamic";

// Photo Catalog (Phase 6) — capture a product label, review it, submit for AI
// reading, then a HUMAN assigns it to a product (or overrides the suggestion, or
// discards it). Assigned photos can be re-assigned or deleted from the gallery.
export default async function PhotoCatalogPage() {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  if (user.role !== "admin" && user.role !== "manager") redirect("/me");
  const isAdmin = user.role === "admin";

  const [products, pending, assigned] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: [{ approved: "desc" }, { name: "asc" }],
      select: { id: true, name: true, distributorSku: true, manufacturer: true, unitOfMeasure: true, approved: true, confirmed: true },
    }),
    pendingPhotos(40),
    assignedPhotos(60),
  ]);

  return (
    <>
      <PageHeader
        title="Photo Catalog"
        subtitle="Photograph a product label, review it, then match it to the right catalog product. You submit the photo — the AI only suggests."
      />
      <InventorySubnav isAdmin={isAdmin} />
      <PhotoCatalogClient
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          distributorSku: p.distributorSku,
          manufacturer: p.manufacturer,
          unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
          approved: p.approved,
          confirmed: p.confirmed,
        }))}
        pending={pending}
        assigned={assigned}
      />
    </>
  );
}
