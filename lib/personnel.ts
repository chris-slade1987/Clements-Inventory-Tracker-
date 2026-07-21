import { prisma } from "@/lib/prisma";

// Personnel records (write-ups, notes, recognition, accident reports) that
// branch managers file on their team members. Every submission notifies HR.

// `icon` is inline-SVG path data (24x24 viewBox, stroke, currentColor) to match
// the site's nav icons — rendered by the record-type buttons.
export const RECORD_TYPES = [
  // Document with an exclamation — disciplinary paperwork.
  { key: "writeup", label: "Write-up", icon: "M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V8zM14 3v5h5M12 11.5v3m0 2.6h.01" },
  // Speech bubble with lines — an internal note / coaching comment.
  { key: "note", label: "Note / coaching", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v10a1 1 0 01-1 1H9l-4 4v-4H5a1 1 0 01-1-1zM8 9h8M8 12.5h5" },
  // Award medal with ribbon — recognition.
  { key: "recognition", label: "Recognition", icon: "M12 3a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM8.6 11.4L7 21l5-3 5 3-1.6-9.6" },
  // Safety shield with a medical cross — accident / injury report.
  { key: "accident", label: "Accident report", icon: "M12 3l7 3v5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6zM12 9v5M9.5 11.5h5" },
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

// ---- E-signatures ---------------------------------------------------------
export type SignRole = { key: string; label: string; statement: string };

const ACK = {
  writeupEmployee:
    "I acknowledge that I have received and discussed this disciplinary action with my supervisor. My signature indicates receipt — not necessarily agreement — and I understand I may submit a written response. I understand my employment is at-will.",
  writeupSupervisor:
    "I certify that I reviewed this matter with the employee and that the information recorded is accurate to the best of my knowledge.",
  hr: "Reviewed and processed by Human Resources.",
  accidentEmployee:
    "I certify that the information I have provided about this incident is true and accurate to the best of my knowledge. I understand that knowingly providing false information may result in disciplinary action.",
  accidentSupervisor:
    "I certify that I responded to and documented this incident in accordance with company procedure.",
  witness: "I certify that this statement is a true account of what I witnessed.",
};

export function signatureRoles(type: string): SignRole[] {
  if (type === "writeup")
    return [
      { key: "employee", label: "Employee", statement: ACK.writeupEmployee },
      { key: "supervisor", label: "Supervisor", statement: ACK.writeupSupervisor },
      { key: "hr", label: "HR representative", statement: ACK.hr },
    ];
  if (type === "accident")
    return [
      { key: "employee", label: "Employee", statement: ACK.accidentEmployee },
      { key: "supervisor", label: "Supervisor", statement: ACK.accidentSupervisor },
      { key: "witness", label: "Witness (optional)", statement: ACK.witness },
    ];
  return [];
}

// Legal / compliance footers surfaced on the forms and stored context.
export const WRITEUP_LEGAL =
  "This action is issued in accordance with company policy. Employment with Clements Pest Control is at-will and may be terminated by either party at any time, with or without cause. Clements does not retaliate against employees for lawful, good-faith conduct. The employee may attach a written rebuttal, which will be retained with this record.";

export const ACCIDENT_LEGAL =
  "This report supports workers' compensation and OSHA recordkeeping. Report all work-related injuries/illnesses immediately (within 24 hours). Non-emergency treatment must use a workers'-comp-approved provider. Medical information is confidential and maintained separately from the personnel file. Retaliation for reporting a workplace injury is prohibited.";

// Compliance yes/no fields for the accident report (stored in details JSON).
export const ACCIDENT_COMPLIANCE = [
  { key: "medicalOffered", label: "Was medical treatment offered to the employee?" },
  { key: "medicalDeclined", label: "Did the employee decline medical treatment?" },
  { key: "oshaRecordable", label: "Is this potentially OSHA-recordable?" },
  { key: "workersComp", label: "Workers' comp claim initiated?" },
];

// Escalation recipients (env-overridable). Every write-up / accident notifies
// HR (April) plus Field Ops (Graham), COO (Chris), and Tim Slade.
export const ESCALATION = {
  fieldOps: process.env.FIELD_OPS_EMAIL || "gfoster@clementspestcontrol.com",
  coo: process.env.COO_EMAIL || "c.slade@clementspestcontrol.com",
  owner: process.env.OWNER_EMAIL || "tslade@clementspestcontrol.com",
};

/** Who to email for a given record type. HR on everything; leadership on the serious ones. */
export async function notifyList(type: string): Promise<string[]> {
  const list = [await getHrEmail()];
  if (type === "writeup" || type === "accident") list.push(ESCALATION.fieldOps, ESCALATION.coo, ESCALATION.owner);
  return [...new Set(list.filter(Boolean))];
}

/** The HR director's email (env override → fallback to April Williford). */
export function hrDirectorEmail(): string {
  return (process.env.HR_EMAIL || "awilliford@clementspestcontrol.com").toLowerCase();
}

/** True for admins and the HR director — who manage HR reviews / final approvals. */
export function isHrDirector(user: { role: string; email: string }): boolean {
  return user.role === "admin" || user.email.toLowerCase() === hrDirectorEmail();
}

/**
 * Who may CLEAR a missed-checklist compliance infraction — ONLY the CEO (admin)
 * or the HR director (Chris + April today). Role/identity based so it stays
 * correct if the people change. A branch manager can NEVER clear a miss, not
 * even their own — the penalty is enforced from above.
 */
export function canClearChecklistMiss(user: { role: string; email: string }): boolean {
  return user.role === "admin" || isHrDirector(user);
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
  return prisma.personnelRecord.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    include: { signatures: { orderBy: { signedAt: "asc" } }, signatureRequests: { where: { signedAt: null } } },
  });
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
