import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { divisionLabel } from "@/lib/constants";
import ProductEditor from "./ProductEditor";

export const dynamic = "force-dynamic";

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  // Super-admin-only: all catalog mutation (fields, photos, barcodes) lives here.
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");
  const { id } = await params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();

  const [photos, linkedBarcodes] = await Promise.all([
    prisma.productPhoto.findMany({ where: { productId: id, status: "assigned" }, orderBy: [{ primary: "desc" }, { assignedAt: "desc" }] }),
    prisma.productBarcode.findMany({ where: { productId: id }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, symbology: true } }),
  ]);

  return (
    <>
      <div className="mb-2">
        <Link href={`/manage/products/${product.id}`} className="text-xs font-medium text-brand-700 hover:underline">← Back to product</Link>
      </div>
      <PageHeader
        title={`Edit — ${product.name}`}
        subtitle={[product.manufacturer, product.division ? divisionLabel(product.division) : null].filter(Boolean).join(" · ") || undefined}
      />
      <ProductEditor
        product={{
          id: product.id,
          name: product.name,
          manufacturer: product.manufacturer,
          epaRegNumber: product.epaRegNumber,
          unitOfMeasure: product.unitOfMeasure,
          category: product.category,
          division: product.division,
          subdivision: product.subdivision,
          form: product.form,
          activeIngredient: product.activeIngredient,
          targetPest: product.targetPest,
          applicationMethod: product.applicationMethod,
          barcode: product.barcode,
          distributorSku: product.distributorSku,
          notes: product.notes,
          active: product.active,
          approved: product.approved,
        }}
        photos={photos.map((p) => ({ id: p.id, photoUrl: p.photoUrl, kind: p.kind, primary: p.primary }))}
        barcodes={linkedBarcodes}
      />
    </>
  );
}
