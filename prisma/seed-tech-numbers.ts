import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Import technician/field route numbers onto Employee records from the COO's
// phone-list photos (captured in prisma/data/tech-numbers.json).
//
// Matching is tiered and deliberately conservative so a route number can never
// land on the wrong person:
//   1) EXACT — normalized full `name` or `nickname` matches a single active
//      employee (the casual spelling the roster uses).
//   2) BRANCH + LAST NAME — if the exact tier finds nobody, match on the row's
//      BRANCH plus LAST NAME when exactly ONE active employee in that branch has
//      that surname. This catches formal-vs-casual first names (e.g. a census
//      record "Michael Mace" vs the phone-list "Mike Mace") without guessing:
//      a surname shared inside one branch (e.g. the Slades in Vero) is ambiguous
//      and left for the exact tier / manual cleanup.
//
// Idempotent: only writes when the stored routeNumber differs. NEVER creates
// employees; names that resolve to zero or multiple records are reported
// (unmatched / ambiguous). Office/leadership rows (techNumber: null) are skipped.
// ---------------------------------------------------------------------------

type Row = { name: string; techNumber: string | null; role: string; branch: string };
type Result = { total: number; updated: number; alreadySet: number; unmatched: string[]; ambiguous: string[] };
type Emp = { id: string; name: string; nickname: string | null; branch: string | null; routeNumber: string | null };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function lastName(name: string): string {
  const parts = norm(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

// Collapse any stored branch spelling ("vero", "Vero Beach", "HQ - Vero") to the
// canonical key the phone-list uses; null when it doesn't name a known branch.
function branchKey(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase();
  if (v.includes("vero")) return "vero";
  if (v.includes("stuart")) return "stuart";
  if (v.includes("orlando")) return "orlando";
  if (v.includes("naples")) return "naples";
  return null;
}

export async function importTechNumbers(prisma: PrismaClient): Promise<Result> {
  const file = path.join(process.cwd(), "prisma", "data", "tech-numbers.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { people: Row[] };
  const rows = data.people.filter((p) => p.techNumber && p.techNumber.trim());

  const employees: Emp[] = await prisma.employee.findMany({
    where: { status: "active" },
    select: { id: true, name: true, nickname: true, branch: true, routeNumber: true },
  });

  // Exact index: name/nickname -> candidate employees (deduped by id).
  const byName = new Map<string, Emp[]>();
  const pushUnique = (m: Map<string, Emp[]>, k: string, e: Emp) => {
    const arr = m.get(k) ?? [];
    if (!arr.some((x) => x.id === e.id)) arr.push(e);
    m.set(k, arr);
  };
  for (const e of employees) {
    for (const key of [e.name, e.nickname].filter(Boolean) as string[]) pushUnique(byName, norm(key), e);
  }

  // Branch + last-name index: "<branchKey>|<lastname>" -> candidate employees.
  const byBranchLast = new Map<string, Emp[]>();
  for (const e of employees) {
    const bk = branchKey(e.branch);
    if (!bk) continue;
    pushUnique(byBranchLast, `${bk}|${lastName(e.name)}`, e);
  }

  let updated = 0;
  let alreadySet = 0;
  const unmatched: string[] = [];
  const ambiguous: string[] = [];

  for (const r of rows) {
    let match: Emp | null = null;

    // Tier 1 — exact normalized name / nickname.
    const exact = byName.get(norm(r.name)) ?? [];
    if (exact.length === 1) {
      match = exact[0];
    } else if (exact.length > 1) {
      ambiguous.push(`${r.name} (#${r.techNumber})`);
      continue;
    } else {
      // Tier 2 — branch + last name, only when unique within that branch.
      const bk = branchKey(r.branch);
      const cands = bk ? byBranchLast.get(`${bk}|${lastName(r.name)}`) ?? [] : [];
      if (cands.length === 1) {
        match = cands[0];
      } else if (cands.length > 1) {
        ambiguous.push(`${r.name} (#${r.techNumber})`);
        continue;
      } else {
        unmatched.push(`${r.name} (#${r.techNumber})`);
        continue;
      }
    }

    if (match.routeNumber === r.techNumber) {
      alreadySet++;
      continue;
    }
    await prisma.employee.update({ where: { id: match.id }, data: { routeNumber: r.techNumber } });
    updated++;
  }

  return { total: rows.length, updated, alreadySet, unmatched, ambiguous };
}
