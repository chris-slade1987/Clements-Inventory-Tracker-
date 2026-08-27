// Assignable user access levels (the "levels" from the Access Rights board).
// Client-safe: constants only, no server imports.

export type AccessLevelKey = "super_admin" | "admin" | "manager" | "technician" | "csr" | "sales" | "sales_director";

export const ACCESS_LEVELS: { key: AccessLevelKey; label: string; blurb: string }[] = [
  { key: "super_admin", label: "Super Admin", blurb: "See & edit everything, all branches & employees." },
  { key: "admin", label: "Admin", blurb: "Admin reach, but personnel profiles limited to their team." },
  { key: "manager", label: "Manager", blurb: "Their branch only + read-only company KPIs." },
  { key: "sales_director", label: "Sales Director", blurb: "Oversees service advisors & sales goals across all branches." },
  { key: "technician", label: "Technician", blurb: "Personal profile, training, tech dashboard." },
  { key: "csr", label: "CSR", blurb: "Customer service (scope TBD)." },
  { key: "sales", label: "Service Advisor", blurb: "Own sales dashboard, monthly goal planner, targets vs actual." },
];

export const ACCESS_LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  ACCESS_LEVELS.map((l) => [l.key, l.label]),
);

// The `role` each level maps to (keeps the existing role-based gates working:
// super_admin & admin both get admin reach; admin is narrowed by the People
// team-wall; managers are branch-locked; the rest are plain employees).
export const LEVEL_ROLE: Record<AccessLevelKey, string> = {
  super_admin: "admin",
  admin: "admin",
  manager: "manager",
  sales_director: "manager", // a leader (not branch-locked): cross-branch read + sales oversight
  technician: "employee",
  csr: "employee",
  sales: "employee",
};

export function accessLevelLabel(level: string | null | undefined): string {
  return level ? ACCESS_LEVEL_LABEL[level] ?? level : "—";
}
