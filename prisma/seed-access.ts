import { PrismaClient } from "@prisma/client";

// Access grants that aren't tied to a person's role. Runs every deploy —
// non-destructive and idempotent (updateMany just re-sets the flag).

// The "senior leadership" group may view the Compliance Command Center even
// though most of them are `role: "employee"`. Admins always retain access via
// canViewCompliance(); this list adds the named non-admins. Add people here.
const SENIOR_LEADERSHIP_EMAILS = [
  "c.slade@clementspestcontrol.com", // Chris (also an admin)
  "jglanville@clementspestcontrol.com", // Julie
  "awilliford@clementspestcontrol.com", // April
];

/** Grant/refresh senior-leadership access — safe to run every deploy. */
export async function grantSeniorLeadership(prisma: PrismaClient) {
  const res = await prisma.user.updateMany({
    where: { email: { in: SENIOR_LEADERSHIP_EMAILS } },
    data: { seniorLeadership: true },
  });
  return { granted: res.count };
}

// HR access — may run the pre-hire onboarding portal (and future HR tools).
// Admins always qualify via canManagePreHire(); this list adds named non-admins.
// Only April for now (Chris runs it as admin). Add people here to extend.
const HR_EMAILS = [
  "awilliford@clementspestcontrol.com", // April — HR
];

/** Grant/refresh HR access — safe to run every deploy. */
export async function grantHrAccess(prisma: PrismaClient) {
  const res = await prisma.user.updateMany({ where: { email: { in: HR_EMAILS } }, data: { hrAccess: true } });
  return { granted: res.count };
}

// Board observers — board members with strictly read-only access to the
// executive views (Board / Executive, Management, Sales & Attrition,
// Compliance). They are role: "employee" with the boardObserver flag; the
// stripped shell + server-side write denies keep them read-only.
//
// This list is the durable grant: the CEO adds board members' emails here (once
// they have a login) and it re-applies every deploy. The primary path for
// creating a board-member login is the admin Manage → Managers flow ("Board
// observer" checkbox), so this can safely start EMPTY.
const BOARD_OBSERVER_EMAILS: string[] = [
  // e.g. "director@example.com", — CEO adds board members' emails here.
];

/** Grant/refresh board-observer access — safe to run every deploy (no-op while
 *  the email list is empty). Never revokes; only sets the flag. */
export async function grantBoardObserver(prisma: PrismaClient) {
  if (BOARD_OBSERVER_EMAILS.length === 0) return { granted: 0 };
  const res = await prisma.user.updateMany({
    where: { email: { in: BOARD_OBSERVER_EMAILS } },
    data: { boardObserver: true },
  });
  return { granted: res.count };
}

if (process.argv[1] && process.argv[1].includes("seed-access")) {
  const prisma = new PrismaClient();
  grantSeniorLeadership(prisma)
    .then((r) => console.log(`Senior leadership granted: ${r.granted} user(s).`))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
