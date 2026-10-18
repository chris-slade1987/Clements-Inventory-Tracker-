// Maps a URL path to one Access Rights catalog item id, so a single guard (the
// (app) layout) and the nav can honor the saved grants. Pure + dependency-free
// so both server and client import it.
//
// SAFETY: anything not matched here returns null and is NEVER blocked (fail
// open). Self-guarded super-admin pages (Access Rights, Data Connections, Copilot
// Insights, Users & Access, Email Log) are intentionally left unmapped so their own
// guards decide — they gate on canManageAccessRights (Chris, Julie, April), who are
// NOT all role=admin, so a strict grant-mapped block in the (app) layout would lock
// the senior/HR super-admins out before their page guard runs. Catalog items:
// "connections" and "copilot-insights" under the Settings & Admin module
// (super-admin-only defaults), both unmapped for this reason.
// Keep the most specific prefixes first — first match wins.

const RULES: [RegExp, string][] = [
  // --- Self-service (everyone) ---
  [/^\/me\/sales(\/|$)/, "me-sales"],
  [/^\/me\/training(\/|$)/, "me-training"],
  [/^\/me\/hiring(\/|$)/, "me-hiring"],
  [/^\/me\/interviews(\/|$)/, "me-hiring"],
  [/^\/me\/pto(\/|$)/, "me-pto"],
  [/^\/me\/hr(\/|$)/, "me-hr"],
  [/^\/me\/profile(\/|$)/, "me-profile"],
  [/^\/me\/library(\/|$)/, "me-training"],
  [/^\/me(\/|$)/, "me"],
  [/^\/account(\/|$)/, "account"],
  [/^\/bulletin(\/|$)/, "bulletin"],
  [/^\/inbox(\/|$)/, "inbox"],
  [/^\/help(\/|$)/, "help"],
  [/^\/groundwork(\/|$)/, "groundwork"],

  // --- My Branch ---
  [/^\/my-branch\/team(\/|$)/, "team"],
  [/^\/my-branch\/inspections(\/|$)/, "inspections"],
  [/^\/my-branch\/warehouse(\/|$)/, "warehouse"],
  [/^\/my-branch\/qc(\/|$)/, "qc"],
  [/^\/my-branch\/documents(\/|$)/, "branch-hub"],
  [/^\/my-branch\/scorecard(\/|$)/, "scorecard"],
  [/^\/my-branch\/training(\/|$)/, "branch-training"],
  [/^\/my-branch\/pto(\/|$)/, "branch-pto"],
  [/^\/my-branch(\/|$)/, "my-branch"],
  [/^\/checklists\/oversight(\/|$)/, "checklist-oversight"],
  [/^\/checklists(\/|$)/, "checklists"],
  [/^\/sops\/library(\/|$)/, "sop-library"],
  [/^\/sops(\/|$)/, "sops"],

  // --- Inventory ---
  [/^\/dashboard(\/|$)/, "dashboard"],
  [/^\/check-in(\/|$)/, "check-in"],
  [/^\/check-out(\/|$)/, "check-out"],
  [/^\/inventory\/stock-count(\/|$)/, "stock-count"],
  [/^\/inventory\/stock(\/|$)/, "stock"],
  [/^\/inventory\/history(\/|$)/, "history"],
  [/^\/inventory\/catalog(\/|$)/, "catalog"],
  [/^\/inventory\/labels(\/|$)/, "labels"],
  [/^\/inventory\/checkout(\/|$)/, "check-out"],
  [/^\/reconcile(\/|$)/, "reconcile"],
  [/^\/reports(\/|$)/, "reports"],
  [/^\/alerts(\/|$)/, "alerts"],

  // --- Fleet ---
  [/^\/fleet\/assignments(\/|$)/, "fleet-assign"],
  [/^\/fleet\/fuel(\/|$)/, "fleet-fuel"],
  [/^\/fleet\/service(\/|$)/, "fleet-service"],
  [/^\/fleet\/retired(\/|$)/, "fleet-retired"],
  [/^\/fleet\/[^/]+\/inspect(\/|$)/, "fleet-inspect"],
  [/^\/fleet\/[^/]+(\/|$)/, "fleet-detail"],
  [/^\/fleet(\/|$)/, "fleet"],

  // --- People / HR (HR grants cover all of these) ---
  [/^\/hr(\/|$)/, "hr-home"],
  [/^\/management\/people\/pto(\/|$)/, "pto-calendar"],
  [/^\/management\/people\/callouts(\/|$)/, "callouts"],
  [/^\/management\/people\/reviews(\/|$)/, "reviews"],
  [/^\/management\/people\/jobs(\/|$)/, "hiring"],
  [/^\/management\/people\/candidates(\/|$)/, "candidates"],
  [/^\/management\/people\/hiring-templates(\/|$)/, "hiring-templates"],
  [/^\/management\/people\/prehires(\/|$)/, "prehires"],
  [/^\/management\/people\/excluded(\/|$)/, "candidates"],
  [/^\/management\/people\/inactive(\/|$)/, "former"],
  [/^\/management\/people\/org(\/|$)/, "org"],
  [/^\/management\/people\/handbook(\/|$)/, "handbook-acks"],
  [/^\/management\/people\/[^/]+$/, "people-profile"],
  [/^\/management\/people(\/|$)/, "people"],

  // --- Training Center ---
  [/^\/management\/training-center(\/|$)/, "training-assign"],
  [/^\/management\/training(\/|$)/, "training-courses"],
  [/^\/management\/certifications(\/|$)/, "certifications"],

  // --- Management & Executive ---
  [/^\/management\/board(\/|$)/, "board"],
  [/^\/management\/benchmarking(\/|$)/, "benchmarking"],
  [/^\/management\/insights(\/|$)/, "insights"],
  [/^\/management\/sales(\/|$)/, "sales-attrition"],
  [/^\/management\/scorecards(\/|$)/, "scorecards"],
  [/^\/management\/audits(\/|$)/, "audits"],
  [/^\/management\/compliance(\/|$)/, "compliance"],
  [/^\/management\/insurance(\/|$)/, "insurance"],
  [/^\/management\/documents(\/|$)/, "documents"],
  [/^\/management\/intake(\/|$)/, "documents"],
  [/^\/management\/system-map(\/|$)/, "system-map"],
  [/^\/management\/upload(\/|$)/, "upload-mbr"],
  [/^\/executive(\/|$)/, "executive"],
  [/^\/management(\/|$)/, "management"],
  [/^\/sales(\/|$)/, "sales-team"],
  [/^\/field-ops(\/|$)/, "field-ops"],

  // --- Catalog admin (/manage) — login/role admin pages left unmapped ---
  [/^\/manage\/products(\/|$)/, "products"],
  [/^\/manage\/inventory(\/|$)/, "stock-import"],
  [/^\/manage\/confirm(\/|$)/, "confirm"],
  [/^\/manage\/technicians(\/|$)/, "technicians"],
];

/** The catalog item id a path maps to, or null (never block null). */
export function matchPathToItem(path: string): string | null {
  if (!path) return null;
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  for (const [re, item] of RULES) if (re.test(p)) return item;
  return null;
}
