import { prisma } from "@/lib/prisma";
import { gradeLetter } from "@/lib/inspection";

// Personnel / HR queries. Employees are the people that inspections and (later)
// annual reviews tag to, so scores accrue to a profile over time.

export type EmployeeLite = { id: string; name: string; role: string | null; division: string | null; branch: string | null };

export async function listEmployees(branch?: string) {
  return prisma.employee.findMany({
    where: { status: "active", ...(branch ? { branch } : {}) },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
}

/**
 * Match a free-text driver name (e.g. the fleet sheet's "Josh F*") to a seeded
 * employee. Compares first name + last-initial so abbreviated names still tie
 * to the full profile.
 */
export function matchEmployeeByName(name: string | null | undefined, employees: EmployeeLite[]): string | null {
  const raw = (name ?? "").replace(/\*/g, "").trim().toLowerCase();
  if (!raw) return null;
  const [first, rest] = [raw.split(/\s+/)[0], raw.split(/\s+/).slice(1).join(" ")];
  const lastInitial = rest ? rest[0] : null;
  let exact: string | null = null;
  const firstMatches: { id: string; last: string }[] = [];
  for (const e of employees) {
    const en = e.name.toLowerCase().split(/\s+/);
    if (en[0] !== first) continue;
    const last = en.slice(1).join(" ");
    if (raw === e.name.toLowerCase()) exact = e.id;
    firstMatches.push({ id: e.id, last });
  }
  if (exact) return exact;
  if (firstMatches.length === 1) return firstMatches[0].id;
  if (lastInitial) {
    const byInitial = firstMatches.filter((m) => m.last.startsWith(lastInitial));
    if (byInitial.length === 1) return byInitial[0].id;
  }
  return null;
}

export async function employeeDetail(id: string) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return null;
  const inspections = await prisma.vehicleInspection.findMany({
    where: { employeeId: id },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { vehicle: { select: { unitNumber: true, name: true } } },
  });
  const rideAlongs = await prisma.auditRideAlong.findMany({
    where: { employeeId: id },
    orderBy: { id: "desc" },
    include: { audit: { select: { year: true, quarter: true, visitDate: true } } },
  });
  const training = await prisma.trainingAssignment.findMany({
    where: { employeeId: id },
    orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
    include: { course: { select: { title: true, category: true } } },
  });
  const records = await prisma.personnelRecord.findMany({
    where: { employeeId: id },
    orderBy: { createdAt: "desc" },
    include: { signatures: { orderBy: { signedAt: "asc" } }, signatureRequests: { where: { signedAt: null } } },
  });
  // Vehicles currently assigned to this person (matched by name).
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active", branch: employee.branch ?? undefined },
    select: { id: true, unitNumber: true, name: true, assignedTo: true },
  });
  const assigned = vehicles.filter((v) => matchEmployeeByName(v.assignedTo, [employee]) === employee.id);

  const pcts = inspections.map((i) => i.scorePct);
  const avgPct = pcts.length ? Math.round((pcts.reduce((s, n) => s + n, 0) / pcts.length) * 10) / 10 : null;

  return {
    employee,
    inspections,
    rideAlongs,
    training,
    records,
    assigned,
    avgPct,
    grade: avgPct == null ? null : gradeLetter(avgPct),
  };
}

export async function employeeRoster(branch?: string) {
  const employees = await listEmployees(branch);
  const ids = employees.map((e) => e.id);
  const grouped = await prisma.vehicleInspection.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: ids } },
    _avg: { scorePct: true },
    _count: { _all: true },
  });
  const byEmp = new Map(grouped.map((g) => [g.employeeId, g]));
  return employees.map((e) => {
    const g = byEmp.get(e.id);
    const avg = g?._avg.scorePct ?? null;
    return {
      ...e,
      inspectionCount: g?._count._all ?? 0,
      avgPct: avg == null ? null : Math.round(avg * 10) / 10,
      grade: avg == null ? null : gradeLetter(avg),
    };
  });
}
