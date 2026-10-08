import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth";
import { LEVEL_ROLE, type AccessLevelKey } from "@/lib/access-levels";

const DEFAULT_PW = "clements123";

/** Generate the standard work email from a name (first.last@…) as a fallback when
 *  the employee profile has none. Mirrors the roster seed's helper. */
function emailFor(name: string): string {
  const parts = name.trim().toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "user";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return `${last ? `${first}.${last}` : first}@clementspestcontrol.com`;
}

export type GrantLoginResult = { email: string; created: boolean; userId: string };

/**
 * Give an employee a usable sign-in account at the chosen access level — the
 * runtime counterpart to the roster seed, so a NEW hire can get a login without a
 * deploy. Idempotent:
 *
 *  - If the employee already has a linked login, it stays (email + password
 *    untouched) and only its access level + role are (re)set.
 *  - Otherwise a login is created (or an existing unlinked account at the same
 *    email is claimed) at the employee's profile email, activated, linked to the
 *    profile, and given the shared default password `clements123` to reset.
 *
 * The access level drives the matching `role` (see LEVEL_ROLE). Throws on a bad
 * level, a missing employee, or an email already owned by a DIFFERENT person.
 */
export async function grantLogin(
  prisma: PrismaClient,
  employeeId: string,
  accessLevel: string,
): Promise<GrantLoginResult> {
  if (!(accessLevel in LEVEL_ROLE)) throw new Error("Unknown access level.");
  const role = LEVEL_ROLE[accessLevel as AccessLevelKey];

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  if (!emp) throw new Error("Employee not found.");

  // Already has a login — just (re)apply the access level + role, keep it active.
  if (emp.user) {
    const u = await prisma.user.update({
      where: { id: emp.user.id },
      data: { accessLevel, role, active: true },
    });
    return { email: u.email, created: false, userId: u.id };
  }

  const email = (emp.email?.toLowerCase().trim() || emailFor(emp.name));

  // Claim an existing unlinked account at this email, else create a fresh one.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.employeeId && existing.employeeId !== emp.id)
      throw new Error("That email already belongs to another person's login.");
    const u = await prisma.user.update({
      where: { id: existing.id },
      data: { employeeId: emp.id, accessLevel, role, active: true, name: emp.name },
    });
    return { email: u.email, created: false, userId: u.id };
  }

  const u = await prisma.user.create({
    data: {
      name: emp.name,
      email,
      passwordHash: hashPassword(DEFAULT_PW),
      role,
      accessLevel,
      branch: emp.branch,
      employeeId: emp.id,
      mustChangePassword: true,
    },
  });
  return { email: u.email, created: true, userId: u.id };
}
