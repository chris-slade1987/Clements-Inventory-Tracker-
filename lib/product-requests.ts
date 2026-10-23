import "server-only";
import { prisma } from "@/lib/prisma";
import type { SystemRecipient } from "@/lib/threads";
import { branchLabel } from "@/lib/management";

// New-product approval requests (Phase 5). When a manager hits the "properly
// cataloged" gate at Check-Out for a sample / off-catalog product, they can ask a
// super admin to catalog it. Any super admin (Chris, Julie, April) can approve;
// approval makes the product checkout-eligible and notifies the requester.

export type ProductRequestPhoto = { id: string; photoUrl: string; kind: string };

export type ProductRequestRow = {
  id: string;
  status: string;
  productId: string | null;
  proposedName: string;
  description: string | null;
  manufacturer: string | null;
  distributorSku: string | null;
  unitOfMeasure: string | null;
  division: string | null;
  onHandQty: number | null;
  reason: string | null;
  photoUrl: string | null;
  photos: ProductRequestPhoto[];
  branch: string | null;
  branchLabel: string | null;
  warehouseId: string | null;
  requestedByName: string;
  requestedByUserId: string;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};

/** Super admins = role "admin" and NOT the team-scoped "admin" level (mirrors
 *  isSuperAdmin in lib/auth). These are the people who approve product requests —
 *  they receive the request (Inbox + email) and are the only ones who may decide. */
export async function superAdminRecipients(excludeUserId?: string): Promise<SystemRecipient[]> {
  const users = await prisma.user.findMany({
    where: { active: true, role: "admin" },
    select: { id: true, name: true, email: true, employeeId: true, accessLevel: true },
  });
  return users
    .filter((u) => u.accessLevel !== "admin") // team-scoped admins are not super admins
    .filter((u) => u.id !== excludeUserId)
    .map((u) => ({ userId: u.id, employeeId: u.employeeId, name: u.name, email: u.email }));
}

/** Count of pending product requests (drives the dashboard alert + the tab badge). */
export async function pendingProductRequestCount(): Promise<number> {
  return prisma.productRequest.count({ where: { status: "pending" } });
}

type RawRequest = {
  id: string; status: string; productId: string | null; proposedName: string; description: string | null;
  manufacturer: string | null; distributorSku: string | null; unitOfMeasure: string | null; division: string | null;
  onHandQty: number | null; reason: string | null; photoUrl: string | null;
  branch: string | null; warehouseId: string | null; requestedByName: string; requestedByUserId: string;
  decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null; createdAt: Date;
  photos?: { id: string; photoUrl: string; kind: string }[];
};

const toRow = (r: RawRequest): ProductRequestRow => ({
  id: r.id, status: r.status, productId: r.productId, proposedName: r.proposedName, description: r.description,
  manufacturer: r.manufacturer, distributorSku: r.distributorSku, unitOfMeasure: r.unitOfMeasure, division: r.division,
  onHandQty: r.onHandQty, reason: r.reason, photoUrl: r.photoUrl, branch: r.branch, warehouseId: r.warehouseId,
  requestedByName: r.requestedByName, requestedByUserId: r.requestedByUserId, decidedByName: r.decidedByName,
  decidedAt: r.decidedAt, decisionNote: r.decisionNote, createdAt: r.createdAt,
  branchLabel: r.branch ? branchLabel(r.branch) : null,
  photos: (r.photos ?? []).map((p) => ({ id: p.id, photoUrl: p.photoUrl, kind: p.kind })),
});

/** Pending requests first (oldest first), then recently decided ones. */
export async function listProductRequests(limit = 50): Promise<{ pending: ProductRequestRow[]; decided: ProductRequestRow[] }> {
  const [pending, decided] = await Promise.all([
    prisma.productRequest.findMany({
      where: { status: "pending" }, orderBy: { createdAt: "asc" },
      include: { photos: { where: { status: "unassigned" }, select: { id: true, photoUrl: true, kind: true } } },
    }),
    prisma.productRequest.findMany({ where: { status: { not: "pending" } }, orderBy: { decidedAt: "desc" }, take: limit }),
  ]);
  return { pending: pending.map(toRow), decided: decided.map(toRow) };
}
