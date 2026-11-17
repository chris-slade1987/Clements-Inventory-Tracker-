// ---------------------------------------------------------------------------
// Check-Out roster — people who must ALWAYS be on the technician list.
//
// Pure data + helpers (no `server-only`): imported by the runtime roster healer
// (lib/technician-roster-ensure.ts) AND by the deploy-time terminated-employee
// reconcile (lib/separation.ts, run from scripts/deploy-db.ts), so the deploy
// step can never switch these people off again.
//
// Why this exists (COO 2026-11-13 / 2026-11-17): Jason (Vero) could not check
// product out to Brian Lasneski (PestPac "28 BRIAN L"). The 11/13 roster fix put
// him on the list once, but every deploy's reconcile — "deactivate any technician
// whose name matches an inactive employee profile" — switched him back off,
// because a former-employee profile shares his name. Entries here are matched on
// name AND route number, so they can never land on the wrong person.
// ---------------------------------------------------------------------------

export type KeepTechnician = { name: string; techNumber: string; branch: "vero" | "stuart" | "orlando" | "naples"; note: string };

export const KEEP_TECHNICIANS: KeepTechnician[] = [
  {
    name: "Brian Lasneski",
    techNumber: "28",
    branch: "vero",
    note: "COO 2026-11-13, re-confirmed 2026-11-17: Jason (Vero) must be able to check product out to 28 BRIAN L",
  },
];

export function normPersonName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}

/** Normalized names that must never be auto-deactivated on the Check-Out roster. */
export function keepTechnicianNames(): Set<string> {
  return new Set(KEEP_TECHNICIANS.map((k) => normPersonName(k.name)));
}
