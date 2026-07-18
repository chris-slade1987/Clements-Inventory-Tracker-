import { PrismaClient } from "@prisma/client";
import { seedDatabase, MANAGER_EMAIL, MANAGER_PASSWORD } from "./seed-core";
import { seedManagement } from "./seed-management";
import { seedFleet } from "./seed-fleet";
import { seedFuel } from "./seed-fuel";
import { seedEmployees } from "./seed-employees";
import { seedTraining } from "./seed-training";
import { seedInsurance } from "./seed-insurance";
import { seedBranchHub } from "./seed-branch";

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
    console.log("Seed complete.");
    console.log(
      `  Warehouses: ${counts.warehouses}   Technicians: ${counts.technicians}   Products: ${counts.products}`
    );
    console.log(`  Management: ${mgmt.periods} periods, ${mgmt.values} KPI values`);
    console.log(`  Fleet: ${fleet.total} vehicles`);
    console.log(`  Fuel: ${fuel.rows} transactions (${fuel.linked} linked)`);
    console.log(`  People: ${people.total} employees`);
    console.log(`  Manager login:  ${MANAGER_EMAIL}  /  ${MANAGER_PASSWORD}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
