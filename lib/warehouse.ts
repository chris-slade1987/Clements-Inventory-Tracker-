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
      { key: "spill_containment", label: "Spill containment in place (e.g., secondary containment)", critical: true },
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
    ],
  },
  {
    section: "Facility & emergency readiness",
    items: [
      { key: "fire_extinguishers", label: "Fire extinguishers inspected and accessible", critical: true },
      { key: "exits_marked", label: "Emergency exits clearly marked and unobstructed", critical: true },
      { key: "first_aid", label: "First aid kit fully stocked and accessible", critical: false },
      { key: "eyewash", label: "Eyewash station (if required) operational and clean", critical: false },
      { key: "emergency_posted", label: "Emergency response / spill procedures & emergency numbers posted", critical: false },
      { key: "warehouse_clean", label: "Warehouse clean, dry, and free of obstructions", critical: false },
      { key: "lighting_ventilation", label: "Lighting and ventilation adequate for safe operations", critical: false },
    ],
  },
];

export const WAREHOUSE_ITEMS: WarehouseItem[] = WAREHOUSE_SECTIONS.flatMap((s) => s.items);

export type Checks = Record<string, boolean>;

export function scoreWarehouse(checks: Checks) {
  const maxScore = WAREHOUSE_ITEMS.length;
  let score = 0;
  for (const it of WAREHOUSE_ITEMS) if (checks[it.key] === true) score += 1;
  const scorePct = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  return { score, maxScore, scorePct, grade: gradeLetter(scorePct) };
}

export function criticalFailures(checks: Checks): { key: string; label: string }[] {
  return WAREHOUSE_ITEMS.filter((it) => it.critical && checks[it.key] === false).map((it) => ({ key: it.key, label: it.label }));
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
