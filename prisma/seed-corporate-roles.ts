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
    prisma.employee.findMany({ select: { id: true, name: true, email: true } }),
    prisma.user.findMany({ select: { employeeId: true, email: true } }),
  ]);
  const byEmpEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const e of employees) {
    if (e.email) byEmpEmail.set(e.email.trim().toLowerCase(), e.id);
    byName.set(e.name.trim().toLowerCase(), e.id);
  }
  const byUserEmail = new Map<string, string>();
  for (const u of users) if (u.email && u.employeeId) byUserEmail.set(u.email.trim().toLowerCase(), u.employeeId);

  let matched = 0;
  const unmatched: string[] = [];
  for (const r of file.roles) {
    const emailKey = r.email.trim().toLowerCase();
    const id = byEmpEmail.get(emailKey) ?? byUserEmail.get(emailKey) ?? byName.get(r.name.trim().toLowerCase());
    if (!id) {
      unmatched.push(`${r.name} <${r.email}>`);
      continue;
    }
    await prisma.employee.update({
      where: { id },
      data: {
        roleResponsibilities: r.roleResponsibilities,
        contactReasons: r.contactReasons,
        contactGuidance: r.contactGuidance,
      },
    });
    matched++;
  }

  await prisma.setting.upsert({
    where: { key: VERSION_KEY },
    create: { key: VERSION_KEY, value: version },
    update: { value: version },
  });

  return { skipped: false, version, total: file.roles.length, matched, unmatched };
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
