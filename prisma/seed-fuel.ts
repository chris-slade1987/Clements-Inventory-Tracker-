import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseCoastStatement,
  buildCoastCorpus,
  buildUnitIndex,
  matchVehicle,
  fuelDedupeKey,
  type VehicleMatchRow,
  type RawFuelRow,
} from "../lib/fuel";

// Import the committed Coast fuel statements (prisma/data/fuel/*.xlsx), linking
// each purchase to a vehicle by card ID → plate → look-alike plate → unit#.
// Idempotent: upserts on a per-row dedupe key, so re-running never duplicates.
export async function seedFuel(prisma: PrismaClient) {
  const dir = join(process.cwd(), "prisma", "data", "fuel");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xlsx")).sort();
  } catch {
    console.log("seed-fuel: no statements directory — skipping.");
    return { statements: 0, rows: 0, linked: 0, account: 0, unlinked: 0 };
  }

  const vehicles: VehicleMatchRow[] = await prisma.vehicle.findMany({
    select: { id: true, unitNumber: true, plate: true, driverCard: true },
  });
  const unitIndex = buildUnitIndex(vehicles);

  // Pass 1: parse every statement and learn Coast's own plate→unit / card→unit
  // mapping from the rows that carry a numeric unit number.
  const parsed = files.map((file) => ({ file, stmt: parseCoastStatement(new Uint8Array(readFileSync(join(dir, file)))) }));
  const allRows: RawFuelRow[] = parsed.flatMap((p) => p.stmt.rows);
  const corpus = buildCoastCorpus(allRows);

  let rowsTotal = 0;
  let linked = 0;
  let account = 0;
  let unlinked = 0;
  const methodCounts: Record<string, number> = {};

  // Pass 2: resolve + upsert.
  for (const { file, stmt } of parsed) {
    for (const row of stmt.rows) {
      const { vehicleId, method } = matchVehicle(row, corpus, unitIndex);
      methodCounts[method] = (methodCounts[method] ?? 0) + 1;
      if (vehicleId) linked++;
      else if (method === "account") account++;
      else unlinked++;

      const dm = row.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const rowDate = dm ? new Date(Date.UTC(Number(dm[3]), Number(dm[1]) - 1, Number(dm[2]))) : new Date();

      const dedupeKey = fuelDedupeKey(stmt.statementNumber || file, row);
      const data = {
        vehicleId,
        date: rowDate,
        postedTime: row.time || null,
        driverName: row.driver || null,
        merchant: row.merchant || null,
        description: row.description || null,
        type: row.type || "Purchase",
        category: row.category || null,
        amount: row.amount,
        gallons: row.gallons,
        costPerGallon: row.costPerGallon,
        fuelGrade: row.fuelGrade || null,
        odometer: row.odometer,
        calculatedMpg: row.calculatedMpg,
        mileageDriven: row.mileageDriven,
        cardId: row.cardId || null,
        cardLast4: row.cardLast4 || null,
        plate: row.plate || null,
        branch: row.branch || null,
        matchMethod: method,
        statementNumber: stmt.statementNumber || null,
        periodStart: stmt.periodStart,
        periodEnd: stmt.periodEnd,
      };
      await prisma.fuelTransaction.upsert({
        where: { dedupeKey },
        create: { dedupeKey, ...data },
        update: data,
      });
      rowsTotal++;
    }
  }

  console.log(
    `seed-fuel: ${files.length} statements, ${rowsTotal} rows (${linked} linked, ${account} account-level, ${unlinked} unlinked). Methods: ${JSON.stringify(methodCounts)}`,
  );
  return { statements: files.length, rows: rowsTotal, linked, account, unlinked };
}

if (process.argv[1] && process.argv[1].includes("seed-fuel")) {
  const prisma = new PrismaClient();
  seedFuel(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
