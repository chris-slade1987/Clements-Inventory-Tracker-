import { prisma } from "@/lib/prisma";

// Monthly vehicle inspection — a digital version of the paper form. Section A
// is a 1-3 condition rating (max 12), Section C is 8 pass/fail compliance
// checks (max 8), for a 20-point total that grades the assigned technician.

export const CONDITION_ITEMS = [
  { key: "outside", label: "Outside appearance" },
  { key: "inside", label: "Inside appearance" },
  { key: "toolbox", label: "Toolbox — organized / clean / locked" },
  { key: "truckbed", label: "Truck bed — organized / clean" },
] as const;

export const RATING_SCALE = [
  { value: 3, label: "Meets / exceeds", short: "Exceeds" },
  { value: 2, label: "Meets minimum", short: "Meets" },
  { value: 1, label: "Below standards", short: "Below" },
] as const;

// Section C — pass/fail. `critical` items raise a safety alert when failed,
// regardless of the overall score.
export const CHECK_ITEMS = [
  { key: "id_card", label: "ID card valid with photo and signature", critical: true },
  { key: "pesticides_locked", label: "Pesticide concentrates secured / locked in boxes", critical: true },
  { key: "containers_labeled", label: "Pesticide containers properly identified with label", critical: true },
  { key: "ppe", label: "PPE (respirator, gloves, glasses), spill kit, first-aid kit", critical: true },
  { key: "signage", label: "Lawn signage available for exterior foliage applications", critical: false },
  { key: "equipment_working", label: "B&G, backpack sprayers, spreaders clean & working", critical: false },
  { key: "insurance_reg", label: "Insurance card, registration, incident packet present", critical: true },
  { key: "oil_current", label: "Oil changes current or scheduled within 500 mi of due", critical: false },
] as const;

export const CONDITION_MAX = CONDITION_ITEMS.length * 3; // 12
export const CHECK_MAX = CHECK_ITEMS.length; // 8
export const MAX_SCORE = CONDITION_MAX + CHECK_MAX; // 20

export type Ratings = Record<string, number>; // item key -> 1..3
export type Checks = Record<string, boolean>; // item key -> pass

export function scoreInspection(ratings: Ratings, checks: Checks) {
  let score = 0;
  for (const it of CONDITION_ITEMS) {
    const r = Number(ratings[it.key]);
    if (r >= 1 && r <= 3) score += r;
  }
  for (const it of CHECK_ITEMS) if (checks[it.key]) score += 1;
  const scorePct = Math.round((score / MAX_SCORE) * 1000) / 10;
  return { score, maxScore: MAX_SCORE, scorePct, grade: gradeLetter(scorePct) };
}

export function gradeLetter(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  return "F";
}

/** Critical compliance items that were explicitly failed (present and false). */
export function criticalFailures(checks: Checks): { key: string; label: string }[] {
  return CHECK_ITEMS.filter((it) => it.critical && checks[it.key] === false).map((it) => ({ key: it.key, label: it.label }));
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** All inspections for a vehicle, newest first. */
export async function vehicleInspections(vehicleId: string) {
  return prisma.vehicleInspection.findMany({ where: { vehicleId }, orderBy: [{ year: "desc" }, { month: "desc" }] });
}

/** Per-technician rolling grade — average score across their inspections. */
export async function technicianGrades(): Promise<
  { technicianName: string; count: number; avgPct: number; grade: string; lastDate: Date }[]
> {
  const rows = await prisma.vehicleInspection.findMany({
    where: { technicianName: { not: null } },
    select: { technicianName: true, scorePct: true, date: true },
  });
  const by = new Map<string, { sum: number; count: number; last: Date }>();
  for (const r of rows) {
    const name = r.technicianName!;
    const cur = by.get(name) ?? { sum: 0, count: 0, last: r.date };
    cur.sum += r.scorePct;
    cur.count += 1;
    if (r.date > cur.last) cur.last = r.date;
    by.set(name, cur);
  }
  return [...by.entries()]
    .map(([technicianName, v]) => {
      const avgPct = Math.round((v.sum / v.count) * 10) / 10;
      return { technicianName, count: v.count, avgPct, grade: gradeLetter(avgPct), lastDate: v.last };
    })
    .sort((a, b) => b.avgPct - a.avgPct);
}

/**
 * Which active vehicles in a branch (or all) have / don't have an inspection
 * for the given month — powers the "inspection due" reminders and the
 * scorecard compliance metric.
 */
export async function inspectionStatus(year: number, month: number, branch?: string) {
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active", ...(branch ? { branch } : {}) },
    select: { id: true, unitNumber: true, name: true, branch: true, assignedTo: true },
    orderBy: [{ branch: "asc" }, { unitNumber: "asc" }],
  });
  const done = await prisma.vehicleInspection.findMany({
    where: { year, month, ...(branch ? { branch } : {}) },
    select: { vehicleId: true, scorePct: true, grade: true },
  });
  const doneMap = new Map(done.map((d) => [d.vehicleId, d]));
  const rows = vehicles.map((v) => ({ ...v, inspection: doneMap.get(v.id) ?? null }));
  const completed = rows.filter((r) => r.inspection).length;
  return { rows, total: vehicles.length, completed, pending: vehicles.length - completed };
}
