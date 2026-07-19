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

if (process.argv[1] && process.argv[1].includes("seed-access")) {
  const prisma = new PrismaClient();
  grantSeniorLeadership(prisma)
    .then((r) => console.log(`Senior leadership granted: ${r.granted} user(s).`))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
