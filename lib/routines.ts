// Recurring routine checklist for technicians — the standing to-dos that repeat
// on a cadence (weekly truck cleaning, monthly CEU, etc.). This is the list the
// company extends over time; add entries here and they show on the tech landing
// page automatically. Completion tracking can be layered on later; for now these
// are standing reminders with a cadence badge.

export type Cadence = "daily" | "weekly" | "monthly" | "quarterly";

export type Routine = {
  key: string;
  label: string;
  cadence: Cadence;
  detail?: string;
  /** Optional link — e.g. the CEU routine points at the lesson library. */
  href?: string;
  /** Glyph name from components/Glyph. */
  icon: string;
};

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/**
 * Whether to show the technician Routine checklist to this person. These are
 * FIELD to-dos (truck cleaning, vehicle inspection, PPE check), so office, sales,
 * CSR, managers and admins should not see them. True for the technician access
 * level, or a login with no office-level access whose employee role/division
 * reads as field work.
 */
export function isFieldRoutineViewer(p: { accessLevel?: string | null; employeeRole?: string | null; division?: string | null }): boolean {
  if (p.accessLevel === "technician") return true;
  // Explicit office/leadership levels never see tech routines.
  if (p.accessLevel && ["super_admin", "admin", "manager", "sales", "sales_director", "csr"].includes(p.accessLevel)) return false;
  const role = (p.employeeRole ?? "").toLowerCase();
  if (/tech|applicator|field|fumigat|lawn|turf|\bpest\b/.test(role)) return true;
  const div = (p.division ?? "").toLowerCase();
  if (/lawn|turf|service|pest|termite|wdo|ornamental/.test(div)) return true;
  return false;
}

export const TECH_ROUTINES: Routine[] = [
  { key: "vehicle_cleaning", label: "Weekly vehicle cleaning", cadence: "weekly", detail: "Wash the exterior and clean out the cab & bed of your assigned truck.", icon: "truck" },
  { key: "monthly_ceu", label: "Monthly CEU course", cadence: "monthly", detail: "Complete this month's continuing-education lesson in your training.", href: "/me/library", icon: "cap" },
  { key: "vehicle_inspection", label: "Monthly vehicle inspection", cadence: "monthly", detail: "Walk-around inspection — tires, lights, fluids, equipment.", icon: "wrench" },
  { key: "equipment_check", label: "Equipment & PPE check", cadence: "weekly", detail: "Confirm sprayers, safety gear, and PPE are stocked and in good shape.", icon: "shield" },
  // Add more routine to-dos here as they're defined.
];
