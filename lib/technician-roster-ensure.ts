import "server-only";
import { prisma } from "@/lib/prisma";
import techData from "@/prisma/data/tech-numbers.json";

// ---------------------------------------------------------------------------
// Check-Out technician roster healer (runtime).
//
// Inventory → Check-Out lists every ACTIVE `Technician` row (app/(app)/check-out/
// page.tsx). That pick-list is its own table, linked to people only by name, and
// until now nothing kept it in step with the COO's phone list: rows came from the
// demo seed, the manual Manage → Technicians screen / CSV import, the one-time
// PestPac dispersal load, or a pre-hire conversion. Anyone who never went through
// one of those (e.g. Brian Lasneski, PestPac tech #28 "28 BRIAN L", Vero Beach —
// COO 2026-11-13) simply never appeared, so their branch manager couldn't issue
// product to them.
//
// General rule applied here: every person who holds a PestPac technician/route
// number — on the phone list (prisma/data/tech-numbers.json) or on an active
// Employee profile (routeNumber + branch) — has an ACTIVE check-out roster row at
// their branch's warehouse, unless they're a terminated employee.
//
// Matching is conservative so it never duplicates a person already on the roster
// under another spelling (tiers, in order; a roster row is claimed at most once):
//   1) EXACT normalized name / profile name / nickname (any warehouse);
//   2) PestPac card # (employeeIdCard) == route number at the branch warehouse
//      (rows the dispersal loader created as e.g. "BRIAN L" / card "28");
//   3) at the branch warehouse, same LAST name (or a single-letter last initial,
//      PestPac style "BRIAN L") with a compatible first name ("Gus"/"Augustus",
//      "Mike"/"Michael"), and only when exactly one roster row fits.
// A match that's inactive is reactivated; no match → a row is created. Never
// deletes, never renames, never moves a row's warehouse, never touches movements.
// Once (Setting marker), self-retries until warehouses exist, non-fatal.
// ---------------------------------------------------------------------------

const MARKER = "technician_roster_ensure_v1";

// Explicit COO directives: people who must be on the roster even if an inactive
// employee profile shares their name. Applied only when BOTH the name and the
// tech number match a phone-list row, so it can never land on the wrong person.
const DIRECTIVES: Array<{ name: string; techNumber: string; branch: string; note: string }> = [
  { name: "Brian Lasneski", techNumber: "28", branch: "vero", note: "COO 2026-11-13: Jason (Vero) must be able to check product out to 28 BRIAN L" },
];

type PhoneRow = { name: string; techNumber: string | null; role: string; branch: string };

type Person = {
  name: string; // name to create the roster row under (profile name when known)
  aliases: Set<string>; // normalized names / nicknames that identify them
  routeNumber: string;
  branch: string; // canonical branch key
  role: string; // phone-list / profile role text
  forced: boolean; // explicit directive — bypasses the terminated-employee skip
};

type Tech = { id: string; name: string; homeWarehouseId: string; employeeIdCard: string | null; active: boolean };

export type RosterReport = {
  people: number;
  alreadyActive: string[];
  reactivated: string[];
  created: string[];
  skippedTerminated: string[];
  noWarehouse: string[];
  ready: boolean;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}
function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}
function routeKey(n: string | null | undefined): string {
  const v = (n ?? "").trim();
  return /^\d+$/.test(v) ? String(Number(v)) : v.toLowerCase();
}
export function branchKey(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase();
  if (v.includes("vero")) return "vero";
  if (v.includes("stuart")) return "stuart";
  if (v.includes("orlando")) return "orlando";
  if (v.includes("naples")) return "naples";
  return null;
}
function firstNamesCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a[0] === b[0]) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 3 && l.includes(s); // Gus / Augustus
}
function roleFor(text: string): string {
  if (/advisor|sales/i.test(text)) return "Sales Advisor";
  if (/manager|director|dir\.|president|officer/i.test(text)) return "Manager";
  return "Technician";
}

/** Tier-3 fuzzy match: same surname (or PestPac last initial) + compatible first name. */
function looseNameMatch(person: Person, techName: string): boolean {
  const t = tokens(techName);
  if (t.length < 2) return false; // a bare first name ("BRIAN") is too ambiguous
  const tFirst = t[0];
  const tLast = t[t.length - 1];
  for (const alias of person.aliases) {
    const p = alias.split(" ").filter(Boolean);
    if (p.length < 2) continue;
    const pFirst = p[0];
    const pLast = p[p.length - 1];
    const lastOk = tLast === pLast || (tLast.length === 1 && tLast === pLast[0]);
    if (lastOk && firstNamesCompatible(tFirst, pFirst)) return true;
  }
  return false;
}

