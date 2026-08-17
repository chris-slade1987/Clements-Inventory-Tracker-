import { prisma } from "@/lib/prisma";

// Field Quality-Control inspections. A manager rides behind a technician (same
// day or next day as the treatment) and grades the work against a short
// checklist. Two forms — General Household Pest (ghp) and Lawn & Ornamental (lo).
// Goal: 10 of each per month per branch (20 total), which feeds the quarterly
// manager scorecard. Every completed inspection is filed to the evaluated
// technician's personnel profile and archived in the Branch Hub.

export type QcType = "ghp" | "lo";
export type QcResult = "pass" | "fail" | "na";

export const QC_TYPES: { key: QcType; label: string; short: string }[] = [
  { key: "ghp", label: "General Household Pest Control", short: "GHP" },
  { key: "lo", label: "Lawn & Ornamental", short: "L&O" },
];

export type QcItem = { id: string; label: string };

// 7–8 grading items per form. Reworded freely by the owner; ids are stable so
// past inspections keep mapping to their items.
export const QC_ITEMS: Record<QcType, QcItem[]> = {
  ghp: [
    { id: "g1", label: "No visible pests on or in the structure" },
    { id: "g2", label: "No spider webs on the structure (eaves, doors, windows)" },
    { id: "g3", label: "Evidence of proper treatment (coverage, bait / station placements)" },
    { id: "g4", label: "Door hanger / service notice left when the customer was not home" },
    { id: "g5", label: "Entry points and cracks & crevices treated or noted" },
    { id: "g6", label: "Conducive conditions addressed or noted for the customer" },
    { id: "g7", label: "Customer concerns on the ticket were addressed" },
    { id: "g8", label: "Property left clean — no spills, equipment, or debris" },
  ],
  lo: [
    { id: "l1", label: "No visible weeds in the turf (broadleaf / grassy)" },
    { id: "l2", label: "Turf health consistent with service (no burn / untreated stress)" },
    { id: "l3", label: "Areas of concern flagged with a yellow flag" },
    { id: "l4", label: "Lawn service sign placed in the yard" },
    { id: "l5", label: "Ornamentals / shrubs treated, no visible pests or disease" },
    { id: "l6", label: "Full coverage — no skipped zones or edges" },
    { id: "l7", label: "Door hanger / service notice left when the customer was not home" },
    { id: "l8", label: "Property left clean — gates closed, no equipment or debris" },
  ],
};

/** Monthly per-branch goal for EACH form (ghp and lo). 10 + 10 = 20 total. */
export const QC_MONTHLY_GOAL_PER_TYPE = 10;

export function qcTypeLabel(type: string): string {
  return QC_TYPES.find((t) => t.key === type)?.label ?? type;
}
export function qcTypeShort(type: string): string {
  return QC_TYPES.find((t) => t.key === type)?.short ?? type;
}
export function qcItems(type: string): QcItem[] {
  return QC_ITEMS[(type as QcType)] ?? [];
}

export type QcResultRow = { itemId: string; result: QcResult };
export function parseResults(json: string | null | undefined): QcResultRow[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json) as QcResultRow[];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** Month period key ("2026-08") in UTC for a date. */
export function monthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
const QUARTER_MONTHS: Record<number, number[]> = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };

// ---- Progress --------------------------------------------------------------

export type QcMonthlyProgress = {
  monthKey: string;
  ghp: number;
  lo: number;
  goalPerType: number;
  goalTotal: number;
  total: number;
  complete: boolean;
};

/** This month's completion for a branch: counts per form vs the 10/10 goal. */
export async function monthlyQcProgress(branch: string, key: string = monthKey()): Promise<QcMonthlyProgress> {
  const rows = await prisma.qcInspection.groupBy({
    by: ["type"],
    where: { branch, periodKey: key },
    _count: { _all: true },
  });
  const ghp = rows.find((r) => r.type === "ghp")?._count._all ?? 0;
  const lo = rows.find((r) => r.type === "lo")?._count._all ?? 0;
  const goalPerType = QC_MONTHLY_GOAL_PER_TYPE;
  return {
    monthKey: key,
    ghp,
    lo,
    goalPerType,
    goalTotal: goalPerType * 2,
    total: ghp + lo,
    complete: ghp >= goalPerType && lo >= goalPerType,
  };
}

/**
 * Quarterly QC compliance for the scorecard: total inspections done this quarter
 * vs the expected 20/month × 3 months = 60. `complete` once the branch has met
 * the full quarter's goal. Mirrors the vehicle/warehouse/training compliance
 * helpers so the scorecard can auto-suggest Met/Not.
 */
export async function quarterQcCompliance(year: number, quarter: number, branch: string) {
  const qMonths = QUARTER_MONTHS[quarter] ?? [];
  const keys = qMonths.map((m) => `${year}-${String(m).padStart(2, "0")}`);
  const rows = await prisma.qcInspection.groupBy({
    by: ["type"],
    where: { branch, periodKey: { in: keys } },
    _count: { _all: true },
  });
  const ghp = rows.find((r) => r.type === "ghp")?._count._all ?? 0;
  const lo = rows.find((r) => r.type === "lo")?._count._all ?? 0;
  const done = ghp + lo;
  const expected = QC_MONTHLY_GOAL_PER_TYPE * 2 * qMonths.length; // 20 × 3 = 60
  const pct = expected > 0 ? Math.round((done / expected) * 1000) / 10 : 0;
  return { ghp, lo, done, expected, months: qMonths.length, pct, complete: expected > 0 && done >= expected };
}

// ---- Queries ---------------------------------------------------------------

/** Recent inspections for a branch (the Branch Hub QC archive). */
export function listQcInspections(branch: string, limit = 100) {
  return prisma.qcInspection.findMany({
    where: { branch },
    orderBy: { inspectionDate: "desc" },
    take: limit,
  });
}

/** A branch's active technicians (the evaluee dropdown). */
export async function branchTechnicians(branch: string) {
  return prisma.employee.findMany({
    where: { status: "active", branch, role: { contains: "Technician" } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}
