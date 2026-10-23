import { prisma } from "@/lib/prisma";
import { matchEmployeeByName, type EmployeeLite } from "@/lib/people";

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

// Required inspection photos — four fixed vantage points the inspector must
// capture (camera) or upload. Order drives the form and the report/email.
export const INSPECTION_PHOTO_KINDS = [
  { key: "exterior_front", label: "Exterior — front" },
  { key: "truck_bed", label: "Exterior — inside the truck bed" },
  { key: "interior_front", label: "Interior — front seat area" },
  { key: "interior_back", label: "Interior — behind the seats / back seat" },
] as const;

export type InspectionPhotoKind = (typeof INSPECTION_PHOTO_KINDS)[number]["key"];

export function inspectionPhotoLabel(kind: string): string {
  return INSPECTION_PHOTO_KINDS.find((p) => p.key === kind)?.label ?? kind;
}

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

/** All inspections for a vehicle, newest first (with their filed photos). */
export async function vehicleInspections(vehicleId: string) {
  return prisma.vehicleInspection.findMany({
    where: { vehicleId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { photos: { orderBy: { createdAt: "asc" } } },
  });
}

/** Per-technician rolling grade — average score across their inspections. */
export async function technicianGrades(branch?: string): Promise<
  { technicianName: string; count: number; avgPct: number; grade: string; lastDate: Date }[]
> {
  const rows = await prisma.vehicleInspection.findMany({
    where: { technicianName: { not: null }, ...(branch ? { branch } : {}) },
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

// ───────────────────────────────────────────────────────────────────────────
// Inspectable-vehicle rule.
//
// Only vehicles DRIVEN by a technician or service advisor get a monthly
// inspection. This is a QUERY-TIME rule (no data purge needed on prod): a
// vehicle is inspectable iff it is active, not force-exempted, not a trailer,
// and its assigned driver resolves to a technician / service-advisor.
//
// The driver's "access level" is the assignable level from lib/access-levels.ts
// (User.accessLevel) — the keys are "technician" and "sales" (Service Advisor).
// NOTE: we deliberately read User.accessLevel rather than lib/access.ts
// `deriveLevelKey`, because deriveLevelKey collapses technician AND csr to the
// single "employee" key and so can't tell a technician from a CSR. Prod data has
// the login/level filled inconsistently, so we ALSO accept the Employee.role
// string ("Technician", "Sales Advisor", …) as a fallback signal, and hard-exclude
// anyone whose level/role reads as leadership (manager/director/officer/…).
// ───────────────────────────────────────────────────────────────────────────

const LEADERSHIP_ROLE_RE = /manager|director|dir\.|officer|chief|\bcoo\b|\bceo\b|\bcfo\b|president|owner|supervisor/i;

/** Obvious trailers / non-vehicle equipment — never inspected. */
export function isTrailerLike(v: { name?: string | null; make?: string | null; model?: string | null; assignedTo?: string | null }): boolean {
  const hay = [v.name, v.make, v.model, v.assignedTo].map((s) => (s ?? "").toLowerCase()).join(" ");
  return /trailer/.test(hay);
}

/** True only when the driver clearly resolves to leadership (exec / manager /
 *  director) — they maintain their own vehicles and are never inspected. */
export function driverIsLeadership(emp: { role?: string | null; accessLevel?: string | null } | null | undefined): boolean {
  if (!emp) return false;
  const level = emp.accessLevel ?? null;
  const role = emp.role ?? "";
  if (level === "manager" || level === "admin" || level === "super_admin" || level === "sales_director") return true;
  if (LEADERSHIP_ROLE_RE.test(role)) return true;
  return false;
}

/**
 * FAIL-OPEN: a resolved driver is inspectable UNLESS they are clearly leadership.
 * We deliberately do NOT require a positive "technician/advisor" signal, because
 * prod access-level/role data is inconsistent and a strict include-only rule
 * silently dropped real technicians (e.g. a tech with a blank role or a login
 * level that wasn't filled). Only executives/managers/directors are excluded;
 * everyone else who drives a company vehicle is inspected. Trailers, unassigned
 * spares, and force-exempt vehicles are filtered separately in
 * listInspectableVehicles.
 */
export function employeeIsInspectable(emp: { role?: string | null; accessLevel?: string | null } | null | undefined): boolean {
  if (!emp) return false;
  return !driverIsLeadership(emp);
}

type InspectableVehicle = {
  id: string;
  unitNumber: string | null;
  name: string;
  branch: string | null;
  assignedTo: string | null;
  currentMileage: number | null;
};

/**
 * Active, non-exempt, non-trailer vehicles whose assigned driver is a technician
 * or service advisor. Resolves the driver via the structured employee link first,
 * then falls back to name-matching the roster (so it works before the FK backfill
 * has reached every row on prod).
 */
export async function listInspectableVehicles(branch?: string): Promise<InspectableVehicle[]> {
  const [vehicles, employees] = await Promise.all([
    prisma.vehicle.findMany({
      where: { status: "active", ...(branch ? { branch } : {}) },
      include: { assignedEmployee: { include: { user: { select: { accessLevel: true } } } } },
      orderBy: [{ branch: "asc" }, { unitNumber: "asc" }],
    }),
    prisma.employee.findMany({
      where: { status: "active" },
      include: { user: { select: { accessLevel: true } } },
    }),
  ]);
  const roster: EmployeeLite[] = employees.map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch, nickname: e.nickname }));
  const byId = new Map(employees.map((e) => [e.id, e]));
  const out: InspectableVehicle[] = [];
  for (const v of vehicles) {
    if (v.inspectExempt) continue;
    if (isTrailerLike(v)) continue;
    // Must have an assigned driver — unassigned spares aren't inspected.
    const hasDriver = !!(v.assignedEmployeeId || (v.assignedTo && v.assignedTo.trim()));
    if (!hasDriver) continue;
    let emp = v.assignedEmployee ? byId.get(v.assignedEmployee.id) ?? null : null;
    if (!emp) {
      const mid = matchEmployeeByName(v.assignedTo, roster);
      emp = mid ? byId.get(mid) ?? null : null;
    }
    // FAIL-OPEN: an assigned vehicle is inspected unless its driver clearly
    // resolves to leadership. A technician/advisor with messy or unresolved data
    // is NOT dropped (the earlier include-only rule wrongly excluded real techs).
    if (emp && driverIsLeadership({ role: emp.role, accessLevel: emp.user?.accessLevel ?? null })) continue;
    out.push({ id: v.id, unitNumber: v.unitNumber, name: v.name, branch: v.branch, assignedTo: v.assignedTo, currentMileage: v.currentMileage });
  }
  return out;
}

// ── Coverage gaps: tech/advisor with NO inspectable vehicle ───────────────────
// Reads the org-chart roster (active employees) and flags every TECHNICIAN or
// SERVICE ADVISOR who is NOT the assigned driver of an inspectable vehicle, so the
// user can fix the linkage (assign/link a truck on Fleet → Driver assignments).
// This is the positive side of the fail-open inspection rule: here we DO identify
// field drivers (by access level technician/sales, or a tech/advisor role string),
// excluding leadership, and list those with no truck.
const FIELD_DRIVER_ROLE_RE = /tech(nician)?\b|service advisor|sales advisor|\badvisor\b/i;

export type CoverageGap = { id: string; name: string; role: string | null; branch: string | null };

export async function vehicleCoverageGaps(branch?: string): Promise<CoverageGap[]> {
  const [employees, vehicles] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "active", ...(branch ? { branch } : {}) },
      include: { user: { select: { accessLevel: true } } },
    }),
    prisma.vehicle.findMany({
      where: { status: "active" },
      select: { id: true, assignedEmployeeId: true, assignedTo: true, inspectExempt: true, name: true, make: true, model: true },
    }),
  ]);
  const roster: EmployeeLite[] = employees.map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch, nickname: e.nickname }));

  // Employees who ARE the driver of an inspectable (active, non-exempt, non-trailer) vehicle.
  const driven = new Set<string>();
  for (const v of vehicles) {
    if (v.inspectExempt) continue;
    if (isTrailerLike(v)) continue;
    if (v.assignedEmployeeId) {
      driven.add(v.assignedEmployeeId);
      continue;
    }
    const mid = matchEmployeeByName(v.assignedTo, roster);
    if (mid) driven.add(mid);
  }

  const gaps: CoverageGap[] = [];
  for (const e of employees) {
    const level = e.user?.accessLevel ?? null;
    const role = e.role ?? "";
    const isFieldDriver = level === "technician" || level === "sales" || FIELD_DRIVER_ROLE_RE.test(role);
    if (!isFieldDriver) continue;
    if (driverIsLeadership({ role, accessLevel: level })) continue;
    if (driven.has(e.id)) continue;
    gaps.push({ id: e.id, name: e.name, role: e.role, branch: e.branch });
  }
  gaps.sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "") || a.name.localeCompare(b.name));
  return gaps;
}

