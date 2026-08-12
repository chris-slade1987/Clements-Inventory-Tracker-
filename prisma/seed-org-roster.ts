import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { hashPassword, MANAGER_PASSWORD } from "./seed-core";
import { LEVEL_ROLE, type AccessLevelKey } from "../lib/access-levels";

// Seed the org roster from the CEO's Org Chart spreadsheet (prisma/data/org-roster.json):
//  1. create any missing Employee profiles (esp. corporate/admin personnel),
//  2. ensure each has a login (existing one reused/linked; new ones created with
//     a generated work email + the shared default password to reset),
//  3. set the reporting lines (org chart) and access levels.
// NON-DESTRUCTIVE: matches existing people by name, never duplicates, and only
// FILLS BLANK reportsToId / accessLevel — so later org-chart edits in the UI are
// never overwritten. Safe to run every deploy.

type Person = { name: string; title: string; department: string; branch: string | null; reportsTo: string | null; level: string };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const emailFor = (name: string) => {
  const parts = name.trim().toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "user";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return `${last ? `${first}.${last}` : first}@clementspestcontrol.com`;
};

export async function seedOrgRoster(prisma: PrismaClient) {
  const roster = JSON.parse(readFileSync(join(process.cwd(), "prisma", "data", "org-roster.json"), "utf8")) as Person[];

  const allEmployees = await prisma.employee.findMany({ select: { id: true, name: true } });
  const empByName = new Map(allEmployees.map((e) => [norm(e.name), e.id]));
  const allUsers = await prisma.user.findMany({ select: { id: true, name: true, email: true, employeeId: true } });
  const userByName = new Map(allUsers.map((u) => [norm(u.name), u]));
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));

  let created = 0, loginsCreated = 0;
  const idByName = new Map<string, string>();

  // Pass 1 — ensure Employee + login exist; set access level (fill-if-null).
  for (const p of roster) {
    let empId = empByName.get(norm(p.name));
    if (!empId) {
      const e = await prisma.employee.create({
        data: { name: p.name, role: p.title || null, division: p.department || null, branch: p.branch, title: p.title || null },
      });
      empId = e.id; created++;
      empByName.set(norm(p.name), empId);
    }
    idByName.set(norm(p.name), empId);

    const role = LEVEL_ROLE[p.level as AccessLevelKey] ?? "employee";
    // Reuse an existing login (linked → by name → by generated email), else create.
    const user = allUsers.find((u) => u.employeeId === empId) ?? userByName.get(norm(p.name)) ?? userByEmail.get(emailFor(p.name));
    if (user) {
      if (!user.employeeId) await prisma.user.update({ where: { id: user.id }, data: { employeeId: empId } });
      // Set level + role only where the level is still blank (never clobber a UI edit).
      await prisma.user.updateMany({ where: { id: user.id, accessLevel: null }, data: { accessLevel: p.level, role } });
    } else {
      const email = emailFor(p.name);
      await prisma.user.create({
        data: { name: p.name, email, passwordHash: hashPassword(MANAGER_PASSWORD), role, accessLevel: p.level, branch: p.branch, employeeId: empId },
      });
      loginsCreated++;
      allUsers.push({ id: "new", name: p.name, email, employeeId: empId });
      userByEmail.set(email.toLowerCase(), { id: "new", name: p.name, email, employeeId: empId });
    }
  }

  // Pass 2 — reporting lines (fill-if-null so UI edits stick).
  let lines = 0;
  for (const p of roster) {
    if (!p.reportsTo) continue;
    const empId = idByName.get(norm(p.name));
    const mgrId = idByName.get(norm(p.reportsTo)) ?? empByName.get(norm(p.reportsTo));
    if (!empId || !mgrId || empId === mgrId) continue;
    const res = await prisma.employee.updateMany({ where: { id: empId, reportsToId: null }, data: { reportsToId: mgrId } });
    lines += res.count;
  }

  return { people: roster.length, employeesCreated: created, loginsCreated, reportingLinesSet: lines };
}
