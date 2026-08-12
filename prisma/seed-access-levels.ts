import type { PrismaClient } from "@prisma/client";

// Backfill the assignable access level from each user's existing role, ONCE
// (only where accessLevel is still null), so nobody loses access when levels
// ship. Role admins → "super_admin", managers → "manager", everyone else →
// "technician" (a safe default they can be reassigned from in the org chart).
// The owner is always a super admin. Idempotent.
export async function backfillAccessLevels(prisma: PrismaClient) {
  // One-time rename: the level formerly called "admin" (full admin) is now
  // "super_admin"; the NEW "admin" is the team-scoped level. Promote existing
  // "admin" holders once so the rename doesn't demote them. Guarded by a Setting
  // (runs before the roster seed, which then sets authoritative per-person levels).
  const migKey = "access_level_admin_rename_v2";
  const done = await prisma.setting.findUnique({ where: { key: migKey } }).catch(() => null);
  if (!done) {
    const promoted = await prisma.user.updateMany({ where: { accessLevel: "admin" }, data: { accessLevel: "super_admin" } });
    await prisma.setting.upsert({ where: { key: migKey }, create: { key: migKey, value: `promoted ${promoted.count}` }, update: {} }).catch(() => null);
  }

  const admin = await prisma.user.updateMany({ where: { accessLevel: null, role: "admin" }, data: { accessLevel: "super_admin" } });
  const manager = await prisma.user.updateMany({ where: { accessLevel: null, role: "manager" }, data: { accessLevel: "manager" } });
  const rest = await prisma.user.updateMany({ where: { accessLevel: null }, data: { accessLevel: "technician" } });
  await prisma.user.updateMany({ where: { email: "c.slade@clementspestcontrol.com" }, data: { accessLevel: "super_admin", role: "admin" } });
  return { admin: admin.count, manager: manager.count, rest: rest.count };
}
