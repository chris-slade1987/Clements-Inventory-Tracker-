import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

/**
 * Resolve which warehouse an inventory screen/endpoint operates on.
 *
 * - An **explicitly requested** active warehouse is honored for everyone (admins
 *   AND managers) — managers need to toggle branch at check-out when covering
 *   another location.
 * - Otherwise the default is the user's own warehouse, then their **branch's**
 *   warehouse (the `Warehouse` table has no branch column, so match by name — a
 *   "vero" user → the "Vero Beach" warehouse), then the first active warehouse.
 *
 * Returns a concrete, active warehouse id, or null when none exists.
 */
export async function resolveWarehouseId(user: SessionUser, requested?: string | null): Promise<string | null> {
  const want = (requested ?? "").trim();
  if (want) {
    const wh = await prisma.warehouse.findFirst({ where: { id: want, active: true }, select: { id: true } });
    if (wh) return wh.id;
  }
  if (user.warehouseId) return user.warehouseId;
  // Default to the user's branch warehouse (matched by name, since Warehouse has no
  // branch field) so a manager lands on their own branch rather than the first one
  // alphabetically (Naples).
  const branch = (user.branch ?? "").trim().toLowerCase();
  if (branch) {
    const whs = await prisma.warehouse.findMany({ where: { active: true }, select: { id: true, name: true } });
    const byBranch = whs.find((w) => w.name.toLowerCase().includes(branch));
    if (byBranch) return byBranch.id;
  }
  const first = await prisma.warehouse.findFirst({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } });
  return first?.id ?? null;
}
