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
// Runtime backfill: set each active login's `warehouseId` to their BRANCH's
// warehouse (matched by name, since Warehouse has no branch column) when it's unset.
// So every branch-scoped screen — for managers AND technicians — defaults to the
// user's own branch instead of the first warehouse alphabetically (Naples). The
// build-time seed doesn't reliably reach the live DB, so this runs at runtime from
// the shared app layout. Idempotent + non-fatal, with a per-instance fast-path.
// Company-wide users with no branch (admins/execs) are left null on purpose — they
// toggle branch and shouldn't be pinned to one.
let _userWhRan = false;
export async function ensureUserWarehouses(): Promise<void> {
  if (_userWhRan) return;
  try {
    const needing = await prisma.user.findMany({
      where: { active: true, warehouseId: null, branch: { not: null } },
      select: { id: true, branch: true },
    });
    if (needing.length === 0) {
      _userWhRan = true;
      return;
    }
    const whs = await prisma.warehouse.findMany({ where: { active: true }, select: { id: true, name: true } });
    for (const u of needing) {
      const b = (u.branch ?? "").trim().toLowerCase();
      if (!b) continue; // empty branch → don't match (would otherwise match every name)
      const match = whs.find((w) => w.name.toLowerCase().includes(b));
      if (!match) continue;
      try {
        await prisma.user.update({ where: { id: u.id }, data: { warehouseId: match.id } });
      } catch (e) {
        console.error("ensureUserWarehouses: failed to set", u.id, e);
      }
    }
    _userWhRan = true;
  } catch (e) {
    console.error("ensureUserWarehouses failed (non-fatal):", e);
  }
}

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
