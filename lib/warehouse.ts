import { prisma } from "@/lib/prisma";
import { gradeLetter } from "@/lib/inspection";

// Monthly warehouse safety inspection. Based on the company's FL Statute 482 /
// FDACS log, extended with OSHA + pest-control-specific items (HazCom/SDS,
// respiratory protection, RUP records, disposal, posted emergency procedures).
// Yes/No per item with an optional corrective-action comment; critical items
// raise a safety alert when failed.

export type WarehouseItem = { key: string; label: string; critical: boolean };
export type WarehouseSection = { section: string; items: WarehouseItem[] };

export const WAREHOUSE_SECTIONS: WarehouseSection[] = [
  {
    section: "Chemical storage & handling",
    items: [
      { key: "pesticides_labeled", label: "All pesticides stored in original, labeled containers", critical: true },
      { key: "storage_locked_ventilated", label: "Chemical storage areas locked and ventilated", critical: true },
      { key: "storage_separated", label: "Pesticide storage separated from non-chemical items", critical: false },
      { key: "no_expired", label: "No expired/unusable products; segregated for proper disposal", critical: false },
      { key: "rup_records", label: "Restricted-use pesticide (RUP) records & application logs maintained", critical: true },
    ],
  },
  {
    section: "Safety equipment & PPE",
    items: [
      { key: "spill_kits", label: "Spill kits stocked and readily accessible", critical: true },
      { key: "ppe_available", label: "PPE (gloves, goggles, respirators) available and in good condition", critical: true },
      { key: "respirator_program", label: "Respirators fit-tested & medical clearance current (OSHA 1910.134)", critical: false },
      { key: "sds_accessible", label: "Safety Data Sheets (SDS) accessible for all products (HazCom)", critical: true },
      { key: "inventory_list", label: "Current pesticide inventory list available and accurate", critical: false },
      { key: "fdacs_id_posted", label: "Certified-operator license & FDACS employee ID cards current and posted (FL 482)", critical: false },
    ],
  },
  {
    section: "Facility & emergency readiness",
    items: [
      { key: "fire_extinguishers", label: "Fire extinguishers inspected and accessible", critical: true },
      { key: "extinguisher_tag", label: "Fire extinguishers show a current monthly check tag (OSHA 1910.157)", critical: false },
      { key: "exits_marked", label: "Emergency exits clearly marked and unobstructed", critical: true },
      { key: "aisle_clearance", label: "Aisles, exits & electrical panels have required clearance (36\", OSHA 1910.303)", critical: false },
      { key: "first_aid", label: "First aid kit fully stocked and accessible", critical: false },
      { key: "eyewash", label: "Eyewash station (if required) operational and clean", critical: false },
      { key: "emergency_posted", label: "Emergency response / spill procedures & emergency numbers posted", critical: false },
      { key: "no_food_mix", label: "No food, drink or tobacco in mixing/storage areas; wash station available", critical: false },
      { key: "warehouse_clean", label: "Warehouse clean, dry, and free of obstructions", critical: false },
      { key: "lighting_ventilation", label: "Lighting and ventilation adequate for safe operations", critical: false },
    ],
  },
];

export const WAREHOUSE_ITEMS: WarehouseItem[] = WAREHOUSE_SECTIONS.flatMap((s) => s.items);

// Guided compliance photos — the inspector is asked to capture each. "required"
// ones nudge a complete record; all are stored with the inspection.
export type PhotoPrompt = { key: string; label: string; hint: string; required: boolean };
export const WAREHOUSE_PHOTO_PROMPTS: PhotoPrompt[] = [
  { key: "chem_storage", label: "Chemical storage room", hint: "Door locked + ventilation; shelving & secondary containment", required: true },
  { key: "sds", label: "SDS binder / station", hint: "Safety Data Sheets accessible where products are used", required: true },
  { key: "spill_kit", label: "Spill kit", hint: "Stocked and accessible", required: true },
  { key: "extinguisher", label: "Fire extinguisher + tag", hint: "Close enough to read the current monthly check tag", required: true },
  { key: "first_aid", label: "First-aid kit", hint: "Open to show contents", required: false },
  { key: "eyewash", label: "Eyewash station", hint: "If required at your branch", required: false },
  { key: "emergency_posted", label: "Posted emergency procedures", hint: "Spill procedure + emergency numbers on the wall", required: false },
  { key: "overall", label: "Overall warehouse", hint: "Wide shot — clean, dry, aisles clear", required: true },
];
export function photoPromptLabel(key: string): string {
  return WAREHOUSE_PHOTO_PROMPTS.find((p) => p.key === key)?.label ?? key;
}

