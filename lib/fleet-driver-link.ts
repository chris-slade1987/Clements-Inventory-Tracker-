import { prisma } from "@/lib/prisma";
import { matchEmployeeByName, type EmployeeLite } from "@/lib/people";

// Backfill the structured driver link (Vehicle.assignedEmployeeId) from the
// driver NAME the fleet already houses (Vehicle.assignedTo, loaded from the
// fleet import). Matches each vehicle's existing driver name against the active
// employee roster via matchEmployeeByName (first name + last initial), so the
// grid comes up pre-populated with the correct driver instead of blank.
//
// Idempotent + safe: only fills vehicles whose FK is still null, never
// overwrites an existing link, and on a confident match rewrites assignedTo to
// the canonical employee name.

export type DriverBackfillResult = {
  scanned: number;
  linked: number;
  alreadyLinked: number;
  noName: number;
  unmatched: number;
  linkedSamples: { vehicle: string; driver: string }[];
  unmatchedSamples: { vehicle: string; driver: string }[];
};

export async function backfillDriverLinks(): Promise<DriverBackfillResult> {
  const [vehicles, employees] = await Promise.all([
    prisma.vehicle.findMany({
      where: { status: "active" },
      select: { id: true, name: true, unitNumber: true, assignedTo: true, assignedEmployeeId: true },
    }),
    prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true, name: true, role: true, division: true, branch: true },
    }),
  ]);
  const roster: EmployeeLite[] = employees;

  let linked = 0;
  let alreadyLinked = 0;
  let noName = 0;
  const linkedSamples: { vehicle: string; driver: string }[] = [];
  const unmatchedSamples: { vehicle: string; driver: string }[] = [];

  for (const v of vehicles) {
    if (v.assignedEmployeeId) { alreadyLinked++; continue; }
    const name = (v.assignedTo ?? "").trim();
    if (!name) { noName++; continue; }

    const empId = matchEmployeeByName(name, roster);
    const label = v.unitNumber ? `#${v.unitNumber} · ${v.name}` : v.name;
    if (empId) {
      const emp = employees.find((e) => e.id === empId)!;
      await prisma.vehicle.update({ where: { id: v.id }, data: { assignedEmployeeId: empId, assignedTo: emp.name } });
      linked++;
      if (linkedSamples.length < 40) linkedSamples.push({ vehicle: label, driver: emp.name });
    } else {
      if (unmatchedSamples.length < 40) unmatchedSamples.push({ vehicle: label, driver: name });
    }
  }

  return {
    scanned: vehicles.length,
    linked,
    alreadyLinked,
    noName,
    unmatched: unmatchedSamples.length,
    linkedSamples,
    unmatchedSamples,
  };
}
