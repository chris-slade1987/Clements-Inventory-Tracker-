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
const PW_POLICY_MARKER = "pw_policy_init_2026_10d";

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
        // Keep the existing login; link it to this profile only if the profile
        // isn't already linked to another account (avoids a unique-constraint clash
        // on employee_id when duplicates exist — leaders are consolidated in step 3).
        if (byEmail && !byEmail.employeeId && !byEmployee) {
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

  // 3) BULLETPROOF leadership logins. For each leader we consolidate to exactly
  //    ONE canonical, active account at their real email with the default password,
  //    no matter how messy prod got (wrong email like the roster-generated
  //    first.last@, inactive account, OR duplicate accounts). This is the only way
  //    to guarantee they can sign in without being able to read prod directly.
  //    (Temporary launch behavior: it force-sets the default on the leaders every
  //    deploy; remove once we move to per-person passwords with email.)
  const emailFor = (name: string) => {
    const parts = name.trim().toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    return `${last ? `${first}.${last}` : first}@clementspestcontrol.com`;
  };
  for (const leader of LEADERS) {
    try {
      const canonical = leader.email.toLowerCase();
      const rosterGen = emailFor(leader.name).toLowerCase();
      const emp = await prisma.employee.findFirst({ where: { name: leader.name } });

      // Every account that could be this person.
      const candidates = await prisma.user.findMany({
        where: {
          OR: [
            { name: leader.name },
            { email: canonical },
            { email: rosterGen },
            ...(emp ? [{ employeeId: emp.id }] : []),
          ],
        },
      });

      if (candidates.length === 0) {
        await prisma.user.create({
          data: {
            name: leader.name,
            email: canonical,
            passwordHash: hashPassword(DEFAULT_PASSWORD),
            role: "employee",
            employeeId: emp?.id ?? null,
            mustChangePassword: true,
          },
        });
        leadersFixed++;
        continue;
      }

      // Choose the primary: employee-linked first, else the canonical-email one, else first.
      const primary =
        (emp && candidates.find((c) => c.employeeId === emp.id)) ||
        candidates.find((c) => c.email.toLowerCase() === canonical) ||
        candidates[0];

      // Park + deactivate every OTHER candidate so the canonical email is free and
      // there is only one login this person can use.
      for (const c of candidates) {
        if (c.id === primary.id) continue;
        await prisma.user.update({
          where: { id: c.id },
          data: { active: false, email: `disabled+${c.id}@clementspestcontrol.invalid` },
        });
      }

      // Force the primary to canonical email + active + the shared default password.
      await prisma.user.update({
        where: { id: primary.id },
        data: {
          email: canonical,
          active: true,
          passwordHash: hashPassword(DEFAULT_PASSWORD),
          mustChangePassword: true,
          ...(emp && !primary.employeeId ? { employeeId: emp.id } : {}),
        },
      });
      leadersFixed++;
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
