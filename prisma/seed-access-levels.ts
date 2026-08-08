import type { PrismaClient } from "@prisma/client";

// Backfill the assignable access level from each user's existing role, ONCE
// (only where accessLevel is still null), so nobody loses access when levels
// ship. Full admins → "admin", managers → "manager", everyone else →
// "technician" (a safe default they can be reassigned from in the org chart).
// The owner is always a full admin. Idempotent.
export async function backfillAccessLevels(prisma: PrismaClient) {
  const admin = await prisma.user.updateMany({ where: { accessLevel: null, role: "admin" }, data: { accessLevel: "admin" } });
  const manager = await prisma.user.updateMany({ where: { accessLevel: null, role: "manager" }, data: { accessLevel: "manager" } });
  const rest = await prisma.user.updateMany({ where: { accessLevel: null }, data: { accessLevel: "technician" } });
  await prisma.user.updateMany({ where: { email: "c.slade@clementspestcontrol.com" }, data: { accessLevel: "admin", role: "admin" } });
  return { admin: admin.count, manager: manager.count, rest: rest.count };
}
