import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";
import { divisionLabel } from "@/lib/constants";
import { catalogReview } from "@/lib/catalog-review";
import ConfirmQueue from "./ConfirmQueue";
import OffCatalogList from "./OffCatalogList";
import DuplicateClusters from "./DuplicateClusters";
import ReviewTabs from "./ReviewTabs";

export const dynamic = "force-dynamic";

// Catalog Review — one place to consolidate the catalog into a single source of
// truth: merge duplicate look-alikes, approve/merge/discard off-catalog items, and
// confirm auto-added products. Admin + HR only (data-quality gate).
export default async function CatalogReviewPage() {
  const user = await requireUser();
  if (user.role !== "admin" && !user.hrAccess) redirect("/dashboard");

  const [pendingRaw, review] = await Promise.all([
    prisma.product.findMany({ where: { confirmed: false, active: true }, orderBy: { name: "asc" } }),
    catalogReview(),
  ]);

  const pendingNode = pendingRaw.length === 0 ? (
    <p className="text-sm text-muted">No auto-added products waiting to be confirmed.</p>
  ) : (
    <>
      <p className="mb-3 text-sm text-muted">
        Products auto-added from invoices or transfer history. Review each, fix the name / classification / unit, then
        confirm — or merge a naming variant into an existing product.
      </p>
      <ConfirmQueue
        products={pendingRaw.map((p) => ({
          id: p.id, name: p.name, division: p.division, subdivision: p.subdivision,
          divisionLabel: divisionLabel(p.division), unitOfMeasure: p.unitOfMeasure, unitLabel: uomLabel(p.unitOfMeasure),
          unitsPerCase: p.unitsPerCase, category: p.category, manufacturer: p.manufacturer, notes: p.notes, distributorSku: p.distributorSku,
        }))}
        confirmedProducts={review.confirmedProducts}
      />
    </>
  );

  return (
    <ReviewTabs
      tabs={[
        { key: "duplicates", label: "Duplicates", count: review.clusters.length, node: <DuplicateClusters clusters={review.clusters} confirmedProducts={review.confirmedProducts} /> },
        { key: "offcatalog", label: "Off-catalog", count: review.offCatalog.length, node: <OffCatalogList products={review.offCatalog} confirmedProducts={review.confirmedProducts} /> },
        { key: "pending", label: "New products", count: pendingRaw.length, node: pendingNode },
      ]}
    />
  );
}
