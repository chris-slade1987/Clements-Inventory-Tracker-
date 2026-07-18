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

export const TECH_ROUTINES: Routine[] = [
  { key: "vehicle_cleaning", label: "Weekly vehicle cleaning", cadence: "weekly", detail: "Wash the exterior and clean out the cab & bed of your assigned truck.", icon: "truck" },
  { key: "monthly_ceu", label: "Monthly CEU course", cadence: "monthly", detail: "Complete this month's continuing-education lesson in your training.", href: "/me/library", icon: "cap" },
  { key: "vehicle_inspection", label: "Monthly vehicle inspection", cadence: "monthly", detail: "Walk-around inspection — tires, lights, fluids, equipment.", icon: "wrench" },
  { key: "equipment_check", label: "Equipment & PPE check", cadence: "weekly", detail: "Confirm sprayers, safety gear, and PPE are stocked and in good shape.", icon: "shield" },
  // Add more routine to-dos here as they're defined.
];
