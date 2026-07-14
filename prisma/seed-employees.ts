import { PrismaClient } from "@prisma/client";
import { EMPLOYEES } from "./employee-data";
import { hashPassword, MANAGER_PASSWORD } from "./seed-core";

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
  // Employee logins — one per employee with an email, linked to their profile.
  // Existing accounts (managers/admins) are just linked, never re-roled.
  let logins = 0;
  const withEmail = await prisma.employee.findMany({ where: { email: { not: null } } });
  for (const e of withEmail) {
    const email = e.email!.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (!existing.employeeId) await prisma.user.update({ where: { id: existing.id }, data: { employeeId: e.id } });
    } else {
      await prisma.user.create({
        data: { name: e.name, email, passwordHash: hashPassword(MANAGER_PASSWORD), role: "employee", branch: e.branch, employeeId: e.id },
      });
      logins++;
    }
  }
  console.log(`Seeded employees: ${created} created, ${updated} updated; ${logins} employee logins (${EMPLOYEES.length} in sheet).`);
  return { created, updated, total: EMPLOYEES.length, logins };
}

if (process.argv[1] && process.argv[1].includes("seed-employees")) {
  const prisma = new PrismaClient();
  seedEmployees(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
