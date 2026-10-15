import type { PrismaClient } from "@prisma/client";

// PTO-for-all backfill. PTO self-service keys off `User.employeeId` (the
// `/me/pto` page and the POST /api/pto handler both require it), so any active
// login WITHOUT a linked personnel profile silently can't request PTO. In
// practice the four branch-manager logins (and Howard, historically) were
// created without one. This links every active, unlinked login to an existing
// user-less Employee — matched on work email first, then on normalized
// name/nickname — and creates a minimal Employee when no match exists.
//
// Idempotent and NON-DESTRUCTIVE: it never unlinks, never touches a login that
// already has an employeeId, and never claims an Employee that is already linked
// to someone else. A second run links/creates nothing (returns {linked:0, created:0}).

/** Lowercase, strip non-letters, collapse whitespace — for forgiving name matching. */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Map a login's role to the personnel profile's role label. */
function employeeRoleFor(userRole: string): string {
  return userRole === "manager" || userRole === "admin" ? "Manager" : "Technician";
}

export async function ensureLoginsLinked(
  prisma: PrismaClient,
): Promise<{ linked: number; created: number }> {
  let linked = 0;
  let created = 0;

  // Active logins with no personnel profile.
  const unlinked = await prisma.user.findMany({
    where: { active: true, employeeId: null },
    select: { id: true, name: true, email: true, branch: true, role: true },
  });
  if (unlinked.length === 0) return { linked, created };

  // Candidate Employees that aren't claimed by any login yet.
  const freeEmployees = await prisma.employee.findMany({
    where: { status: "active", user: { is: null } },
    select: { id: true, name: true, nickname: true, email: true },
  });

  // Index the free employees by email and by normalized name/nickname. We remove
  // an employee from the pool as soon as it's claimed so two logins can't grab
  // the same profile (employee_id is unique).
  const byEmail = new Map<string, string>(); // email -> employeeId
  const byName = new Map<string, string>(); // normalized name/nickname -> employeeId
  for (const e of freeEmployees) {
    const em = e.email?.toLowerCase().trim();
    if (em && !byEmail.has(em)) byEmail.set(em, e.id);
    const n = norm(e.name);
    if (n && !byName.has(n)) byName.set(n, e.id);
    const nn = norm(e.nickname);
    if (nn && !byName.has(nn)) byName.set(nn, e.id);
  }
  const claimed = new Set<string>();

  for (const u of unlinked) {
    try {
      const email = u.email.toLowerCase().trim();
      let empId: string | null = null;

      // 1) Exact work-email match.
      const byEmailId = byEmail.get(email);
      if (byEmailId && !claimed.has(byEmailId)) empId = byEmailId;

      // 2) Normalized name match.
      if (!empId) {
        const byNameId = byName.get(norm(u.name));
        if (byNameId && !claimed.has(byNameId)) empId = byNameId;
      }

      if (empId) {
        await prisma.user.update({ where: { id: u.id }, data: { employeeId: empId } });
        claimed.add(empId);
        linked++;
        continue;
      }

      // 3) No match — create a minimal personnel profile and link it.
      const emp = await prisma.employee.create({
        data: {
          name: u.name,
          email: u.email,
          branch: u.branch,
          role: employeeRoleFor(u.role),
          status: "active",
        },
      });
      await prisma.user.update({ where: { id: u.id }, data: { employeeId: emp.id } });
      created++;
    } catch (err) {
      console.error(`link-logins: failed for ${u.email}:`, (err as Error).message);
    }
  }

  return { linked, created };
}
