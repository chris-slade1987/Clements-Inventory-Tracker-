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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("deploy-db failed:", e);
  process.exit(1);
});
