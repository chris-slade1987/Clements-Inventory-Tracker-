import { PrismaClient } from "@prisma/client";
import { EMPLOYEES } from "./employee-data";
import { hashPassword, MANAGER_PASSWORD } from "./seed-core";

// Parse an ISO "YYYY-MM-DD" hire date as UTC midnight so the stored date is
// timezone-stable (no off-by-one when formatted). Undefined seed value -> null.
function hireDateOf(hireDate?: string): Date | null {
  if (!hireDate) return null;
  const d = new Date(hireDate + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

// One-off, idempotent correction: Justin Chen (jchen@clementspestcontrol.com) is
// a shareholder, not staff, and was seeded into the roster by mistake. Remove his
// personnel profile and login. Tightly scoped to that single identity (name +
// email). Runs on every deploy so prod is corrected too; a no-op once he's gone.
// Dependent rows are cleared first so the delete can't fail — cascades cover
// records/reviews/PTO/separation/training; RESTRICT relations (inspections,
// ride-alongs) are nulled defensively. Never throws: logs and moves on.
export async function removeJustinChen(prisma: PrismaClient) {
  const EMAIL = "jchen@clementspestcontrol.com";
  try {
    const emp = await prisma.employee.findFirst({
      where: { AND: [{ name: "Justin Chen" }, { OR: [{ email: EMAIL }, { email: null }] }] },
    });
    // Always drop the stray login keyed to that email, whether or not the profile exists.
    const delUser = await prisma.user.deleteMany({ where: { email: EMAIL } });
    if (!emp) {
      if (delUser.count) console.log(`removeJustinChen: no profile; removed ${delUser.count} stray login.`);
      return { removed: 0, loginsRemoved: delUser.count };
    }
    // Clear RESTRICT-style references that would otherwise block the delete.
    await prisma.vehicleInspection.updateMany({ where: { employeeId: emp.id }, data: { employeeId: null } });
    await prisma.auditRideAlong.updateMany({ where: { employeeId: emp.id }, data: { employeeId: null } });
    // Detach any remaining login (defensive; the deleteMany above usually got it).
    await prisma.user.updateMany({ where: { employeeId: emp.id }, data: { employeeId: null } });
    await prisma.employee.delete({ where: { id: emp.id } });
    console.log(`removeJustinChen: removed Justin Chen profile (${emp.id}) and ${delUser.count} login(s).`);
    return { removed: 1, loginsRemoved: delUser.count };
  } catch (e) {
    console.warn(`removeJustinChen: skipped (non-fatal) — ${(e as Error).message}`);
    return { removed: 0, loginsRemoved: 0 };
  }
}

// Seeds personnel profiles from the contact sheet. Idempotent: matches on
// (name, branch) so re-running updates role/division without duplicating.
export async function seedEmployees(prisma: PrismaClient) {
  let created = 0;
  let updated = 0;
  for (const e of EMPLOYEES) {
    const hireDate = hireDateOf(e.hireDate);
    const existing = await prisma.employee.findFirst({ where: { name: e.name, branch: e.branch } });
    if (existing) {
      await prisma.employee.update({
        where: { id: existing.id },
        // hireDate only set when the census provides one (census is authoritative);
        // never clears an existing date when the seed row has none.
        data: { email: e.email, role: e.role, division: e.division, ...(hireDate ? { hireDate } : {}) },
      });
      updated++;
    } else {
      await prisma.employee.create({ data: { name: e.name, email: e.email, role: e.role, division: e.division, branch: e.branch, hireDate } });
      created++;
    }
  }
  // Remove the mis-seeded shareholder profile before (re)building logins, so it
  // can't receive a fresh login below.
  await removeJustinChen(prisma);
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
  let hireDates = 0;

  // 1) Fill blank emails from the roster (matched by name + branch) and apply the
  //    census hire date (authoritative — overwrite is fine). Only hireDate/email
  //    are touched here; role/division/phone and other in-app HR edits are left
  //    untouched so this stays safe to run on every deploy.
  for (const e of EMPLOYEES) {
    const existing = await prisma.employee.findFirst({ where: { name: e.name, branch: e.branch } });
    if (!existing) continue;
    const data: { email?: string; hireDate?: Date } = {};
    if (e.email && !(existing.email ?? "").trim()) data.email = e.email;
    const hireDate = hireDateOf(e.hireDate);
    if (hireDate && existing.hireDate?.getTime() !== hireDate.getTime()) data.hireDate = hireDate;
    if (Object.keys(data).length === 0) continue;
    await prisma.employee.update({ where: { id: existing.id }, data });
    if (data.email) filled++;
    if (data.hireDate) hireDates++;
  }

  // 1b) Remove the mis-seeded shareholder profile + login (idempotent) before the
  //     login sweep, so a stale Justin Chen row can't be re-linked to a login.
  await removeJustinChen(prisma);

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

  console.log(`syncEmployeeContacts: filled ${filled} missing emails, set ${hireDates} hire dates, created ${logins} logins.`);
  return { filled, logins, hireDates };
}

if (process.argv[1] && process.argv[1].includes("seed-employees")) {
  const prisma = new PrismaClient();
  seedEmployees(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
