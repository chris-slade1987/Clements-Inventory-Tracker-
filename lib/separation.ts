import { prisma } from "@/lib/prisma";

// Employee offboarding — separation reasons, supporting docs, and the
// HR-conducted exit interview. Terminated employees move to the "former
// employees" list; their profile and all linked data are retained.

export const SEPARATION_TYPES = [
  { key: "voluntary", label: "Voluntary (resignation)" },
  { key: "involuntary", label: "Involuntary (termination)" },
  { key: "layoff", label: "Layoff / position eliminated" },
  { key: "other", label: "Other" },
] as const;

export const REASON_CATEGORIES = [
  { key: "resignation", label: "Resignation" },
  { key: "new_opportunity", label: "Left for another opportunity" },
  { key: "relocation", label: "Relocation" },
  { key: "performance", label: "Performance" },
  { key: "misconduct", label: "Misconduct / policy violation" },
  { key: "attendance", label: "Attendance" },
  { key: "job_abandonment", label: "Job abandonment / no-call no-show" },
  { key: "layoff", label: "Layoff / restructuring" },
  { key: "end_of_season", label: "End of seasonal / temp role" },
  { key: "other", label: "Other" },
] as const;

export function separationTypeLabel(key: string | null): string {
  return SEPARATION_TYPES.find((t) => t.key === key)?.label ?? key ?? "—";
}
export function reasonCategoryLabel(key: string | null): string {
  return REASON_CATEGORIES.find((r) => r.key === key)?.label ?? key ?? "—";
}

export const EXIT_STATUS_LABEL: Record<string, string> = {
  pending: "Exit interview pending",
  completed: "Exit interview completed",
  bypassed: "Exit interview bypassed",
};

// Exit-interview questionnaire, conducted by the HR director. Typed items
// rendered by a generic form (same pattern as the new-hire review).
export type ExitItem = { key: string; type: "choice" | "textarea" | "yesno"; label: string; options?: string[] };
export type ExitSection = { title: string; items: ExitItem[] };

const YN = ["Yes", "No"];

export const EXIT_INTERVIEW: ExitSection[] = [
  {
    title: "Reason for leaving",
    items: [
      { key: "primary_reason", type: "textarea", label: "In the employee's own words, the primary reason for leaving" },
      { key: "reason_avoidable", type: "yesno", label: "Was the departure something the company could have prevented?" },
      { key: "reason_avoidable_how", type: "textarea", label: "If yes, how?" },
    ],
  },
  {
    title: "Experience at Clements",
    items: [
      { key: "overall", type: "choice", options: ["Very positive", "Positive", "Neutral", "Negative", "Very negative"], label: "Overall experience working here" },
      { key: "valued_most", type: "textarea", label: "What did the employee value most about working here?" },
      { key: "improve", type: "textarea", label: "What could the company improve?" },
      { key: "training_adequate", type: "choice", options: YN, label: "Was training & onboarding adequate?" },
      { key: "supervisor_support", type: "choice", options: ["Excellent", "Good", "Fair", "Poor"], label: "Support from their supervisor / branch" },
      { key: "safety_concerns", type: "yesno", label: "Any unaddressed safety concerns?" },
      { key: "safety_notes", type: "textarea", label: "Safety notes (if any)" },
    ],
  },
  {
    title: "Wrap-up",
    items: [
      { key: "recommend", type: "choice", options: YN, label: "Would the employee recommend Clements as an employer?" },
      { key: "would_return", type: "choice", options: ["Yes", "Maybe", "No"], label: "Would they consider returning in the future?" },
      { key: "property_returned", type: "yesno", label: "Company property returned (keys, uniforms, devices, fuel card)?" },
      { key: "property_outstanding", type: "textarea", label: "Outstanding property / follow-up items" },
      { key: "additional", type: "textarea", label: "Additional comments" },
      { key: "hr_notes", type: "textarea", label: "HR notes (internal)" },
    ],
  },
];

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export type SeparationDoc = { file: string; name: string };

/** Former (inactive) employees with their separation record, newest departure first. */
export async function formerEmployees(branch?: string) {
  const employees = await prisma.employee.findMany({
    where: { status: "inactive", ...(branch ? { branch } : {}) },
    include: { separation: true },
    orderBy: [{ terminatedAt: "desc" }, { name: "asc" }],
  });
  return employees;
}

export async function separationForEmployee(employeeId: string) {
  return prisma.employeeSeparation.findUnique({ where: { employeeId } });
}

// ---- Check-out roster sync ------------------------------------------------
// The check-out (chemical dispersement) screen lists ACTIVE `Technician` rows,
// which are a separate table from `Employee` linked only by name. So a
// termination must also flip the matching technician's `active` flag, or a
// former employee keeps showing up as a dispersement recipient.

/** Normalize a person's name for cross-table (Employee ↔ Technician) matching. */
function normName(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Flip the `active` flag on the technician pick-list row(s) matching an
 * employee (by normalized name) — false on termination, true on reactivation —
 * so the check-out dispersement list follows employment status. Name-based
 * because there is no FK between employees and technicians. Returns count changed.
 */
export async function syncTechnicianActiveForEmployee(employeeName: string, active: boolean): Promise<number> {
  const target = normName(employeeName);
  const techs = await prisma.technician.findMany({ select: { id: true, name: true, active: true } });
  const ids = techs.filter((t) => normName(t.name) === target && t.active !== active).map((t) => t.id);
  if (ids.length === 0) return 0;
  const r = await prisma.technician.updateMany({ where: { id: { in: ids } }, data: { active } });
  return r.count;
}

/**
 * Deploy-time reconcile: deactivate any still-active technician whose name
 * matches a terminated (inactive) employee. Catches people terminated before the
 * termination→technician sync existed (e.g. an already-offboarded employee still
 * on the dispersement list). Idempotent; returns count changed.
 */
export async function reconcileTerminatedTechnicians(): Promise<number> {
  const inactive = await prisma.employee.findMany({ where: { status: "inactive" }, select: { name: true } });
  if (inactive.length === 0) return 0;
  const names = new Set(inactive.map((e) => normName(e.name)));
  const techs = await prisma.technician.findMany({ where: { active: true }, select: { id: true, name: true } });
  const ids = techs.filter((t) => names.has(normName(t.name))).map((t) => t.id);
  if (ids.length === 0) return 0;
  const r = await prisma.technician.updateMany({ where: { id: { in: ids } }, data: { active: false } });
  return r.count;
}
