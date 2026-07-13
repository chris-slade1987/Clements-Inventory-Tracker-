import { prisma } from "@/lib/prisma";

// Director of Field Ops quarterly branch audit. Mirrors the paper form:
// ride-along technician evaluations, a facility inspection, and personnel &
// training checks — plus a pre-visit prep checklist and follow-up action items.

export const SERVICE_TYPES = [
  { key: "general_pest", label: "General Pest" },
  { key: "termite", label: "Termite" },
  { key: "lawn", label: "Lawn & Ornamental" },
  { key: "mosquito", label: "Mosquito" },
  { key: "rodent", label: "Rodent" },
  { key: "other", label: "Other" },
] as const;

// 1-5 rating used for ride-alongs and section ratings.
export const SCALE_5 = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Needs Improvement" },
  { value: 3, label: "Adequate" },
  { value: 4, label: "Good" },
  { value: 5, label: "Excellent" },
] as const;

// 1-3 rating used for facility items.
export const SCALE_3 = [
  { value: 1, label: "Improvement Needed" },
  { value: 2, label: "Adequate" },
  { value: 3, label: "Excellent" },
] as const;

export const RIDE_ALONG_RATINGS = [
  { key: "customerInteraction", label: "Customer Interaction", hint: "Professional, clear, engaging?" },
  { key: "serviceExecution", label: "Service Execution", hint: "Correct procedures & best practices?" },
  { key: "equipmentPrep", label: "Equipment & Vehicle Preparedness", hint: "Equipment in good working order?" },
  { key: "safety", label: "Adherence to Safety Protocols", hint: "PPE worn? Chemicals handled safely?" },
] as const;

// Section 2A + 2B — facility 1-3 items.
export const FACILITY_SAFETY = [
  { key: "ppe", label: "PPE available and in use" },
  { key: "vehicles_stocked", label: "Vehicles properly stocked and organized" },
  { key: "chemical_storage", label: "Proper storage of chemicals and equipment" },
  { key: "extinguishers_firstaid", label: "Fire extinguishers and first-aid kits accessible" },
  { key: "no_hazards", label: "No visible safety hazards present" },
] as const;

export const FACILITY_CLEAN = [
  { key: "office", label: "Office area organized and professional" },
  { key: "licenses_displayed", label: "Licenses & certifications current and displayed" },
  { key: "osha_posters", label: "Required OSHA / workplace safety posters displayed" },
  { key: "breakroom_restrooms", label: "Breakroom and restrooms clean" },
  { key: "warehouse_storage", label: "Warehouse and chemical storage maintained" },
] as const;

// Section 2C — equipment & vehicles yes/no.
export const EQUIPMENT_YESNO = [
  { key: "handheld_working", label: "Handheld equipment (B&G, flashlights, aerosols) in working order" },
  { key: "vehicles_clean", label: "Service vehicles clean, stocked and maintained" },
  { key: "vehicle_inspections", label: "Technicians conducting regular vehicle inspections" },
  { key: "spill_kits", label: "Spill kits in every vehicle" },
  { key: "accident_forms", label: "Motor-vehicle accident forms in every vehicle" },
  { key: "insurance_cards", label: "Insurance cards in every vehicle" },
  { key: "tools_stored", label: "Tools and safety gear stored correctly" },
  { key: "backup_supplies", label: "Backup & emergency supplies available" },
] as const;

// Section 3 — personnel & training yes/no.
export const PERSONNEL_YESNO = [
  { key: "ceu_current", label: "Employees up to date on CEU training & certification" },
  { key: "training_access", label: "Employees have access to training materials (Paychex)" },
  { key: "uniforms_ids", label: "Employees wearing proper uniforms and ID badges" },
  { key: "meetings", label: "Team meetings and safety briefings held regularly" },
  { key: "complaint_process", label: "Process in place for handling customer complaints" },
  { key: "reviews_scheduled", label: "Performance reviews completed as scheduled" },
] as const;