/** Everyone who holds a route number: phone list ∪ active employee profiles. */
async function loadPeople(): Promise<{ people: Person[]; terminated: Set<string> }> {
  const phone = (techData as { people: PhoneRow[] }).people.filter((p) => p.techNumber && p.techNumber.trim());
  const employees = await prisma.employee.findMany({
    select: { name: true, nickname: true, branch: true, routeNumber: true, status: true, role: true, title: true },
  });
  const active = employees.filter((e) => e.status === "active");

  // Names (and nicknames) of terminated people with no active profile of the same name.
  const activeNames = new Set<string>();
  for (const e of active) {
    activeNames.add(norm(e.name));
    if (e.nickname) activeNames.add(norm(e.nickname));
  }
  const terminated = new Set<string>();
  for (const e of employees) {
    if (e.status === "active") continue;
    for (const n of [e.name, e.nickname]) if (n && !activeNames.has(norm(n))) terminated.add(norm(n));
  }

  // One Person per human: a phone-list row and its employee profile merge when
  // they share branch + route number OR a name/nickname (a profile wins on name
  // and branch, since HR keeps it current).
  const byKey = new Map<string, Person>();
  const list: Person[] = [];
  const add = (name: string, nickname: string | null, routeNumber: string, branch: string, role: string, fromProfile: boolean) => {
    const names = [norm(name), ...(nickname ? [norm(nickname)] : [])];
    const existing =
      byKey.get(`${branch}|${routeKey(routeNumber)}`) ?? list.find((p) => names.some((n) => p.aliases.has(n)));
    if (existing) {
      for (const n of names) existing.aliases.add(n);
      if (fromProfile) {
        existing.name = name;
        existing.branch = branch;
        existing.routeNumber = routeNumber.trim();
      }
      byKey.set(`${existing.branch}|${routeKey(existing.routeNumber)}`, existing);
      return;
    }
    const person: Person = { name, aliases: new Set(names), routeNumber: routeNumber.trim(), branch, role, forced: false };
    list.push(person);
    byKey.set(`${branch}|${routeKey(routeNumber)}`, person);
  };
  for (const p of phone) {
    const bk = branchKey(p.branch);
    if (bk) add(p.name, null, p.techNumber!, bk, p.role, false);
  }
  for (const e of active) {
    const bk = branchKey(e.branch);
    if (bk && e.routeNumber && e.routeNumber.trim()) add(e.name, e.nickname, e.routeNumber, bk, e.title || e.role || "", true);
  }

  // Directives: honored only when name AND number agree with a phone-list row.
  for (const d of DIRECTIVES) {
    const onList = phone.some(
      (p) => norm(p.name) === norm(d.name) && routeKey(p.techNumber) === routeKey(d.techNumber) && branchKey(p.branch) === d.branch,
    );
    const person = list.find((p) => p.aliases.has(norm(d.name)) && routeKey(p.routeNumber) === routeKey(d.techNumber));
    if (onList && person) person.forced = true;
  }
  return { people: list, terminated };
}

/**
 * Reconcile the check-out roster against everyone who holds a route number.
 * `apply: false` reports what would change without writing.
 */
