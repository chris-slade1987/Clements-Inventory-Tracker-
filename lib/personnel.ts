import { prisma } from "@/lib/prisma";

// Personnel records (write-ups, notes, recognition, accident reports) that
// branch managers file on their team members. Every submission notifies HR.

export const RECORD_TYPES = [
  { key: "writeup", label: "Write-up", icon: "⚠️" },
  { key: "note", label: "Note / coaching", icon: "📝" },
  { key: "recognition", label: "Recognition", icon: "⭐" },
  { key: "accident", label: "Accident report", icon: "🚑" },
] as const;

export const WRITEUP_CATEGORIES = [
  { key: "verbal", label: "Verbal warning" },
  { key: "written", label: "Written warning" },
  { key: "final", label: "Final warning" },
  { key: "pip", label: "Performance improvement plan" },
];

export const ACCIDENT_SEVERITY = [
  { key: "minor", label: "Minor (first aid only)" },
  { key: "recordable", label: "OSHA recordable" },
  { key: "serious", label: "Serious / lost time" },
];

// Structured fields captured for a workplace accident (stored in details JSON).
export const ACCIDENT_FIELDS = [
  { key: "location", label: "Location of incident" },
  { key: "injuryType", label: "Type of injury / illness" },
  { key: "bodyPart", label: "Body part affected" },
  { key: "medicalTreatment", label: "Medical treatment provided" },
  { key: "witnesses", label: "Witness(es)" },
  { key: "equipmentInvolved", label: "Equipment / chemical involved" },
];

// Manager checklist to work through in the event of an accident. (Default set —
// will be aligned to the company's uploaded checklist.)
export const ACCIDENT_CHECKLIST = [
  { key: "secure", label: "Secure the scene and remove ongoing hazards" },
  { key: "medical", label: "Ensure injured party receives appropriate medical care" },
  { key: "notify_hr", label: "Notify HR (April Williford) immediately" },
  { key: "notify_mgmt", label: "Notify branch/senior management" },
  { key: "photos", label: "Photograph the scene / equipment involved" },
  { key: "witnesses", label: "Collect witness statements" },
  { key: "document", label: "Document what happened while fresh" },
  { key: "workers_comp", label: "Begin workers' comp / insurance reporting if applicable" },
  { key: "drug_test", label: "Arrange post-accident drug screening per policy (if applicable)" },
  { key: "corrective", label: "Identify corrective action to prevent recurrence" },
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
