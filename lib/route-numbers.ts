import "server-only";
import techData from "@/prisma/data/tech-numbers.json";

// Resolve a technician/field ROUTE NUMBER for an employee straight from the COO's
// phone-list (prisma/data/tech-numbers.json) — the authoritative source.
//
// This is the DISPLAY-side counterpart to prisma/seed-tech-numbers.ts. The tile /
// profile / search prefer a route number stored on the Employee row (so a manual
// edit always wins), but fall back to this resolver when the stored value is
// blank — so route numbers appear and are searchable even if the deploy-time
// name match hasn't landed them in the database yet. Statically importing the
// JSON means it's bundled into the serverless function (no runtime fs path to go
// wrong on Vercel).
//
// Matching mirrors the importer and is just as conservative:
//   1) EXACT normalized full name or nickname, then
//   2) BRANCH + LAST NAME when exactly one phone-list person in that branch has
//      that surname (so a shared surname inside a branch is never guessed).

type Row = { name: string; techNumber: string | null; role: string; branch: string };

const people = (techData as { people: Row[] }).people.filter((p) => p.techNumber && p.techNumber.trim());

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function lastName(name: string): string {
  const parts = norm(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
function branchKey(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase();
  if (v.includes("vero")) return "vero";
  if (v.includes("stuart")) return "stuart";
  if (v.includes("orlando")) return "orlando";
  if (v.includes("naples")) return "naples";
  return null;
}

// Exact index: normalized phone-list name -> route number.
const byName = new Map<string, string>();
for (const p of people) byName.set(norm(p.name), p.techNumber!.trim());

// Branch + last-name index: "<branchKey>|<lastname>" -> route numbers (deduped).
const byBranchLast = new Map<string, Set<string>>();
for (const p of people) {
  const bk = branchKey(p.branch);
  if (!bk) continue;
  const k = `${bk}|${lastName(p.name)}`;
  const set = byBranchLast.get(k) ?? new Set<string>();
  set.add(p.techNumber!.trim());
  byBranchLast.set(k, set);
}

/** Resolve a route number from the phone-list for one employee, or null. */
export function routeNumberFor(emp: { name: string; nickname?: string | null; branch?: string | null }): string | null {
  // Tier 1 — exact name / nickname.
  const exact = byName.get(norm(emp.name)) ?? (emp.nickname ? byName.get(norm(emp.nickname)) : undefined);
  if (exact) return exact;

  // Tier 2 — branch + last name, only when unique within that branch.
  const bk = branchKey(emp.branch);
  if (bk) {
    const set = byBranchLast.get(`${bk}|${lastName(emp.name)}`);
    if (set && set.size === 1) return [...set][0];
  }
  return null;
}
