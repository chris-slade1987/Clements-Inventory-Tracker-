import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

/**
 * Resolve which warehouse an inventory screen/endpoint operates on.
 *
 * - A branch-locked manager (non-admin with a home warehouse) is ALWAYS pinned to
 *   their own warehouse; a requested branch is ignored.
 * - An admin may switch branch via a requested warehouse id; otherwise their home
 *   warehouse, otherwise the first active warehouse.
 *
 * Returns a concrete, active warehouse id, or null when none exists.
 */
export async function resolveWarehouseId(user: SessionUser, requested?: string | null): Promise<string | null> {
  if (user.role !== "admin") {
    return user.warehouseId ?? null;
  }
  const want = (requested ?? "").trim();
  if (want) {
    const wh = await prisma.warehouse.findFirst({ where: { id: want, active: true }, select: { id: true } });
    if (wh) return wh.id;
  }
  if (user.warehouseId) return user.warehouseId;
  const first = await prisma.warehouse.findFirst({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } });
  return first?.id ?? null;
}
