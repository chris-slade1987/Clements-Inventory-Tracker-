import "server-only";
import { prisma } from "@/lib/prisma";
import { OCTOBER_GRACE_CUTOFF } from "@/lib/date";
import { matchEmployeeByName } from "@/lib/people";

// Runtime healers that keep vehicle-inspection data clean after the October-2026
// rollout. Both are idempotent, cheap, and non-fatal; run from app/(app)/layout.tsx.
//
// 1) ensureGraceInspectionsRefiled — COO directive: everything COMPLETED before the
//    October grace window closed (00:00 ET Mon 11/9/2026) counts for OCTOBER, and
//    November starts completely open. Early-November inspections were being saved
//    as 2026-11 (the form used to default to the live month), so they read as
//    "pending" for October AND pre-filled November. This moves every 2026-11
//    inspection created before the cutoff to 2026-10. When the same truck already
//    has an October inspection (a re-inspection, e.g. two filed for Renzo's truck),
//    only ONE can count: the MOST RECENT one is kept as October's record and the
//    earlier duplicate is removed (its photos cascade). Keyed on the creation time,
//    not "is the window open now", so it stays correct whenever it first runs.
//
// 2) ensureInspectionTechnicianNames — every inspection files under the
//    technician's FULL company-profile name. The form used to default to the fleet
//    sheet's short driver name ("Renzo", "Josh F*") and only switched to the profile
//    name if the inspector touched the dropdown, splitting one person into two rows
//    in the grades. This links each row to its employee (when it can be resolved
//    unambiguously) and rewrites technicianName to that profile name.

const SOURCE = { year: 2026, month: 11 } as const;
const TARGET = { year: 2026, month: 10 } as const;
const key = (vehicleId: string, y: number, m: number) => `inspection_critical:${vehicleId}:${y}-${String(m).padStart(2, "0")}`;

// Concurrent callers (parallel requests on a cold instance, layout + page) share ONE
// in-flight pass; every write below is also guarded on the row still being
// November, so even a second instance racing this one can never delete the record
// the other just kept.
let _refile: Promise<void> | null = null;

export function ensureGraceInspectionsRefiled(): Promise<void> {
  if (!_refile) _refile = refileOnce().catch(() => { _refile = null; });
  return _refile;
}

async function refileOnce(): Promise<void> {
  try {
    const misfiled = await prisma.vehicleInspection.findMany({
      where: { year: SOURCE.year, month: SOURCE.month, createdAt: { lt: OCTOBER_GRACE_CUTOFF } },
      select: { id: true, vehicleId: true, date: true, createdAt: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    if (!misfiled.length) return;

    const stillNov = (id: string) => ({ id, year: SOURCE.year, month: SOURCE.month });
    let moved = 0;
    let removed = 0;
    for (const m of misfiled) {
      // Skip if another pass already handled this row.
      const cur = await prisma.vehicleInspection.findFirst({ where: stillNov(m.id), select: { id: true } });
      if (!cur) continue;
      const oct = await prisma.vehicleInspection.findUnique({
        where: { vehicleId_year_month: { vehicleId: m.vehicleId, year: TARGET.year, month: TARGET.month } },
        select: { id: true, date: true, createdAt: true },
      });
      if (oct && oct.id !== m.id) {
        // Duplicate for the same truck — keep the most recent, drop the earlier one.
        const novIsNewer = m.date > oct.date || (m.date.getTime() === oct.date.getTime() && m.createdAt > oct.createdAt);
        if (novIsNewer) {
          await prisma.vehicleInspection.deleteMany({ where: { id: oct.id, year: TARGET.year, month: TARGET.month } });
          const u = await prisma.vehicleInspection.updateMany({ where: stillNov(m.id), data: { year: TARGET.year, month: TARGET.month } }).catch(() => ({ count: 0 }));
          moved += u.count;
        } else {
          await prisma.vehicleInspection.deleteMany({ where: stillNov(m.id) });
        }
        removed++;
      } else {
        const u = await prisma.vehicleInspection.updateMany({ where: stillNov(m.id), data: { year: TARGET.year, month: TARGET.month } }).catch(() => ({ count: 0 }));
        moved += u.count;
      }

      // Carry any critical-failure alert from the November key to October's.
      const novKey = key(m.vehicleId, SOURCE.year, SOURCE.month);
      const octKey = key(m.vehicleId, TARGET.year, TARGET.month);
      const novAlert = await prisma.alert.findUnique({ where: { dedupeKey: novKey } }).catch(() => null);
      if (novAlert) {
        const octAlert = await prisma.alert.findUnique({ where: { dedupeKey: octKey } }).catch(() => null);
        if (octAlert) await prisma.alert.delete({ where: { dedupeKey: novKey } }).catch(() => {});
        else await prisma.alert.update({ where: { dedupeKey: novKey }, data: { dedupeKey: octKey } }).catch(() => {});
      }
    }
    console.log(`ensureGraceInspectionsRefiled: re-filed ${moved} inspection(s) to October 2026; removed ${removed} duplicate(s) (kept the most recent per truck).`);
  } catch (e) {
    console.error("ensureGraceInspectionsRefiled failed (non-fatal):", e);
  }
}

let _naming: Promise<void> | null = null;

export function ensureInspectionTechnicianNames(): Promise<void> {
  if (!_naming) _naming = nameOnce().catch(() => { _naming = null; });
  return _naming;
}

async function nameOnce(): Promise<void> {
  try {
    const [rows, employees] = await Promise.all([
      prisma.vehicleInspection.findMany({ select: { id: true, branch: true, employeeId: true, technicianName: true } }),
      prisma.employee.findMany({ select: { id: true, name: true, role: true, division: true, branch: true, nickname: true, status: true } }),
    ]);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const active = employees.filter((e) => e.status === "active");
    let fixed = 0;
    for (const r of rows) {
      let empId = r.employeeId;
      if (!empId && r.technicianName) {
        // Branch roster first (fewer same-first-name collisions), then everyone active.
        empId =
          matchEmployeeByName(r.technicianName, active.filter((e) => e.branch === r.branch)) ??
          matchEmployeeByName(r.technicianName, active);
      }
      const emp = empId ? byId.get(empId) : null;
      if (!emp) continue;
      if (r.employeeId === emp.id && r.technicianName === emp.name) continue;
      await prisma.vehicleInspection.update({ where: { id: r.id }, data: { employeeId: emp.id, technicianName: emp.name } }).catch(() => {});
      fixed++;
    }
    if (fixed) console.log(`ensureInspectionTechnicianNames: set ${fixed} inspection(s) to the technician's full profile name.`);
  } catch (e) {
    console.error("ensureInspectionTechnicianNames failed (non-fatal):", e);
  }
}
