import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Seed the corporate ROLE REFERENCE (from the Corporate Contact & Reference Sheet)
// onto the matching employees' org-chart cards: what they do, when to go to them,
// and how to reach them.
//
// VERSION-GATED one-time backfill (NOT a clobber-on-every-deploy seed): once the
// stored `corporate-roles.version` matches the file's version, this does nothing,
// so edits a manager later makes on a card are preserved. Bump the file's
// `version` to re-apply an updated sheet (that WILL overwrite the matched people's
// three role fields). Matches employees by email (employee email, then login
// email), then by exact name as a fallback.

type RoleEntry = {
  email: string;
  name: string;
  aliases?: string[]; // other names the same person appears under (duplicate records)
  title?: string;
  roleResponsibilities: string;
  contactReasons: string;
  contactGuidance: string;
};
type RoleFile = { version: string; roles: RoleEntry[] };

const VERSION_KEY = "corporate-roles.version";

async function loadRoleFile(): Promise<RoleFile> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "prisma", "data", "corporate-roles.json"), "utf8")) as RoleFile;
  } catch {
    return (await import("./data/corporate-roles.json")).default as unknown as RoleFile;
  }
}

export async function seedCorporateRoles(prisma: PrismaClient) {
  const file = await loadRoleFile();
  const version = file.version || "0";

  const existing = await prisma.setting.findUnique({ where: { key: VERSION_KEY } }).catch(() => null);
  if (existing?.value === version) {
    return { skipped: true, version, total: file.roles.length, matched: 0, unmatched: [] as string[] };
  }

  const [employees, users] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, name: true, email: true, status: true } }),
    prisma.user.findMany({ select: { employeeId: true, email: true } }),
  ]);

  // Resolve ALL of a person's employee records, because the same person can have
  // more than one (e.g. Chris exists as both "Christopher Slade" — his login — and
  // a roster-created "Chris Slade"). We match by: the record their LOGIN points at
  // (User.email == sheet email), any record whose work email matches, and any
  // record whose name matches the sheet name OR a listed alias. Whichever record
  // the chart shows, it gets the role data. Prefer active records; if a person has
  // only inactive records we still fill them.
  const loginByEmail = new Map<string, string>();
  for (const u of users) if (u.email && u.employeeId) loginByEmail.set(u.email.trim().toLowerCase(), u.employeeId);

  const idsByEmail = new Map<string, string[]>();
  const idsByName = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const a = map.get(key) ?? [];
    a.push(id);
    map.set(key, a);
  };
  for (const e of employees) {
    if (e.email) push(idsByEmail, e.email.trim().toLowerCase(), e.id);
    push(idsByName, e.name.trim().toLowerCase(), e.id);
  }
  const isActive = new Map(employees.map((e) => [e.id, e.status === "active"]));

  let matched = 0;
  let failed = 0;
  const unmatched: string[] = [];
  for (const r of file.roles) {
    const emailKey = r.email.trim().toLowerCase();
    const names = [r.name, ...(r.aliases ?? [])].map((n) => n.trim().toLowerCase());
    const targets = new Set<string>();
    const loginId = loginByEmail.get(emailKey);
    if (loginId) targets.add(loginId);
    for (const id of idsByEmail.get(emailKey) ?? []) targets.add(id);
    for (const n of names) for (const id of idsByName.get(n) ?? []) targets.add(id);
    // If there's at least one active record, only fill the active ones.
    const all = [...targets];
    const active = all.filter((id) => isActive.get(id));
    const toFill = active.length ? active : all;
    if (toFill.length === 0) {
      unmatched.push(`${r.name} <${r.email}>`);
      continue;
    }
    try {
      await prisma.employee.updateMany({
        where: { id: { in: toFill } },
        data: {
          roleResponsibilities: r.roleResponsibilities,
          contactReasons: r.contactReasons,
          contactGuidance: r.contactGuidance,
        },
      });
      matched++;
    } catch (e) {
      failed++;
      unmatched.push(`${r.name} (update failed: ${(e as Error).message})`);
    }
  }

  // Record the version once every matched row applied cleanly (a sheet person who
  // simply isn't in the system yet doesn't block it). A real update failure leaves
  // the version unset so the next deploy retries instead of locking out.
  if (failed === 0) {
    await prisma.setting.upsert({
      where: { key: VERSION_KEY },
      create: { key: VERSION_KEY, value: version },
      update: { value: version },
    });
  }

  return { skipped: false, version, total: file.roles.length, matched, failed, unmatched };
}

// Allow running standalone: `tsx prisma/seed-corporate-roles.ts`
if (process.argv[1] && process.argv[1].includes("seed-corporate-roles")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedCorporateRoles(prisma);
      console.log("Corporate roles seeded:", r);
    } finally {
      await prisma.$disconnect();
    }
  })();
}
