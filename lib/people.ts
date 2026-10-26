import { prisma } from "@/lib/prisma";
import { gradeLetter } from "@/lib/inspection";
import { auditsForEmployee } from "@/lib/audit";

// Personnel / HR queries. Employees are the people that inspections and (later)
// annual reviews tag to, so scores accrue to a profile over time.

export type EmployeeLite = { id: string; name: string; role: string | null; division: string | null; branch: string | null; nickname?: string | null };

export async function listEmployees(branch?: string) {
  return prisma.employee.findMany({
    where: { status: "active", ...(branch ? { branch } : {}) },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
}

/**
 * Match a free-text driver name (e.g. the fleet sheet's "Josh F*") to a seeded
 * employee. Compares first name + last-initial so abbreviated names still tie
 * to the full profile. Each employee is matched against BOTH their full name and
 * their `nickname` (when set), so a roster/vehicle entry recorded under someone's
 * known-by name still links to their canonical profile.
 */
export function matchEmployeeByName(name: string | null | undefined, employees: EmployeeLite[]): string | null {
  const raw = (name ?? "").replace(/\*/g, "").trim().toLowerCase();
  if (!raw) return null;
  const [first, rest] = [raw.split(/\s+/)[0], raw.split(/\s+/).slice(1).join(" ")];
  const lastInitial = rest ? rest[0] : null;
  let exact: string | null = null;
  // De-dupe by employee id (an employee may match on both name and nickname);
  // keep a non-empty last name when one of the candidates provides it.
  const firstMatches = new Map<string, string>();
  for (const e of employees) {
    const candidates = [e.name, e.nickname].filter((c): c is string => !!c && c.trim() !== "");
    for (const cand of candidates) {
      const cn = cand.toLowerCase().trim();
      if (raw === cn) exact = e.id;
      const en = cn.split(/\s+/);
      if (en[0] !== first) continue;
      const last = en.slice(1).join(" ");
      const existing = firstMatches.get(e.id);
      if (existing === undefined || (existing === "" && last !== "")) firstMatches.set(e.id, last);
    }
  }
  if (exact) return exact;
  const entries = [...firstMatches.entries()];
  if (entries.length === 1) return entries[0][0];
  if (lastInitial) {
    const byInitial = entries.filter(([, last]) => last.startsWith(lastInitial));
    if (byInitial.length === 1) return byInitial[0][0];
  }
  return null;
}

export async function employeeDetail(id: string) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return null;
  // These five reads are independent of one another (vehicles only needs the
  // already-resolved employee.branch), so run them in parallel.
  const [inspections, rideAlongs, training, records, vehicles] = await Promise.all([
    prisma.vehicleInspection.findMany({
      where: { employeeId: id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { vehicle: { select: { unitNumber: true, name: true } } },
    }),
    prisma.auditRideAlong.findMany({
      where: { employeeId: id },
      orderBy: { id: "desc" },
      include: { audit: { select: { year: true, quarter: true, visitDate: true } } },
    }),
    prisma.trainingAssignment.findMany({
      where: { employeeId: id },
      orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
      include: { course: { select: { title: true, category: true } } },
    }),
    prisma.personnelRecord.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: "desc" },
      include: { signatures: { orderBy: { signedAt: "asc" } }, signatureRequests: { where: { signedAt: null } } },
    }),
    // Vehicles currently assigned to this person (matched by name).
    prisma.vehicle.findMany({
      where: { status: "active", branch: employee.branch ?? undefined },
      select: { id: true, unitNumber: true, name: true, assignedTo: true },
    }),
  ]);
  const assigned = vehicles.filter((v) => matchEmployeeByName(v.assignedTo, [employee]) === employee.id);

  // Signed quarterly branch audits filed to this profile — either as the branch
  // manager who acknowledged it, or as the Director of Field Ops who conducted it.
  const branchAudits = await auditsForEmployee(id);

  const pcts = inspections.map((i) => i.scorePct);
  const avgPct = pcts.length ? Math.round((pcts.reduce((s, n) => s + n, 0) / pcts.length) * 10) / 10 : null;

  return {
    employee,
    inspections,
    rideAlongs,
    training,
    records,
    assigned,
    branchAudits,
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
