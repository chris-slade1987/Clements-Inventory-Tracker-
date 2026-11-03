import "server-only";
import { prisma } from "@/lib/prisma";
import { seedFleet } from "@/prisma/seed-fleet";

// Runtime healer: force-sync the Fleet registry from the reconciled master sheet
// (prisma/fleet-data.ts) into the live DB. The build seed doesn't reliably reach
// the prod runtime DB, and an earlier bad in-app fleet upload scrambled vehicle
// fields, so this upserts every vehicle by VIN (loans, registration renewals,
// driver cards, assignments, branch, GPS, plates) and creates the new units
// (43–48 + the Stuart trailer). Revisioned (Setting `fleet_master_rev`): a bumped
// REVISION re-applies; an unchanged one is a no-op fast-path. Heavy but once; non-fatal.
//
// Non-destructive: matches by VIN/unit and never deletes a vehicle or its service
// history. Mileage/notes/inspectExempt come from the committed baseline.

const REVISION = "2026-11-03";
let _ran = false;

export async function ensureFleetMaster(): Promise<void> {
  if (_ran) return;
  try {
    const markerKey = "fleet_master_rev";
    const marker = await prisma.setting.findUnique({ where: { key: markerKey } });
    if (marker?.value === REVISION) { _ran = true; return; }

    const res = await seedFleet(prisma);
    await prisma.setting.upsert({
      where: { key: markerKey },
      update: { value: REVISION },
      create: { key: markerKey, value: REVISION },
    });
    _ran = true;
    console.log(`ensureFleetMaster: synced fleet rev ${REVISION} —`, JSON.stringify(res));
  } catch (e) {
    console.error("ensureFleetMaster failed (non-fatal):", e);
  }
}