// Yes / No / N/A. N/A (an item that doesn't apply, e.g. an eyewash where none is
// required) is excluded from scoring so it never wrongly dings compliance.
export type CheckVal = boolean | "na";
export type Checks = Record<string, CheckVal>;

export function scoreWarehouse(checks: Checks) {
  let maxScore = 0;
  let score = 0;
  for (const it of WAREHOUSE_ITEMS) {
    if (checks[it.key] === "na") continue; // not applicable — out of the denominator
    maxScore += 1;
    if (checks[it.key] === true) score += 1;
  }
  const scorePct = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  return { score, maxScore, scorePct, grade: gradeLetter(scorePct) };
}

export function criticalFailures(checks: Checks): { key: string; label: string }[] {
  return WAREHOUSE_ITEMS.filter((it) => it.critical && checks[it.key] === false).map((it) => ({ key: it.key, label: it.label }));
}

export type NeedInput = { itemKey: string | null; label: string | null; request: string };

/** Open supply/facility needs raised during inspections (for leadership follow-up). */
export async function openWarehouseNeeds(branch?: string) {
  return prisma.warehouseNeed.findMany({
    where: { status: "open", ...(branch ? { branch } : {}) },
    orderBy: [{ createdAt: "desc" }],
  });
}

// --- Weekly emergency-equipment check (OSHA weekly eyewash activation, etc.) ---
export const WEEKLY_EQUIPMENT_ITEMS = [
  { key: "eyewash", label: "Eyewash station activated / flushed" },
  { key: "spill_kit", label: "Spill kit stocked" },
  { key: "exits", label: "Exits & aisles clear" },
  { key: "extinguishers", label: "Fire extinguishers in place & charged" },
] as const;

/** ISO date (YYYY-MM-DD) of the Monday of the week containing `d` (UTC). */
export function mondayOf(d: Date): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() - ((u.getUTCDay() + 6) % 7));
  return u.toISOString().slice(0, 10);
}

export async function weeklyCheckStatus(branch: string, ref = new Date()) {
  const weekStart = mondayOf(ref);
  const check = await prisma.weeklyEquipmentCheck.findUnique({ where: { branch_weekStart: { branch, weekStart } } });
  return { weekStart, check, done: !!check };
}

/** The most recent inspection BEFORE (year, month) at a branch — for repeat-finding detection. */
export async function priorInspection(branch: string, year: number, month: number) {
  return prisma.warehouseInspection.findFirst({
    where: { branch, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { needs: true },
  });
}

/** Item keys that failed this month AND the prior inspection (chronic findings). */
export function repeatFailures(current: Checks, prior: Checks | null): Set<string> {
  const out = new Set<string>();
  if (!prior) return out;
  for (const it of WAREHOUSE_ITEMS) if (current[it.key] === false && prior[it.key] === false) out.add(it.key);
  return out;
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** Branch warehouse-inspection status for a month (done? which one?). */
export async function warehouseStatus(year: number, month: number, branch: string) {
  const inspection = await prisma.warehouseInspection.findUnique({
    where: { branch_year_month: { branch, year, month } },
  });
  return { inspection, done: !!inspection };
}

export async function warehouseHistory(branch?: string) {
  return prisma.warehouseInspection.findMany({
    where: branch ? { branch } : undefined,
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

/** Quarterly completion for the scorecard (one warehouse inspection per month). */
export async function quarterWarehouseCompliance(year: number, quarter: number, branch: string) {
  const months: Record<number, number[]> = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };
  const qMonths = months[quarter] ?? [];
  const done = await prisma.warehouseInspection.count({ where: { branch, year, month: { in: qMonths } } });
  const expected = qMonths.length;
  const pct = expected > 0 ? Math.round((done / expected) * 1000) / 10 : 0;
  return { done, expected, pct, complete: done >= expected };
}
