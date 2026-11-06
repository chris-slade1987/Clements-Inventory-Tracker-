import "server-only";
import { prisma } from "@/lib/prisma";
import { etParts, managerTodoPeriod } from "@/lib/date";

// Runtime healer: re-file vehicle inspections completed during the October-2026
// grace window so they count toward OCTOBER, not the live calendar month.
//
// The grace directive (lib/date.ts) keeps the manager to-do PERIOD pinned to
// October through Fri 11/6, but an inspection started from the vehicle profile
// (no ?year/&month) used to default to the live month (November). So inspections
// completed in early November — e.g. the spare-truck inspections done to help a
// branch finish its October list — were saved as 2026-11 and then read as
// "pending" against the October list. The form default is now fixed going
// forward (see app/(app)/fleet/[id]/inspect/page.tsx); this sweeps the records
// that were already misfiled before that fix landed.
//
// Policy: while the grace window is open, ALL inspections belong to October, so
// any live-month (November) inspection is moved back to the grace month. A move
// is SKIPPED (left as-is) when the vehicle already has a record in the grace
// month, so no existing October inspection is overwritten and the unique
// [vehicle, year, month] key never collides. Photos travel with the record (they
// link by inspectionId). Runs once per cold start while the window is open, then
// no-ops automatically after it closes (managerTodoPeriod().isOctoberGrace).

let _ran = false;

export async function ensureGraceInspectionsRefiled(): Promise<void> {
  if (_ran) return;
  try {
    const now = new Date();
    const todo = managerTodoPeriod(now);
    // Only act inside the grace window; afterwards the data is already settled.
    if (!todo.isOctoberGrace) {
      _ran = true;
      return;
    }
    const live = etParts(now); // the live calendar month (November during the window)
    const source = { year: live.year, month: live.month };
    const target = { year: todo.year, month: todo.month }; // October 2026
    if (source.year === target.year && source.month === target.month) {
      _ran = true;
      return;
    }

    const misfiled = await prisma.vehicleInspection.findMany({
      where: { year: source.year, month: source.month },
      select: { id: true, vehicleId: true },
    });
    if (!misfiled.length) {
      _ran = true;
      return;
    }

    // Vehicles that already have a grace-month inspection — never overwrite those.
    const existingTarget = await prisma.vehicleInspection.findMany({
      where: { year: target.year, month: target.month, vehicleId: { in: misfiled.map((m) => m.vehicleId) } },
      select: { vehicleId: true },
    });
    const haveTarget = new Set(existingTarget.map((t) => t.vehicleId));

    let moved = 0;
    for (const m of misfiled) {
      if (haveTarget.has(m.vehicleId)) continue;
      await prisma.vehicleInspection
        .update({ where: { id: m.id }, data: { year: target.year, month: target.month } })
        .then(() => {
          moved++;
          // Guard against moving two source rows onto the same vehicle in one pass.
          haveTarget.add(m.vehicleId);
        })
        .catch(() => {});
    }
    _ran = true;
    if (moved) {
      console.log(
        `ensureGraceInspectionsRefiled: moved ${moved} inspection(s) from ${source.year}-${String(source.month).padStart(2, "0")} to ${target.year}-${String(target.month).padStart(2, "0")} (October grace).`,
      );
    }
  } catch (e) {
    console.error("ensureGraceInspectionsRefiled failed (non-fatal):", e);
  }
}
