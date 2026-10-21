import "server-only";
import { prisma } from "@/lib/prisma";

// Product-label photo catalog (Phase 6). Human-in-the-loop: photos are captured,
// reviewed, and assigned to a product by a person — the AI only proposes. Photos
// are freely re-assignable and deletable, so a wrong match is always correctable.

export type ProductPhotoRow = {
  id: string;
  productId: string | null;
  productName: string | null;
  photoUrl: string;
  status: string;
  primary: boolean;
  aiSuggestedProductId: string | null;
  aiSuggestedName: string | null;
  aiConfidence: number | null;
  labelText: string | null;
  capturedByName: string | null;
  createdAt: Date;
};

/** The canonical (primary) label photo URL for each product that has one. Used by
 *  the catalog + (Phase 7) the product profile card. */
export async function primaryPhotoByProduct(): Promise<Map<string, string>> {
  const rows = await prisma.productPhoto.findMany({
    where: { status: "assigned", primary: true, productId: { not: null } },
    select: { productId: true, photoUrl: true },
  });
  const out = new Map<string, string>();
  for (const r of rows) if (r.productId) out.set(r.productId, r.photoUrl);
  return out;
}

/** Pending (unassigned) photos awaiting a human decision, newest first. */
export async function pendingPhotos(limit = 40): Promise<ProductPhotoRow[]> {
  const rows = await prisma.productPhoto.findMany({
    where: { status: "unassigned" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return decorate(rows);
}

/** Recently assigned photos (the catalog gallery), newest first. */
export async function assignedPhotos(limit = 60): Promise<ProductPhotoRow[]> {
  const rows = await prisma.productPhoto.findMany({
    where: { status: "assigned" },
    orderBy: { assignedAt: "desc" },
    take: limit,
  });
  return decorate(rows);
}

export async function pendingPhotoCount(): Promise<number> {
  return prisma.productPhoto.count({ where: { status: "unassigned" } });
}

type RawPhoto = {
  id: string; productId: string | null; photoUrl: string; status: string; primary: boolean;
  aiSuggestedProductId: string | null; aiConfidence: number | null; labelText: string | null;
  capturedByName: string | null; createdAt: Date;
};

async function decorate(rows: RawPhoto[]): Promise<ProductPhotoRow[]> {
  const ids = new Set<string>();
  for (const r of rows) { if (r.productId) ids.add(r.productId); if (r.aiSuggestedProductId) ids.add(r.aiSuggestedProductId); }
  const products = ids.size
    ? await prisma.product.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: r.productId ? nameById.get(r.productId) ?? null : null,
    photoUrl: r.photoUrl,
    status: r.status,
    primary: r.primary,
    aiSuggestedProductId: r.aiSuggestedProductId,
    aiSuggestedName: r.aiSuggestedProductId ? nameById.get(r.aiSuggestedProductId) ?? null : null,
    aiConfidence: r.aiConfidence,
    labelText: r.labelText,
    capturedByName: r.capturedByName,
    createdAt: r.createdAt,
  }));
}
