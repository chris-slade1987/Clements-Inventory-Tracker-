import "server-only";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Check-Out recipients = the technician list ∪ everyone active on the org chart.
//
// The Check-Out list used to be ONLY the `Technician` table, a separate roster
// linked to People by name. Whenever the two drifted (a profile not marked as a
// technician, a look-alike former-employee profile, a deploy-time cleanup), a real
// person vanished from the list — COO 2026-11-13 / 11-17 / 11-18: Jason could not
// check product out to Brian Lasneski. Managers may check out to anyone (COO
// 2026-11-13), so the picker now also offers every ACTIVE employee who isn't on
// the technician list yet, as `emp:<employeeId>`. On submit that id is turned into
// a technician row here: an existing row with the same name / nickname is reused
// (reactivated if it was switched off), otherwise one is created at the person's
// branch warehouse. Never deletes, renames or moves a row.
// ---------------------------------------------------------------------------

export const EMPLOYEE_PREFIX = "emp:";

export function normPerson(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}

export function warehouseForBranch<T extends { id: string; name: string }>(warehouses: T[], branch: string | null | undefined): T | undefined {
  const b = (branch ?? "").trim().toLowerCase();
  if (!b) return undefined;
  return warehouses.find((w) => w.name.toLowerCase().includes(b));
}

export type RecipientOption = { id: string; name: string; homeWarehouseId: string; routeNumber: string | null; fromProfile: boolean };

/** Active employees who are not already on the active technician list (by name / nickname). */
export async function employeeRecipientOptions(
  activeTechnicians: { name: string; homeWarehouseId: string; routeNumber: string | null }[],
  warehouses: { id: string; name: string }[],
): Promise<RecipientOption[]> {
  const onList = new Set(activeTechnicians.map((t) => normPerson(t.name)));
  const routeKey = (r: string | null | undefined) => { const v = (r ?? "").trim(); return /^\d+$/.test(v) ? String(Number(v)) : v.toLowerCase(); };
  const onListRoute = new Set(activeTechnicians.filter((t) => t.routeNumber).map((t) => `${t.homeWarehouseId}|${routeKey(t.routeNumber)}`));
  const emps = await prisma.employee.findMany({
    where: { status: "active" },
    select: { id: true, name: true, nickname: true, branch: true, routeNumber: true },
    orderBy: { name: "asc" },
  });
  return emps
    .map((e) => ({
      id: `${EMPLOYEE_PREFIX}${e.id}`,
      name: e.name,
      nickname: e.nickname,
      homeWarehouseId: warehouseForBranch(warehouses, e.branch)?.id ?? "",
      routeNumber: e.routeNumber?.trim() || null,
      fromProfile: true,
    }))
    // Already on the technician list under the same name / nickname, or as the same
    // route number at the same warehouse ("Brian L" profile vs "Brian Lasneski" row).
    .filter((e) => !onList.has(normPerson(e.name)) && !(e.nickname && onList.has(normPerson(e.nickname))))
    .filter((e) => !(e.routeNumber && e.homeWarehouseId && onListRoute.has(`${e.homeWarehouseId}|${routeKey(e.routeNumber)}`)))
    .map((e) => ({ id: e.id, name: e.name, homeWarehouseId: e.homeWarehouseId, routeNumber: e.routeNumber, fromProfile: e.fromProfile }));
}

/**
 * Turn a picker id into a technician id. Plain ids pass through. `emp:<id>` finds
 * or creates the person's technician row. `fallbackWarehouseId` is used when the
 * employee has no branch (the warehouse the product is leaving from).
 */
export async function resolveRecipientTechnicianId(pickerId: string, fallbackWarehouseId: string): Promise<{ id: string } | { error: string }> {
  if (!pickerId.startsWith(EMPLOYEE_PREFIX)) return { id: pickerId };
  const emp = await prisma.employee.findUnique({
    where: { id: pickerId.slice(EMPLOYEE_PREFIX.length) },
    select: { name: true, nickname: true, branch: true, status: true },
  });
  if (!emp || emp.status !== "active") return { error: "That person isn't an active employee." };

  const names = new Set([normPerson(emp.name), ...(emp.nickname ? [normPerson(emp.nickname)] : [])]);
  const warehouses = await prisma.warehouse.findMany({ where: { active: true }, select: { id: true, name: true } });
  const homeWh = warehouseForBranch(warehouses, emp.branch)?.id ?? fallbackWarehouseId;
  const techs = await prisma.technician.findMany({ select: { id: true, name: true, active: true, homeWarehouseId: true } });
  const same = techs
    .filter((t) => names.has(normPerson(t.name)))
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.homeWarehouseId === homeWh) - Number(a.homeWarehouseId === homeWh));
  const hit = same[0];
  if (hit) {
    if (!hit.active) await prisma.technician.update({ where: { id: hit.id }, data: { active: true } });
    return { id: hit.id };
  }
  const created = await prisma.technician.create({ data: { name: emp.name, homeWarehouseId: homeWh, active: true } });
  return { id: created.id };
}
