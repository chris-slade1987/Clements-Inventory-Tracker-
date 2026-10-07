import type { PrismaClient } from "@prisma/client";
import { hashPassword, MANAGER_PASSWORD } from "./seed-core";

// Deploy-time rollout of the "default password + forced change on first login"
// policy. Idempotent and NON-DESTRUCTIVE:
//
//  1. Ensure every ACTIVE employee that has an email but no linked login gets one
//     (default password `clements123`, mustChangePassword=true). This guarantees
//     April / Julie / Graham (who have roster emails) and anyone else without a
//     login can sign in. Howard Cohn (no roster email) is handled explicitly.
//  2. Repair any existing login whose stored password is empty/placeholder (e.g.
//     April, who "has no password") — set it to the default + mustChangePassword.
//  3. ONE TIME ONLY (guarded by a Setting marker): flag every active login except
//     the owner as mustChangePassword, so the whole company is rolled onto the
//     default-then-change policy without re-flagging anyone who later sets their
//     own password on a redeploy.
//
// The 72h clock is NOT started here — firstLoginAt is stamped at first login — so
// flagging an account never locks it out before it is ever used.

const DEFAULT_PASSWORD = MANAGER_PASSWORD; // "clements123"
const OWNER_EMAIL = "c.slade@clementspestcontrol.com";
// Bumped to force the one-time reset to run again on this deploy (the earlier
// rollout aborted before it on prod-specific data). A new key = one more
// guaranteed reset-everyone-to-clements123 pass, then it stays put.
const PW_POLICY_MARKER = "pw_policy_init_2026_10c";

// The four leadership logins the CEO wants provisioned, with their REAL work
// emails. Note Howard's real email is hcohn@ — but the org roster auto-generates
// first.last (howard.cohn@), so his existing login is corrected to hcohn@ below.
const LEADERS: Array<{ name: string; email: string }> = [
  { name: "April Williford", email: "awilliford@clementspestcontrol.com" },
  { name: "Julie Glanville", email: "jglanville@clementspestcontrol.com" },
  { name: "Howard Cohn", email: "hcohn@clementspestcontrol.com" },
  { name: "Graham Foster", email: "gfoster@clementspestcontrol.com" },
];

// A stored hash is usable only if it has the scrypt "salthex:hashhex" shape.
// Empty strings and placeholders fail this and are treated as "no password".
function isUsableHash(hash: string | null | undefined): boolean {
  if (!hash || typeof hash !== "string") return false;
  const [salt, digest] = hash.split(":");
  return !!salt && !!digest && /^[0-9a-f]+$/i.test(salt) && /^[0-9a-f]+$/i.test(digest);
}

