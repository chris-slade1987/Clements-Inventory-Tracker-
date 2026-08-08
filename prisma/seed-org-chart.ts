import type { PrismaClient } from "@prisma/client";

// Bootstrap the org chart's reporting lines ONCE, non-destructively: only fills
// employees whose reportsToId is still null, so any hand-edited line in the
// visual chart is never overwritten. Best-effort starting point:
//   • active non-managers at a branch → that branch's manager (if exactly one),
//   • each branch manager → the owner/CEO employee (top of the tree).
// Ambiguous branches (0 or >1 managers) are left blank for manual assignment.
export async function seedOrgChart(prisma: PrismaClient) {
  const branches = ["vero", "stuart", "orlando", "naples"];
  const owner = await prisma.user.findFirst({ where: { email: "c.slade@clementspestcontrol.com" }, select: { employeeId: true } });
  const ownerEmpId = owner?.employeeId ?? null;

  let linked = 0;
  for (const b of branches) {
    const mgrs = await prisma.employee.findMany({
      where: { status: "active", branch: b, role: { contains: "Manager" } },
      select: { id: true },
    });
    if (mgrs.length !== 1) continue; // ambiguous — leave for manual assignment
    const mgrId = mgrs[0].id;

    const res = await prisma.employee.updateMany({
      where: { status: "active", branch: b, reportsToId: null, id: { not: mgrId }, NOT: { role: { contains: "Manager" } } },
      data: { reportsToId: mgrId },
    });
    linked += res.count;

    if (ownerEmpId && ownerEmpId !== mgrId) {
      const r2 = await prisma.employee.updateMany({ where: { id: mgrId, reportsToId: null }, data: { reportsToId: ownerEmpId } });
      linked += r2.count;
    }
  }
  return { linked };
}
