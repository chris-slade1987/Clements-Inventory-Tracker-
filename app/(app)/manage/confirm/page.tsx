import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";
import { divisionLabel } from "@/lib/constants";
import { catalogReview, ensureCatalogBaseline } from "@/lib/catalog-review";
import ConfirmQueue from "./ConfirmQueue";
import OffCatalogList from "./OffCatalogList";
import DuplicateClusters from "./DuplicateClusters";
import ReviewAll from "./ReviewAll";
import RejectedList from "./RejectedList";
import ReviewTabs from "./ReviewTabs";

export const dynamic = "force-dynamic";

// Matches DISCARD_MARK in the confirm API + seed — the marker on a rejected product.
const DISCARD_MARK = "Discarded from confirm queue";

// Catalog Review — one place to consolidate the catalog into a single source of
// truth: merge duplicate look-alikes, approve/merge/discard off-catalog items, and
// confirm auto-added products. Admin + HR only (data-quality gate).
export default async function CatalogReviewPage() {
  // Catalog Review (confirm / approve / merge / discard) is super-admin-only.
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  // One-time baseline: the curated active product list is the source of truth, so
  // accept it onto the approved catalog and clear the stale review backlog. Runs once
  // per version on the live DB (gated by a Setting row).
  await ensureCatalogBaseline();

  const [pendingRaw, rejectedRaw, review] = await Promise.all([
    prisma.product.findMany({ where: { confirmed: false, active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: false, notes: { contains: DISCARD_MARK } }, orderBy: { name: "asc" } }),
    catalogReview(),
  ]);

  const rejectedNode = (
    <RejectedList
      products={rejectedRaw.map((p) => ({
        id: p.id, name: p.name, unitLabel: uomLabel(p.unitOfMeasure), divisionLabel: divisionLabel(p.division),
        distributorSku: p.distributorSku, manufacturer: p.manufacturer,
        rejectedNote: (p.notes ?? "").match(/Discarded from confirm queue[^.]*\./i)?.[0] ?? null,
      }))}
    />
  );

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
        { key: "all", label: "Approve / Reject", count: review.all.filter((p) => !(p.approved && p.confirmed)).length, node: <ReviewAll products={review.all} /> },
        { key: "duplicates", label: "Duplicates", count: review.clusters.length, node: <DuplicateClusters clusters={review.clusters} confirmedProducts={review.confirmedProducts} /> },
        { key: "offcatalog", label: "Off-catalog", count: review.offCatalog.length, node: <OffCatalogList products={review.offCatalog} confirmedProducts={review.confirmedProducts} /> },
        { key: "pending", label: "New products", count: pendingRaw.length, node: pendingNode },
        { key: "rejected", label: "Rejected", count: rejectedRaw.length, node: rejectedNode },
      ]}
    />
  );
}
