import "server-only";
import { prisma } from "@/lib/prisma";
import type { SystemRecipient } from "@/lib/threads";
import { branchLabel } from "@/lib/management";

// New-product approval requests (Phase 5). When a manager hits the "properly
// cataloged" gate at Check-Out for a sample / off-catalog product, they can ask a
// super admin to catalog it. Any super admin (Chris, Julie, April) can approve;
// approval makes the product checkout-eligible and notifies the requester.

export type ProductRequestRow = {
  id: string;
  status: string;
  productId: string | null;
  proposedName: string;
  description: string | null;
  manufacturer: string | null;
  distributorSku: string | null;
  reason: string | null;
  photoUrl: string | null;
  branch: string | null;
  branchLabel: string | null;
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

const toRow = (r: {
  id: string; status: string; productId: string | null; proposedName: string; description: string | null;
  manufacturer: string | null; distributorSku: string | null; reason: string | null; photoUrl: string | null;
  branch: string | null; requestedByName: string; requestedByUserId: string; decidedByName: string | null;
  decidedAt: Date | null; decisionNote: string | null; createdAt: Date;
}): ProductRequestRow => ({
  ...r,
  branchLabel: r.branch ? branchLabel(r.branch) : null,
});

/** Pending requests first (oldest first), then recently decided ones. */
export async function listProductRequests(limit = 50): Promise<{ pending: ProductRequestRow[]; decided: ProductRequestRow[] }> {
  const [pending, decided] = await Promise.all([
    prisma.productRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } }),
    prisma.productRequest.findMany({ where: { status: { not: "pending" } }, orderBy: { decidedAt: "desc" }, take: limit }),
  ]);
  return { pending: pending.map(toRow), decided: decided.map(toRow) };
}
