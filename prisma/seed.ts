import { PrismaClient } from "@prisma/client";
import { seedDatabase, MANAGER_EMAIL, MANAGER_PASSWORD } from "./seed-core";

const prisma = new PrismaClient();

// Local reset seed: clears existing rows and reloads sample data.
seedDatabase(prisma, { reset: true })
  .then(async (counts) => {
    console.log("Seed complete.");
    console.log(
      `  Warehouses: ${counts.warehouses}   Technicians: ${counts.technicians}   Products: ${counts.products}`
    );
    console.log(`  Manager login:  ${MANAGER_EMAIL}  /  ${MANAGER_PASSWORD}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