// ── Oil-change AI/agent alert ────────────────────────────────────────────────
// Surface an alert when a vehicle is within 500 mi of its next-due oil-change
// mileage (vs Vehicle.currentMileage) OR within ~one month of its next-due date.
// Fed by the latest inspection's `oilChangeNextMileage` / `oilChangeNext`.

export const OIL_ALERT_MILES = 500;
export const OIL_ALERT_DAYS = 31; // ~one month

export type OilChangeAlert = { byMiles: number | null; byDays: number | null };

/** Returns the alert (how close by miles/date) when within window, else null. */
export function oilChangeAlert(
  currentMileage: number | null,
  oilNextMileage: number | null,
  oilNextDate: Date | null,
  now: Date = new Date(),
): OilChangeAlert | null {
  const byMiles = oilNextMileage != null && currentMileage != null ? oilNextMileage - currentMileage : null;
  const byDays = oilNextDate ? Math.round((oilNextDate.getTime() - now.getTime()) / 864e5) : null;
  const dueMiles = byMiles != null && byMiles <= OIL_ALERT_MILES;
  const dueDays = byDays != null && byDays <= OIL_ALERT_DAYS;
  if (!dueMiles && !dueDays) return null;
  return { byMiles: dueMiles ? byMiles : null, byDays: dueDays ? byDays : null };
}

