import { PrismaClient } from "@prisma/client";
import { seedDatabase, MANAGER_EMAIL, MANAGER_PASSWORD } from "./seed-core";
import { seedManagement } from "./seed-management";
import { seedFleet } from "./seed-fleet";
import { seedFuel } from "./seed-fuel";
import { seedEmployees } from "./seed-employees";
import { seedTraining } from "./seed-training";
import { seedInsurance } from "./seed-insurance";
import { seedBranchHub } from "./seed-branch";
import { seedHiringTemplates } from "./seed-hiring-templates";
import { seedApprovedProducts } from "./seed-products-approved";
import { seedEpaNumbers } from "./seed-epa-numbers";
import { seedOnHandCount } from "./seed-onhand-count";

const prisma = new PrismaClient();

// Local reset seed: clears existing rows and reloads sample data.
seedDatabase(prisma, { reset: true })
  .then(async (counts) => {
    const mgmt = await seedManagement(prisma);
    const fleet = await seedFleet(prisma);
    const fuel = await seedFuel(prisma);
    const people = await seedEmployees(prisma);
    await seedTraining(prisma);
    await seedInsurance(prisma);
    await seedBranchHub(prisma);
    const hiring = await seedHiringTemplates(prisma);
    // Reconcile the approved catalog first (matching needs it), then apply the
    // real physical on-hand counts (idempotent — guarded by a Setting marker).
    await seedApprovedProducts(prisma);
    // Backfill verified EPA registration numbers + official SDS links (blank
    // where unconfirmed; never overwrites an existing value with a blank).
    try {
      const epa = await seedEpaNumbers(prisma);
      console.log(`  EPA/SDS backfill: ${epa.epaSet} EPA, ${epa.sdsSet} SDS set (${epa.epaUnmatched}/${epa.sdsUnmatched} unmatched locally).`);
    } catch (e) {
      console.error("  EPA/SDS backfill FAILED (non-fatal):", e);
    }
    const onhand = await seedOnHandCount(prisma);
    console.log("Seed complete.");
    console.log(
      `  Warehouses: ${counts.warehouses}   Technicians: ${counts.technicians}   Products: ${counts.products}`
    );
    console.log(`  Management: ${mgmt.periods} periods, ${mgmt.values} KPI values`);
    console.log(`  Fleet: ${fleet.total} vehicles`);
    console.log(`  Fuel: ${fuel.rows} transactions (${fuel.linked} linked)`);
    console.log(`  People: ${people.total} employees`);
    console.log(`  Hiring templates: ${hiring.templatesCreated} created (${hiring.templatesTotal} off-the-shelf), ${hiring.bankUpserted} bank items`);
    console.log(`  On-hand count 7/27/2026: applied=${onhand.applied}, ${onhand.adjustmentsCreated} adjustments, ${onhand.productsZeroed} zeroed, ${onhand.unmatched.length} unmatched`);
    console.log(`  Manager login:  ${MANAGER_EMAIL}  /  ${MANAGER_PASSWORD}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
