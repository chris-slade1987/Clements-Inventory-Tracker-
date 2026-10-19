import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Import technician/field route numbers onto Employee records from the COO's
// phone-list photos (captured in prisma/data/tech-numbers.json).
//
// Matches by NAME (case-insensitive, whitespace-collapsed) against each active
// Employee's `name` or `nickname` — the same name-matching discipline the
// technician/vehicle roster uses. Idempotent: only writes when the stored
// routeNumber differs. NEVER creates employees; names that match zero or
// multiple records are reported (unmatched / ambiguous) for manual cleanup
// rather than guessed. Office/leadership rows (techNumber: null) are skipped.
// ---------------------------------------------------------------------------

type Row = { name: string; techNumber: string | null; role: string; branch: string };
type Result = { total: number; updated: number; alreadySet: number; unmatched: string[]; ambiguous: string[] };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function importTechNumbers(prisma: PrismaClient): Promise<Result> {
  const file = path.join(process.cwd(), "prisma", "data", "tech-numbers.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { people: Row[] };
  const rows = data.people.filter((p) => p.techNumber && p.techNumber.trim());

  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    select: { id: true, name: true, nickname: true, routeNumber: true },
  });

  // name/nickname -> candidate employees
  const byName = new Map<string, { id: string; routeNumber: string | null }[]>();
  for (const e of employees) {
    for (const key of [e.name, e.nickname].filter(Boolean) as string[]) {
      const k = norm(key);
      const arr = byName.get(k) ?? [];
      arr.push({ id: e.id, routeNumber: e.routeNumber ?? null });
      byName.set(k, arr);
    }
  }

  let updated = 0;
  let alreadySet = 0;
  const unmatched: string[] = [];
  const ambiguous: string[] = [];

  for (const r of rows) {
    const matches = byName.get(norm(r.name));
    if (!matches || matches.length === 0) {
      unmatched.push(`${r.name} (#${r.techNumber})`);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push(`${r.name} (#${r.techNumber})`);
      continue;
    }
    const emp = matches[0];
    if (emp.routeNumber === r.techNumber) {
      alreadySet++;
      continue;
    }
    await prisma.employee.update({ where: { id: emp.id }, data: { routeNumber: r.techNumber } });
    updated++;
  }

  return { total: rows.length, updated, alreadySet, unmatched, ambiguous };
}
