/**
 * Deploy-time database bootstrap. Runs during `npm run build`.
 *
 * - Local / SQLite (DATABASE_URL starts with "file:"): does nothing, so the
 *   local sandbox and `npm run dev` are unaffected.
 * - Postgres (DATABASE_URL starts with "postgres"): flips the Prisma datasource
 *   provider to postgresql (build-time only, not committed), creates the schema
 *   with `prisma db push`, and loads sample data if the database is empty.
 *
 * This lets a fresh Vercel deploy come up fully working with zero manual steps.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL ?? "";

async function main() {
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    console.log("deploy-db: non-Postgres DATABASE_URL — skipping (local/dev).");
    return;
  }

  // Switch the datasource to Postgres for this build only.
  const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
  const schema = readFileSync(schemaPath, "utf8");
  if (schema.includes('provider = "sqlite"')) {
    writeFileSync(
      schemaPath,
      schema.replace('provider = "sqlite"', 'provider = "postgresql"')
    );
    console.log("deploy-db: switched Prisma provider to postgresql.");
  }

  // Create/align the schema (also regenerates the client for Postgres).
  console.log("deploy-db: running prisma db push…");
  execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });

  // Seed sample data only when the database is empty; otherwise just backfill
  // any missing standard branches (e.g. Naples) without touching existing data.
  const { PrismaClient } = await import("@prisma/client");
  const { seedDatabase, ensureWarehouses } = await import("../prisma/seed-core");
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users === 0) {
      const c = await seedDatabase(prisma, { reset: false });
      console.log(
        `deploy-db: seeded ${c.warehouses} warehouses, ${c.technicians} technicians, ${c.products} products.`
      );
    } else {
      const map = await ensureWarehouses(prisma);
      console.log(
        `deploy-db: database already populated (${users} users) — ensured ${map.size} branches exist.`
      );
    }
    // Seed management KPIs only when empty, so uploaded months are never clobbered.
    const kpiValues = await prisma.kpiValue.count();
    if (kpiValues === 0) {
      const { seedManagement } = await import("../prisma/seed-management");
      const m = await seedManagement(prisma);
      console.log(`deploy-db: seeded management KPIs (${m.periods} periods, ${m.values} values).`);
    } else {
      console.log(`deploy-db: management KPIs present (${kpiValues} values) — left as-is.`);
    }

    // Seed the fleet registry only when empty, so re-imports / edits are never clobbered.
    const vehicles = await prisma.vehicle.count();
    if (vehicles === 0) {
      const { seedFleet } = await import("../prisma/seed-fleet");
      const f = await seedFleet(prisma);
      console.log(`deploy-db: seeded fleet (${f.total} vehicles).`);
    } else {
      console.log(`deploy-db: fleet present (${vehicles} vehicles) — left as-is.`);
    }

    // Keep vehicle specs (plate, fuel card, registration) in sync with the fleet
    // sheet on every deploy — non-destructive, so it repairs an older deploy
    // (e.g. plates reconciled from Coast) without touching mileage or disposition.
    const { syncFleetSpecs } = await import("../prisma/seed-fleet");
    const fs = await syncFleetSpecs(prisma);
    console.log(`deploy-db: synced fleet specs — ${fs.updated} vehicle(s) updated.`);

    // Import Coast fuel statements only when empty, so re-imports/edits stay put.
    const fuel = await prisma.fuelTransaction.count();
    if (fuel === 0) {
      const { seedFuel } = await import("../prisma/seed-fuel");
      const fl = await seedFuel(prisma);
      console.log(`deploy-db: imported fuel (${fl.rows} rows, ${fl.linked} linked to vehicles).`);
    } else {
      console.log(`deploy-db: fuel present (${fuel} transactions) — left as-is.`);
    }

    // Seed personnel profiles when empty; otherwise backfill any missing emails
    // and logins from the roster (non-destructive — never overwrites edits). The
    // backfill is what repairs an older deploy that predates the roster emails.
    const employees = await prisma.employee.count();
    if (employees === 0) {
      const { seedEmployees } = await import("../prisma/seed-employees");
      const e = await seedEmployees(prisma);
      console.log(`deploy-db: seeded people (${e.total} employees, ${e.logins} logins).`);
    } else {
      const { syncEmployeeContacts } = await import("../prisma/seed-employees");
      const s = await syncEmployeeContacts(prisma);
      console.log(`deploy-db: people present (${employees}) — backfilled ${s.filled} emails, ${s.logins} logins.`);
    }

    // Seed a sample training course only when none exist.
    const courses = await prisma.course.count();
    if (courses === 0) {
      const { seedTraining } = await import("../prisma/seed-training");
      const t = await seedTraining(prisma);
      console.log(`deploy-db: seeded training (${t.created} course, ${t.assigned} assignments).`);
    } else {
      console.log(`deploy-db: training present (${courses} courses) — left as-is.`);
    }

    // Seed insurance policies only when empty, so edits/uploads aren't clobbered.
    const insurance = await prisma.insurancePolicy.count();
    if (insurance === 0) {
      const { seedInsurance } = await import("../prisma/seed-insurance");
      const ins = await seedInsurance(prisma);
      console.log(`deploy-db: seeded insurance (${ins.total} policies).`);
    } else {
      console.log(`deploy-db: insurance present (${insurance} policies) — left as-is.`);
    }

    // Remove the "Jordan Rivera" demo new-hire (a placeholder used while building
    // the review flow). Deleting the profile cascades its reviews; the login goes
    // first. Idempotent — a no-op once it's gone. Real reviews are created in-app.
    const demo = await prisma.employee.findFirst({ where: { email: "jordan.rivera@clementspestcontrol.com" } });
    if (demo) {
      await prisma.user.deleteMany({ where: { employeeId: demo.id } });
      await prisma.employee.delete({ where: { id: demo.id } });
      console.log("deploy-db: removed Jordan Rivera demo new-hire.");
    } else {
      console.log("deploy-db: no demo new-hire to remove.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("deploy-db failed:", e);
  process.exit(1);
});
