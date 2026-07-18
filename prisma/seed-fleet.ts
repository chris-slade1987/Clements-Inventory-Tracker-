import { PrismaClient } from "@prisma/client";
import { FLEET_VEHICLES } from "./fleet-data";

// Seeds the Fleet registry from the master sheet (prisma/fleet-data.ts).
// Idempotent: upserts by VIN, falling back to unit number, so re-running never
// duplicates a vehicle and never clobbers service history.

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

export async function seedFleet(prisma: PrismaClient) {
  let created = 0;
  let updated = 0;
  for (const v of FLEET_VEHICLES) {
    const data = {
      unitNumber: v.unitNumber,
      name: v.name,
      year: v.year,
      make: v.make,
      model: v.model,
      vin: v.vin,
      plate: v.plate,
      branch: v.branch,
      assignedTo: v.assignedTo,
      driverCard: v.driverCard,
      driverLicense: v.driverLicense,
      registrationRenewal: d(v.registrationRenewal),
      gps: v.gps,
      loanBank: v.loanBank,
      loanNumber: v.loanNumber,
      monthlyPayment: v.monthlyPayment,
      payoffDate: d(v.payoffDate),
      currentMileage: v.currentMileage,
      mileageAsOf: v.currentMileage != null ? new Date("2026-07-01T00:00:00.000Z") : null,
      statusNotes: v.statusNotes,
    };
    const existing = await prisma.vehicle.findFirst({
      where: {
        OR: [
          v.vin ? { vin: v.vin } : { id: "___none___" },
          v.unitNumber ? { unitNumber: v.unitNumber } : { id: "___none___" },
        ],
      },
    });
    if (existing) {
      await prisma.vehicle.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.vehicle.create({ data });
      created++;
    }
  }
  console.log(`Seeded fleet: ${created} created, ${updated} updated (${FLEET_VEHICLES.length} in sheet).`);
  return { created, updated, total: FLEET_VEHICLES.length };
}

/**
 * Non-destructive spec sync, safe to run on EVERY deploy. Updates the fleet
 * "identity" fields (plate, fuel card, registration renewal, GPS) from the
 * sheet for vehicles that already exist — so corrections like a plate
 * reconciled from Coast reach an already-populated database — without touching
 * mileage, disposition, service history, or anything edited inside the app.
 */
export async function syncFleetSpecs(prisma: PrismaClient) {
  let updated = 0;
  for (const v of FLEET_VEHICLES) {
    const existing = await prisma.vehicle.findFirst({
      where: { OR: [v.vin ? { vin: v.vin } : { id: "___none___" }, v.unitNumber ? { unitNumber: v.unitNumber } : { id: "___none___" }] },
    });
    if (!existing) continue;
    const next = {
      plate: v.plate,
      driverCard: v.driverCard,
      registrationRenewal: d(v.registrationRenewal),
      gps: v.gps,
    };
    const changed =
      existing.plate !== next.plate ||
      existing.driverCard !== next.driverCard ||
      (existing.registrationRenewal?.getTime() ?? null) !== (next.registrationRenewal?.getTime() ?? null) ||
      existing.gps !== next.gps;
    if (changed) {
      await prisma.vehicle.update({ where: { id: existing.id }, data: next });
      updated++;
    }
  }
  console.log(`syncFleetSpecs: updated ${updated} vehicle(s) from the fleet sheet.`);
  return { updated };
}

// CLI: `npx tsx prisma/seed-fleet.ts`
if (process.argv[1] && process.argv[1].includes("seed-fleet")) {
  const prisma = new PrismaClient();
  seedFleet(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
