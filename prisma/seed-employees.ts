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

/**
 * Non-destructive contact backfill, safe to run on EVERY deploy (even when the
 * employee table is already populated). Fills in any MISSING email from the
 * roster and ensures each employee with an email has a linked login. Never
 * overwrites an existing email, and never re-roles an existing account — so it
 * can't clobber HR edits made inside the app. This is what makes the messaging
 * "send to" list show real addresses after the roster emails were added.
 */
export async function syncEmployeeContacts(prisma: PrismaClient) {
  let filled = 0;
  let logins = 0;

  // 1) Fill blank emails from the roster (matched by name + branch).
  for (const e of EMPLOYEES) {
    if (!e.email) continue;
    const existing = await prisma.employee.findFirst({ where: { name: e.name, branch: e.branch } });
    if (existing && !(existing.email ?? "").trim()) {
      await prisma.employee.update({ where: { id: existing.id }, data: { email: e.email } });
      filled++;
    }
  }

  // 2) Ensure a login exists for every employee that now has an email.
  const withEmail = await prisma.employee.findMany({ where: { email: { not: null } } });
  for (const e of withEmail) {
    const email = (e.email ?? "").toLowerCase().trim();
    if (!email) continue;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      if (!user.employeeId) await prisma.user.update({ where: { id: user.id }, data: { employeeId: e.id } });
    } else {
      await prisma.user.create({
        data: { name: e.name, email, passwordHash: hashPassword(MANAGER_PASSWORD), role: "employee", branch: e.branch, employeeId: e.id },
      });
      logins++;
    }
  }

  console.log(`syncEmployeeContacts: filled ${filled} missing emails, created ${logins} logins.`);
  return { filled, logins };
}

if (process.argv[1] && process.argv[1].includes("seed-employees")) {
  const prisma = new PrismaClient();
  seedEmployees(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