export async function reconcileTechnicianRoster(opts: { apply: boolean }): Promise<RosterReport> {
  const report: RosterReport = { people: 0, alreadyActive: [], reactivated: [], created: [], skippedTerminated: [], noWarehouse: [], ready: true };
  const warehouses = await prisma.warehouse.findMany({ where: { active: true }, select: { id: true, name: true } });
  const whByBranch = new Map<string, string>();
  for (const w of warehouses) {
    const bk = branchKey(w.name);
    if (bk && !whByBranch.has(bk)) whByBranch.set(bk, w.id);
  }
  if (whByBranch.size === 0) return { ...report, ready: false };

  const { people, terminated } = await loadPeople();
  report.people = people.length;
  const techs: Tech[] = await prisma.technician.findMany({
    select: { id: true, name: true, homeWarehouseId: true, employeeIdCard: true, active: true },
  });

  const claimed = new Set<string>();
  const match = new Map<Person, Tech>();
  const pick = (cands: Tech[], whId: string | undefined): Tech | undefined =>
    [...cands].sort(
      (a, b) => Number(b.active) - Number(a.active) || Number(b.homeWarehouseId === whId) - Number(a.homeWarehouseId === whId),
    )[0];

  // Tier 1 — exact name / nickname, any warehouse.
  for (const p of people) {
    const cands = techs.filter((t) => !claimed.has(t.id) && p.aliases.has(norm(t.name)));
    const t = pick(cands, whByBranch.get(p.branch));
    if (t) { match.set(p, t); claimed.add(t.id); }
  }
  // Tier 2 — PestPac card # at the branch warehouse.
  for (const p of people) {
    if (match.has(p)) continue;
    const whId = whByBranch.get(p.branch);
    const cands = techs.filter(
      (t) => !claimed.has(t.id) && t.homeWarehouseId === whId && t.employeeIdCard && routeKey(t.employeeIdCard) === routeKey(p.routeNumber),
    );
    if (cands.length === 1) { match.set(p, cands[0]); claimed.add(cands[0].id); }
  }
  // Tier 3 — surname / last initial + compatible first name, unique at the branch warehouse.
  for (const p of people) {
    if (match.has(p)) continue;
    const whId = whByBranch.get(p.branch);
    const cands = techs.filter((t) => !claimed.has(t.id) && t.homeWarehouseId === whId && looseNameMatch(p, t.name));
    if (cands.length === 1) { match.set(p, cands[0]); claimed.add(cands[0].id); }
  }

  for (const p of people) {
    const label = `${p.routeNumber} ${p.name} (${p.branch})`;
    const isTerminated = [...p.aliases].some((a) => terminated.has(a));
    if (isTerminated && !p.forced) {
      report.skippedTerminated.push(label);
      continue;
    }
    const t = match.get(p);
    if (t) {
      if (t.active) { report.alreadyActive.push(`${label} = "${t.name}"`); continue; }
      if (opts.apply) await prisma.technician.update({ where: { id: t.id }, data: { active: true } });
      report.reactivated.push(`${label} = "${t.name}"`);
      continue;
    }
    const whId = whByBranch.get(p.branch);
    if (!whId) { report.noWarehouse.push(label); continue; }
    if (opts.apply) {
      await prisma.technician.create({ data: { name: p.name, homeWarehouseId: whId, role: roleFor(p.role), active: true } });
    }
    report.created.push(label);
  }
  return report;
}

let _run: Promise<void> | null = null;

/** Runtime entry point (app layout + Check-Out page). Once per DB; non-fatal. */
export function ensureTechnicianRoster(): Promise<void> {
  if (!_run) _run = run().catch((e) => { console.error("ensureTechnicianRoster failed (non-fatal, will retry):", e); _run = null; });
  return _run;
}

async function run(): Promise<void> {
  if (await prisma.setting.findUnique({ where: { key: MARKER } })) return;
  // Claim the marker first so concurrent cold starts don't both create rows.
  try {
    await prisma.setting.create({ data: { key: MARKER, value: JSON.stringify({ status: "running", at: new Date().toISOString() }) } });
  } catch {
    return; // another instance holds (or finished) it
  }
  let r: RosterReport;
  try {
    r = await reconcileTechnicianRoster({ apply: true });
  } catch (e) {
    await prisma.setting.delete({ where: { key: MARKER } }).catch(() => {});
    throw e;
  }
  if (!r.ready) {
    await prisma.setting.delete({ where: { key: MARKER } }).catch(() => {});
    _run = null; // warehouses not there yet — retry on a later request
    return;
  }
  const value = JSON.stringify({ at: new Date().toISOString(), created: r.created, reactivated: r.reactivated, skippedTerminated: r.skippedTerminated, noWarehouse: r.noWarehouse });
  await prisma.setting.update({ where: { key: MARKER }, data: { value } });
  if (r.created.length || r.reactivated.length) {
    console.log(
      `ensureTechnicianRoster: ${r.created.length} created [${r.created.join("; ")}], ` +
        `${r.reactivated.length} reactivated [${r.reactivated.join("; ")}]` +
        (r.skippedTerminated.length ? `; skipped terminated: ${r.skippedTerminated.join("; ")}` : "") + ".",
    );
  }
}
