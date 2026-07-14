import { PrismaClient } from "@prisma/client";
import { EMPLOYEES } from "./employee-data";

// Seeds personnel profiles from the contact sheet. Idempotent: matches on
// (name, branch) so re-running updates role/division without duplicating.
export async function seedEmployees(prisma: PrismaClient) {
  let created = 0;
  let updated = 0;
  for (const e of EMPLOYEES) {
    const existing = await prisma.employee.findFirst({ where: { name: e.name, branch: e.branch } });
    if (existing) {
      await prisma.employee.update({ where: { id: existing.id }, data: { email: e.email, role: e.role, division: e.division } });
      updated++;
    } else {
      await prisma.employee.create({ data: { name: e.name, email: e.email, role: e.role, division: e.division, branch: e.branch } });
      created++;
    }
  }
  console.log(`Seeded employees: ${created} created, ${updated} updated (${EMPLOYEES.length} in sheet).`);
  return { created, updated, total: EMPLOYEES.length };
}

if (process.argv[1] && process.argv[1].includes("seed-employees")) {
  const prisma = new PrismaClient();
  seedEmployees(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
