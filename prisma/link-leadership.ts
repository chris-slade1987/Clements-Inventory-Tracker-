import type { PrismaClient } from "@prisma/client";

// Leadership login → employee-profile backfill.
//
// The leadership super-admin logins (Chris/COO, Tim/President, Julie/Chief of
// Staff, April/Dir. of HR) are ensured on every deploy with role + accessLevel +
// branch (the "super admins ensure" step), but NOTHING there sets
// `User.employeeId`. Separately, Chris's identity is split across two spellings:
// the Paychex/Google roster + login use "Christopher Slade" (work email
// c.slade@…), while the CEO's Org Chart sheet uses "Chris Slade" (no email) — so
// `seedOrgRoster` can mint a SECOND, email-less "Chris Slade" Employee that the
// name-based linkers may grab instead of the canonical census profile, and the
// generic PTO-for-all pass (`ensureLoginsLinked`) can leave c.slade@ unlinked.
// The net effect in prod: `c.slade@…` has `employeeId = null`, so `/me/pto`,
// `/me/profile`, certifications, etc. all show "no employee profile linked".
//
// This pass deterministically links each leadership login to its CANONICAL
// personnel profile — matched on work email FIRST (so Chris gets the census
// "Christopher Slade" row that carries his email, hire date, birthday, and CPO
// license, never the email-less org-chart duplicate), then on a name alias —
// and creates a minimal profile only when the person genuinely has none.
//
// Idempotent + NON-DESTRUCTIVE: it never clobbers a login that already has an
// employeeId, never steals an Employee already linked to a different login, and
// never hard-deletes anything. A second run links/creates nothing.

/** Lowercase, strip non-letters, collapse whitespace — forgiving name matching. */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

type Leader = {
  email: string; // canonical work email (the login we want linked)
  /** Name spellings this person may appear under, canonical first. */
  aliases: string[];
  /** Personnel title used only when we must CREATE a missing profile. */
  title: string;
};

// The leadership super-admins the CEO wants fully provisioned. Emails match the
// "super admins ensure" step in scripts/deploy-db.ts (the shared manager@ login
// is intentionally excluded — it is not a person and has no personnel profile).
const LEADERS: Leader[] = [
  { email: "c.slade@clementspestcontrol.com", aliases: ["Christopher Slade", "Chris Slade"], title: "Chief Operating Officer" },
  { email: "tslade@clementspestcontrol.com", aliases: ["Tim Slade", "Timothy Slade"], title: "President" },
  { email: "jglanville@clementspestcontrol.com", aliases: ["Julie Glanville"], title: "Chief of Staff" },
  { email: "awilliford@clementspestcontrol.com", aliases: ["April Williford"], title: "Dir. of HR/Admin Affairs" },
];

export async function ensureLeadershipLinked(
  prisma: PrismaClient,
): Promise<{ linked: number; created: number; alreadyLinked: number; emailsBackfilled: number; skipped: string[] }> {
  let linked = 0;
  let created = 0;
  let alreadyLinked = 0;
  let emailsBackfilled = 0;
  const skipped: string[] = [];

  // Which Employee ids are already claimed by SOME login (so we never steal one).
  const linkedEmployeeIds = new Set(
    (await prisma.user.findMany({ where: { employeeId: { not: null } }, select: { employeeId: true } })).map(
      (u) => u.employeeId!,
    ),
  );

  for (const leader of LEADERS) {
    try {
      const email = leader.email.toLowerCase().trim();
      const user = await prisma.user.findFirst({ where: { email } });
      if (!user) {
        // The login itself doesn't exist (e.g. not yet provisioned) — nothing to link.
        skipped.push(`${email} (no login)`);
        continue;
      }
      if (user.employeeId) {
        alreadyLinked++;
        continue;
      }

      const aliasKeys = leader.aliases.map(norm);

      // Candidate profiles: the one carrying this work email, plus any under a
      // known name spelling. Pull both so we can prefer the email-bearing census
      // row over the email-less org-chart duplicate.
      // Email is stored lowercased (census data + login sync both lowercase it),
      // so a plain equality on the lowercased value matches without a provider-
      // specific case-insensitive `mode` (which the SQLite dev client lacks).
      const candidates = await prisma.employee.findMany({
        where: {
          OR: [{ email }, { name: { in: leader.aliases } }],
        },
        select: { id: true, name: true, email: true, status: true, hireDate: true },
      });

      // Rank: unclaimed first, then exact email match, then active, then has a
      // hire date (a fuller profile), then the canonical alias ordering.
      const score = (e: (typeof candidates)[number]) =>
        (linkedEmployeeIds.has(e.id) ? 0 : 1000) +
        ((e.email ?? "").toLowerCase().trim() === email ? 400 : 0) +
        (e.status === "active" ? 100 : 0) +
        (e.hireDate ? 50 : 0) +
        (aliasKeys.indexOf(norm(e.name)) >= 0 ? 10 - aliasKeys.indexOf(norm(e.name)) : 0);

      const ranked = [...candidates].sort(
        (a, b) => score(b) - score(a) || (a.hireDate?.getTime() ?? Infinity) - (b.hireDate?.getTime() ?? Infinity),
      );
      let chosen = ranked.find((e) => !linkedEmployeeIds.has(e.id));

      if (!chosen) {
        if (ranked.length > 0) {
          // A profile exists but is already linked to a DIFFERENT login — don't
          // steal it (employee_id is unique). Report and move on.
          skipped.push(`${email} (profile already linked elsewhere)`);
          continue;
        }
        // Genuinely no profile anywhere — create a minimal canonical one.
        const createdEmp = await prisma.employee.create({
          data: {
            name: leader.aliases[0],
            email: leader.email,
            branch: null,
            status: "active",
            role: leader.title,
            title: leader.title,
          },
          select: { id: true, name: true, email: true, status: true, hireDate: true },
        });
        chosen = createdEmp;
        created++;
      } else {
        linked++;
      }

      await prisma.user.update({ where: { id: user.id }, data: { employeeId: chosen.id } });
      linkedEmployeeIds.add(chosen.id);

      // Backfill the work email onto a profile that lacks one, so future email
      // matchers (and the org chart) agree — but only when no OTHER employee
      // already owns that email, to keep it a single, unambiguous owner.
      if ((chosen.email ?? "").toLowerCase().trim() !== email) {
        const emailOwner = await prisma.employee.findFirst({
          where: { email, id: { not: chosen.id } },
          select: { id: true },
        });
        if (!emailOwner) {
          await prisma.employee.update({ where: { id: chosen.id }, data: { email: leader.email } });
          emailsBackfilled++;
        }
      }
    } catch (err) {
      console.error(`link-leadership: failed for ${leader.email}:`, (err as Error).message);
      skipped.push(`${leader.email} (error)`);
    }
  }

  return { linked, created, alreadyLinked, emailsBackfilled, skipped };
}
