import { prisma } from "@/lib/prisma";

// Personnel records (write-ups, notes, recognition, accident reports) that
// branch managers file on their team members. Every submission notifies HR.

export const RECORD_TYPES = [
  { key: "writeup", label: "Write-up", icon: "⚠️" },
  { key: "note", label: "Note / coaching", icon: "📝" },
  { key: "recognition", label: "Recognition", icon: "⭐" },
  { key: "accident", label: "Accident report", icon: "🚑" },
] as const;

// Matches the company's Employee Disciplinary Action Form.
export const WRITEUP_CATEGORIES = [
  { key: "verbal", label: "Verbal warning" },
  { key: "written", label: "Written warning" },
  { key: "suspension", label: "Suspension" },
  { key: "termination", label: "Termination" },
  { key: "other", label: "Other" },
];

// Extra write-up fields (Disciplinary Action Form), stored in details JSON.
export const WRITEUP_FIELDS = [
  { key: "policyViolated", label: "Policy / procedure violated", area: false },
  { key: "priorActions", label: "Prior disciplinary actions (dates & descriptions)", area: true },
  { key: "consequences", label: "Consequences of non-compliance", area: true },
  { key: "employeeComments", label: "Employee comments (optional)", area: true },
];

export const ACCIDENT_SEVERITY = [
  { key: "minor", label: "Minor" },
  { key: "moderate", label: "Moderate" },
  { key: "severe", label: "Severe" },
];

// Structured fields from the Workplace Accident Report template (details JSON).
export const ACCIDENT_FIELDS = [
  { key: "time", label: "Time of accident (AM/PM)" },
  { key: "location", label: "Location of accident" },
  { key: "city", label: "City" },
  { key: "zip", label: "Zip" },
  { key: "jobTitle", label: "Job title" },
  { key: "witnesses", label: "Witness(es)" },
  { key: "immediateActions", label: "Immediate actions taken" },
  { key: "natureOfInjury", label: "Nature of injury" },
  { key: "bodyPart", label: "Body part(s) injured" },
  { key: "medicalTreatment", label: "Medical treatment provided" },
];

// The company's Supervisor's Checklist for Workplace Injury Response.
export const ACCIDENT_CHECKLIST_GROUPS = [
  {
    group: "Ensure immediate safety",
    items: [
      { key: "secure", label: "Secure the area to prevent further accidents or injuries" },
      { key: "first_aid", label: "Provide immediate first aid or call for medical assistance if required" },
      { key: "emergency", label: "If an emergency, call 911; if serious but not an emergency, accompany the employee to the ER / urgent care" },
      { key: "no_drive", label: "If serious / needs outside treatment, do NOT let the injured employee operate a company vehicle" },
      { key: "emergency_contact", label: "Inform the employee's emergency contact if necessary" },
    ],
  },
  {
    group: "Communicate with employee & management",
    items: [
      { key: "offer_treatment", label: "Offer medical treatment immediately (ask if they need it). If declined, note it on the report" },
      { key: "notify_hr", label: "Notify HR / Benefits Coordinator — April Williford" },
      { key: "notify_ops", label: "Notify Director of Field Operations — Graham Foster" },
      { key: "notify_coo", label: "Notify COO — Chris Slade" },
    ],
  },
  {
    group: "Preserve the scene",
    items: [
      { key: "preserve", label: "Maintain the scene without altering evidence until the investigation is complete" },
      { key: "restrict", label: "Restrict access to the area if needed" },
      { key: "photos", label: "Take photographs / record the scene if possible and appropriate" },
    ],
  },
  {
    group: "Gather information & complete the report",
    items: [
      { key: "employee_report", label: "If alert & capable, have the employee complete this Workplace Accident Report" },
      { key: "supervisor_notes", label: "Fill in the remaining supervisor notes & sign" },
      { key: "witness_statements", label: "Collect statements from any witnesses" },
      { key: "attach_docs", label: "Attach supporting documents (witness statements, photographs)" },
      { key: "submit", label: "Submit to April Williford and save a scanned copy to the Management Drive" },
    ],
  },
];

// Standing rules to surface prominently on the accident form.
export const ACCIDENT_NOTES = [
  "Emergencies: call 911 immediately.",
  "Non-emergency treatment must use a workers'-comp-approved provider. For specialists (back, shoulder, etc.), the employee must speak with Chris Slade before making arrangements.",
  "Notify April Williford (HR), Graham Foster (Field Ops), and Chris Slade (COO).",
];

export function recordTypeLabel(type: string): string {
  return RECORD_TYPES.find((t) => t.key === type)?.label ?? type;
}

/** Resolve the HR notification address: env override → April Williford → fallback. */
export async function getHrEmail(): Promise<string> {
  if (process.env.HR_EMAIL) return process.env.HR_EMAIL;
  const setting = await prisma.setting.findUnique({ where: { key: "hr_email" } }).catch(() => null);
  if (setting?.value) return setting.value;
  const april = await prisma.employee.findFirst({ where: { name: { contains: "April Williford" } }, select: { email: true } });
  return april?.email ?? "awilliford@clementspestcontrol.com";
}

export async function employeeRecords(employeeId: string) {
  return prisma.personnelRecord.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
}

/** Team roster for a branch with per-member record counts (for the Team tab). */
export async function teamRoster(branch?: string) {
  const employees = await prisma.employee.findMany({
    where: { status: "active", ...(branch ? { branch } : {}) },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
  const records = await prisma.personnelRecord.groupBy({
    by: ["employeeId", "type"],
    where: { employeeId: { in: employees.map((e) => e.id) } },
    _count: { _all: true },
  });
  const byEmp = new Map<string, Record<string, number>>();
  for (const r of records) {
    const m = byEmp.get(r.employeeId) ?? {};
    m[r.type] = r._count._all;
    byEmp.set(r.employeeId, m);
  }
  return employees.map((e) => {
    const counts = byEmp.get(e.id) ?? {};
    return {
      ...e,
      writeups: counts.writeup ?? 0,
      accidents: counts.accident ?? 0,
      total: Object.values(counts).reduce((s, n) => s + n, 0),
    };
  });
}