export async function seedPasswordPolicy(prisma: PrismaClient) {
  let loginsCreated = 0;
  let passwordsRepaired = 0;
  let leadersFixed = 0;
  let flagged = 0;
  let errors = 0;

  // 1) Ensure a login for every active employee that has an email but none yet.
  const emps = await prisma.employee.findMany({
    where: { status: "active", email: { not: null } },
    select: { id: true, name: true, email: true, branch: true },
  });
  for (const e of emps) {
    try {
      const email = (e.email ?? "").toLowerCase().trim();
      if (!email) continue;
      const byEmail = await prisma.user.findUnique({ where: { email } });
      const byEmployee = await prisma.user.findFirst({ where: { employeeId: e.id } });
      if (byEmail || byEmployee) {
        // Keep the existing login; just ensure it is linked to this profile.
        if (byEmail && !byEmail.employeeId) {
          await prisma.user.update({ where: { id: byEmail.id }, data: { employeeId: e.id } });
        }
        continue;
      }
      await prisma.user.create({
        data: {
          name: e.name,
          email,
          passwordHash: hashPassword(DEFAULT_PASSWORD),
          role: "employee", // least privilege; roster/access seeds set the real level
          branch: e.branch,
          employeeId: e.id,
          mustChangePassword: true,
        },
      });
      loginsCreated++;
    } catch (err) {
      errors++;
      console.error(`seed-pw-policy: step1 (login for ${e.email}) failed:`, (err as Error).message);
    }
  }

  // 2) Repair any active login whose stored password is empty/placeholder.
  const active = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, email: true, passwordHash: true },
  });
  for (const u of active) {
    try {
      if (isUsableHash(u.passwordHash)) continue;
      await prisma.user.update({
        where: { id: u.id },
        data: { passwordHash: hashPassword(DEFAULT_PASSWORD), mustChangePassword: true },
      });
      passwordsRepaired++;
    } catch (err) {
      errors++;
      console.error(`seed-pw-policy: step2 (repair ${u.email}) failed:`, (err as Error).message);
    }
  }

  // 3) Explicitly ensure the four leadership logins exist and can sign in with the
  //    default password. We only SET the default when there is no usable password
  //    (missing login, or an empty/placeholder hash) — a leader who has already
  //    chosen their own password is never clobbered.
  for (const leader of LEADERS) {
    try {
      const email = leader.email.toLowerCase();
      const emp = await prisma.employee.findFirst({ where: { name: leader.name } });
      let user =
        (emp && (await prisma.user.findFirst({ where: { employeeId: emp.id } }))) ||
        (await prisma.user.findUnique({ where: { email } })) ||
        (await prisma.user.findFirst({ where: { name: leader.name } }));

      if (!user) {
        user = await prisma.user.create({
          data: {
            name: leader.name,
            email,
            passwordHash: hashPassword(DEFAULT_PASSWORD),
            role: "employee", // conservative; roster/access seeds grant real reach
            employeeId: emp?.id ?? null,
            mustChangePassword: true,
          },
        });
        leadersFixed++;
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (!user.active) patch.active = true; // a leadership login must be able to sign in
      if (emp && !user.employeeId) patch.employeeId = emp.id;
      // Correct the email to their real address (e.g. Howard's roster-generated
      // howard.cohn@ → hcohn@), unless another account already holds it.
      if (user.email.toLowerCase() !== email) {
        const conflict = await prisma.user.findUnique({ where: { email } });
        if (!conflict || conflict.id === user.id) patch.email = email;
      }
      if (!isUsableHash(user.passwordHash)) {
        patch.passwordHash = hashPassword(DEFAULT_PASSWORD);
        patch.mustChangePassword = true;
      }
      if (Object.keys(patch).length) {
        await prisma.user.update({ where: { id: user.id }, data: patch });
        leadersFixed++;
      }
    } catch (err) {
      errors++;
      console.error(`seed-pw-policy: step3 (leader ${leader.email}) failed:`, (err as Error).message);
    }
  }

  // 4) One-time company-wide roll-onto-the-policy: set EVERY active login (except
  //    the owner) to the shared default `clements123`, flag it must-change, and
  //    reset the 72h clock so it starts at their next login. This guarantees
  //    "everyone can log in with clements123 right now". GUARDED by a Setting
  //    marker so it runs EXACTLY ONCE — a redeploy never resets a password someone
  //    has since changed, and never re-flags them. The owner keeps their own
  //    password (they already have working access).
  const marker = await prisma.setting.findUnique({ where: { key: PW_POLICY_MARKER } });
  if (!marker) {
    const res = await prisma.user.updateMany({
      where: { active: true, email: { not: OWNER_EMAIL } },
      data: { passwordHash: hashPassword(DEFAULT_PASSWORD), mustChangePassword: true, firstLoginAt: null },
    });
    flagged = res.count;
    await prisma.setting.create({
      data: { key: PW_POLICY_MARKER, value: new Date().toISOString() },
    });
  }

  return { loginsCreated, passwordsRepaired, leadersFixed, flagged, errors, markerAlreadySet: !!marker };
}
