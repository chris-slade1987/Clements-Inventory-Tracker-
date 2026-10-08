import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth";

const DEFAULT_PW = "clements123";

/**
 * Make one login usable and canonical: set its email to the employee-profile email
 * (so the email shown on the org chart / profile is the email you actually sign in
 * with), set it active, and reset the password to clements123. Any OTHER account
 * squatting on that email is parked + disabled so there is exactly one. Returns the
 * final login email.
 */
export async function alignLogin(prisma: PrismaClient, userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { employee: { select: { email: true, name: true } } },
  });
  if (!u) throw new Error("Account not found.");

  // A parked duplicate (disabled during an earlier consolidation) must stay
  // disabled — never reactivate it.
  if (u.email.endsWith("@clementspestcontrol.invalid")) return u.email;

  let profileEmail = u.employee?.email?.toLowerCase().trim() || null;
  if (!profileEmail) {
    const emp = await prisma.employee.findFirst({ where: { name: u.name, email: { not: null } }, select: { email: true } });
    profileEmail = emp?.email?.toLowerCase().trim() || null;
  }
  const targetEmail = profileEmail || u.email.toLowerCase();

  if (targetEmail !== u.email.toLowerCase()) {
    const squatter = await prisma.user.findUnique({ where: { email: targetEmail } });
    if (squatter && squatter.id !== u.id) {
      await prisma.user.update({
        where: { id: squatter.id },
        data: { active: false, email: `disabled+${squatter.id}@clementspestcontrol.invalid` },
      });
    }
  }

  await prisma.user.update({
    where: { id: u.id },
    data: { email: targetEmail, active: true, passwordHash: hashPassword(DEFAULT_PW), mustChangePassword: true },
  });
  return targetEmail;
}

/** Reset EVERY login to profile-email + clements123 + active. One-shot "get
 *  everyone able to sign in" action. Returns counts + any per-account errors. */
export async function resetAllLogins(prisma: PrismaClient): Promise<{ fixed: number; total: number; errors: string[] }> {
  const users = await prisma.user.findMany({ select: { id: true } });
  let fixed = 0;
  const errors: string[] = [];
  for (const u of users) {
    try { await alignLogin(prisma, u.id); fixed++; } catch (e) { errors.push(`${u.id}: ${(e as Error).message}`); }
  }
  return { fixed, total: users.length, errors };
}