/**
 * Which inspectable vehicles in a branch (or all) have / don't have an inspection
 * for the given month — powers the "inspection due" reminders and the
 * scorecard compliance metric. Only vehicles driven by a technician / service
 * advisor are counted (see `listInspectableVehicles`), so exempt vehicles and
 * leadership rigs never show as "missing an inspection."
 */
export async function inspectionStatus(year: number, month: number, branch?: string) {
  const vehicles = await listInspectableVehicles(branch);
  const done = await prisma.vehicleInspection.findMany({
    where: { year, month, ...(branch ? { branch } : {}) },
    select: { vehicleId: true, scorePct: true, grade: true },
  });
  const doneMap = new Map(done.map((d) => [d.vehicleId, d]));
  const rows = vehicles.map((v) => ({
    id: v.id,
    unitNumber: v.unitNumber,
    name: v.name,
    branch: v.branch,
    assignedTo: v.assignedTo,
    inspection: doneMap.get(v.id) ?? null,
  }));
  const completed = rows.filter((r) => r.inspection).length;
  return { rows, total: vehicles.length, completed, pending: vehicles.length - completed };
}

/**
 * Quarterly inspection completion for a branch — expected = active vehicles ×
 * months in the quarter. Powers the scorecard's inspection-compliance
 * auto-suggestion (met only when every vehicle was inspected every month).
 */
export async function quarterInspectionCompliance(year: number, quarter: number, branch: string) {
  const months: Record<number, number[]> = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };
  const qMonths = months[quarter] ?? [];
  const [inspectable, done] = await Promise.all([
    listInspectableVehicles(branch),
    prisma.vehicleInspection.count({ where: { year, month: { in: qMonths }, branch } }),
  ]);
  const vehicleCount = inspectable.length;
  const expected = vehicleCount * qMonths.length;
  const pct = expected > 0 ? Math.round((done / expected) * 1000) / 10 : 0;
  return { done, expected, vehicleCount, months: qMonths.length, pct, complete: expected > 0 && done >= expected };
}