// Pre-visit prep checklist (grouped) — from the Director's monthly prep doc.
export const PRECHECK_GROUPS = [
  { group: "Follow-up from previous visit", items: ["Review notes from last visit", "Confirm completion of assigned tasks / action items", "Identify outstanding issues needing resolution"] },
  { group: "Manager check-in", items: ["Equipment / uniforms / products to bring from Vero Beach", "Operational concerns to address", "Anything else needed for the meeting", "Schedule the ride-along & choose the technician"] },
  { group: "Branch performance metrics", items: ["Revenue & profit trends for the past month", "Customer retention & recent cancellations", "Service completion rates & outstanding work orders", "Technician productivity & performance reports"] },
  { group: "Employee & staffing", items: ["Confirm staffing changes (hires, terms, promotions)", "Performance concerns or standout achievements", "Training progress & CEU completions"] },
  { group: "Operational & service", items: ["Recurring customer complaints or service issues", "Escalated customer concerns from the past month", "Equipment, vehicle & supply inventory up to date"] },
  { group: "Compliance & safety", items: ["Safety incidents / near-misses & responses", "Technicians up to date on safety training", "Compliance with regulatory & company standards"] },
  { group: "Financial & budget", items: ["Branch expenses vs. budget", "Financial concerns / overspending", "Invoices & collections on track"] },
  { group: "Sales & marketing", items: ["Branch marketing campaign performance", "New customer acquisitions & lead conversions", "Opportunities to grow sales in territory", "Marketing materials to bring from Vero Beach"] },
  { group: "Training materials", items: ["This month's training course printed & laminated", "Review technicians' responses to training", "Confirm personal completion of the course", "Knowledge gaps / follow-ups after training"] },
  { group: "HR check-in", items: ["HR updates / requests / documents", "Paperwork to deliver to the branch", "Documents / signed materials to bring back", "Employee concerns to relay to HR"] },
  { group: "Agenda & talking points", items: ["Key updates / issues to discuss with the manager", "Action items to assign or follow up on", "Prepare responses to expected questions"] },
] as const;

export const PRECHECK_ITEMS = PRECHECK_GROUPS.flatMap((g, gi) => g.items.map((label, ii) => ({ key: `g${gi}i${ii}`, group: g.group, label })));

export type Facility = Record<string, number | boolean>;
export type YesNo = Record<string, boolean>;
export type Ratings5 = Record<string, number>;

const FACILITY_13 = [...FACILITY_SAFETY, ...FACILITY_CLEAN];

/** Aggregate branch score: facility (1-3), equipment & personnel yes/no + section 1-5 ratings. */
export function scoreAudit(facility: Facility, personnel: YesNo, ratings: Ratings5) {
  let score = 0;
  let max = 0;
  for (const it of FACILITY_13) { max += 3; const v = Number(facility[it.key]); if (v >= 1 && v <= 3) score += v; }
  for (const it of EQUIPMENT_YESNO) { max += 1; if (facility[it.key] === true) score += 1; }
  for (const it of PERSONNEL_YESNO) { max += 1; if (personnel[it.key] === true) score += 1; }
  for (const key of ["equipment", "personnel"]) { max += 5; const v = Number(ratings[key]); if (v >= 1 && v <= 5) score += v; }
  const scorePct = max > 0 ? Math.round((score / max) * 1000) / 10 : 0;
  return { score, maxScore: max, scorePct };
}

export function serviceTypeLabel(key: string | null): string {
  return SERVICE_TYPES.find((s) => s.key === key)?.label ?? key ?? "—";
}

export async function listAudits(branch?: string) {
  return prisma.branchAudit.findMany({
    where: branch ? { branch } : undefined,
    orderBy: [{ year: "desc" }, { quarter: "desc" }],
    include: { followUps: true, rideAlongs: { select: { id: true } } },
  });
}

export async function auditDetail(id: string) {
  return prisma.branchAudit.findUnique({
    where: { id },
    include: { rideAlongs: true, followUps: { orderBy: { createdAt: "asc" } } },
  });
}

export async function openFollowUps(branch?: string) {
  return prisma.auditFollowUp.findMany({
    where: { status: "open", ...(branch ? { branch } : {}) },
    orderBy: [{ dueDate: "asc" }],
    include: { audit: { select: { year: true, quarter: true, branch: true } } },
  });
}
