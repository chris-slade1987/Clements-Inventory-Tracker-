// ---------------------------------------------------------------------------
// Access Rights catalog — the single source of truth for what the portal can
// gate. It lists every module and the sub-pages/tools under it, the access
// levels, and the DEFAULT grant each level has today. The Settings & Admin →
// Access Rights screen renders this, and `lib/access.ts` resolves a user's
// effective grants (level default, overlaid with any per-user override).
//
// IMPORTANT (see CLAUDE.md "Access Rights registry tracks the code"): whenever a
// route, page, or tool is added, renamed, merged, or removed, update MODULES and
// the affected levels' DEFAULT_GRANTS in the SAME change, so the admin screen
// always mirrors the real portal.
//
// Pure data + helpers only — safe to import from both server and client.
// ---------------------------------------------------------------------------

/** What a level/user may do with one item. `true` = access; view/edit = split.
 *  `false` appears ONLY in a per-user override, to explicitly remove access the
 *  level otherwise grants. Level defaults never store `false` (absence = no access). */
export type AccessValue = true | "view" | "edit";
export type Grants = Record<string, AccessValue | false>;

export type AccessLevel = { key: string; name: string; desc: string };
export type AccessItem = { id: string; name: string; ve?: boolean; note?: string };
export type AccessModule = { id: string; name: string; sub: string; items: AccessItem[] };

export const LEVELS: AccessLevel[] = [
  { key: "super_admin", name: "Super Admin", desc: "Full access to everything, including access rights and access-level editing. (Chris, Julie, April.)" },
  { key: "admin", name: "Admin (team-scoped)", desc: "Admin reach across the portal, but personnel limited to their own team; cannot edit access levels." },
  { key: "field_ops", name: "Field Ops Director", desc: "Full admin reach plus the Field Ops command center; cross-branch operational oversight." },
  { key: "manager", name: "Branch Manager", desc: "Their own branch only: dashboard, team, inspections, scorecard, checklists, and branch inventory/fleet." },
  { key: "senior", name: "Senior Leadership", desc: "Company executive views, compliance, and oversight; no day-to-day inventory or fleet operations." },
  { key: "hr", name: "HR", desc: "The full People/HR area, hiring, onboarding, reviews, PTO, and the certification program." },
  { key: "sales_director", name: "Sales Director", desc: "Admin-level reach for their domain: company + branch metrics, cross-branch sales team oversight and advisor goals, and the service advisors' profiles/logs." },
  { key: "service_advisor", name: "Service Advisor", desc: "Their own sales goal planner and self-service." },
  { key: "board", name: "Board Observer", desc: "Read-only executive views and the company bulletin. Nothing else." },
  { key: "employee", name: "Employee / Technician", desc: "Self-service only: their work, training, PTO, and the bulletin." },
];

export const MODULES: AccessModule[] = [
  { id: "mybranch", name: "My Branch", sub: "Branch operations", items: [
    { id: "my-branch", name: "Branch Dashboard" }, { id: "team", name: "My Team", ve: true }, { id: "inspections", name: "Vehicle Inspections" },
    { id: "warehouse", name: "Warehouse Inspection", ve: true }, { id: "qc", name: "Quality Control", ve: true }, { id: "branch-hub", name: "Branch Hub / Documents" },
    { id: "scorecard", name: "My Scorecard", ve: true, note: "Edit = sign" }, { id: "branch-training", name: "Team Training" }, { id: "branch-pto", name: "Branch PTO" },
    { id: "branch-command", name: "Branch Command", ve: true, note: "Weekly branch cockpit — fed scoreboard + AI forced-feedback + attested weekly sign-off. Edit = respond / sign." },
    { id: "routing-approval", name: "Routing Approval", ve: true, note: "Monthly routing review — map + per-tech sign-off + AI optimize/change-set. Edit = approve / sign. Upload is admin-only." },
    { id: "checklists", name: "Checklists", ve: true }, { id: "sops", name: "SOP Runner", ve: true, note: "Edit = run / sign" },
    { id: "weather", name: "Weather Ops", note: "Forecast → routing/service impact: current + risk + AI ops briefing + 5-day + radar. Managers see their territory; admins all. Read-only page (config is weather-settings)." } ] },
  { id: "inventory", name: "Inventory", sub: "Stock & movements", items: [
    { id: "dashboard", name: "Inventory Dashboard" }, { id: "check-in", name: "Check-In" }, { id: "check-out", name: "Check-Out" }, { id: "stock", name: "Stock" },
    { id: "stock-count", name: "Stock Count" }, { id: "history", name: "History" }, { id: "reconcile", name: "Reconcile" }, { id: "reports", name: "Reports" }, { id: "alerts", name: "Alerts" },
    { id: "photo-catalog", name: "Photo Catalog", note: "Capture + match product label photos (human-in-the-loop); managers + admins" },
    { id: "product-profile", name: "Product Profile (read-only)", note: "Read-only product detail view at /manage/products/[id] — photo, fields, linked barcodes, on-hand & movements. Any inventory viewer (managers + admins); editing stays super-admin on the Edit screen (the `products` item)." },
    { id: "catalog", name: "Catalog" }, { id: "labels", name: "Labels" } ] },
  { id: "catadmin", name: "Catalog & Inventory Admin", sub: "The /manage area", items: [
    { id: "products", name: "Products", note: "Catalog add/edit/deactivate + per-product photos — super-admin-only (Chris, Julie, April)" },
    { id: "stock-import", name: "Stock Import", note: "Bulk product/stock import — super-admin-only" },
    { id: "confirm", name: "Catalog Review", note: "Duplicates + off-catalog + new-product confirm queue — super-admin-only" },
    { id: "product-requests", name: "Product Requests", note: "New-product approval queue — super-admin-only (Chris, Julie, April); self-guarded with isSuperAdmin" },
    { id: "scan-intel", name: "Scan Intelligence", note: "Check-out AI photo-identify accuracy log + 'turn good scans into reference photos' queue — super-admin-only (Chris, Julie, April); self-guarded with isSuperAdmin" },
    { id: "technicians", name: "Technicians" } ] },
  { id: "fleet", name: "Fleet", sub: "Vehicles & fuel", items: [
    { id: "fleet", name: "Fleet Overview" }, { id: "fleet-detail", name: "Vehicle Detail" }, { id: "fleet-inspect", name: "Inspect Vehicle" },
    { id: "fleet-assign", name: "Driver Assignments" }, { id: "fleet-fuel", name: "Fuel" }, { id: "fleet-service", name: "Log Service" }, { id: "fleet-retired", name: "Retired Vehicles" } ] },
  { id: "mgmt", name: "Management & Executive", sub: "Company-wide", items: [
    { id: "management", name: "Company KPIs (operational)", ve: true }, { id: "executive", name: "Executive (financials / P&L)", ve: true }, { id: "board", name: "Board / Executive", ve: true }, { id: "insights", name: "Insights (AI)" },
    { id: "sales-attrition", name: "Sales & Attrition", ve: true }, { id: "sales-team", name: "Sales Team", ve: true }, { id: "scorecards", name: "Scorecards", ve: true, note: "Edit = score / finalize" },
    { id: "benchmarking", name: "Branch Benchmarking", note: "Read-only cross-branch league table + pacing" },
    { id: "audits", name: "Branch Audits", ve: true }, { id: "compliance", name: "Compliance", ve: true }, { id: "insurance", name: "Insurance", ve: true },
    { id: "documents", name: "Documents", ve: true }, { id: "system-map", name: "System Map" }, { id: "login-audit", name: "Login Audit" }, { id: "upload-mbr", name: "Upload MBR" },
    { id: "checklist-oversight", name: "Checklist Oversight" }, { id: "branch-command-oversight", name: "Branch Command Oversight", note: "Cross-branch weekly scoreboard rollup (Phase 4)" }, { id: "routing-oversight", name: "Routing Oversight", note: "Cross-branch monthly routing sign-off rollup (Phase 4)" }, { id: "field-ops", name: "Field Ops Center" }, { id: "sop-library", name: "SOP Library", ve: true, note: "Edit = publish / assign" } ] },
  { id: "people", name: "People / HR", sub: "Personnel & hiring", items: [
    { id: "hr-home", name: "HR Command Center" }, { id: "people", name: "People Roster", ve: true }, { id: "people-profile", name: "Employee Profile", ve: true },
    { id: "pto-calendar", name: "PTO Calendar" }, { id: "callouts", name: "Call-outs" }, { id: "reviews", name: "New-hire Reviews" }, { id: "hiring", name: "Hiring / ATS" },
    { id: "candidates", name: "Candidates" }, { id: "hiring-templates", name: "Hiring Templates" }, { id: "prehires", name: "Pre-hires" }, { id: "former", name: "Former Employees" },
    { id: "org", name: "Org Chart" }, { id: "handbook-acks", name: "Handbook Acknowledgments" } ] },
  { id: "training", name: "Training Center", sub: "Courses & certifications", items: [
    { id: "training-courses", name: "Course Authoring" }, { id: "training-assign", name: "Assign Training" }, { id: "training-record", name: "Employee Cert Record", ve: true, note: "Edit = mark complete" },
    { id: "training-reports", name: "Training Reports" }, { id: "certifications", name: "Certifications Catalog", ve: true } ] },
  { id: "settings", name: "Settings & Admin", sub: "Super-admin tools", items: [
    { id: "access-rights", name: "Access Rights" }, { id: "connections", name: "Data Connections" }, { id: "copilot-insights", name: "Copilot Insights", note: "Read-only Copilot usage + knowledge-gaps report; self-guarded (super admins)" }, { id: "weather-settings", name: "Weather Settings", note: "Admin-only — Weather Ops rule thresholds, forecast locations, and the fertilizer blackout calendar. Page self-guards with requireAdmin." }, { id: "users", name: "Users & Access" }, { id: "email-log", name: "Email Log" }, { id: "sys-settings", name: "System Settings" } ] },
  { id: "self", name: "Self-service", sub: "Available to the signed-in person", items: [
    { id: "me", name: "Employee Hub" }, { id: "me-profile", name: "My Profile" }, { id: "me-hr", name: "HR & Support" }, { id: "me-training", name: "My Training" }, { id: "me-sales", name: "My Sales Goals" }, { id: "me-pto", name: "My PTO" },
    { id: "me-hiring", name: "My Hiring" }, { id: "account", name: "Account" }, { id: "bulletin", name: "Company Bulletin" }, { id: "inbox", name: "Inbox" }, { id: "help", name: "Help" },
    { id: "groundwork", name: "Groundwork", note: "Universal work home: My Work (To-Dos + follow-ups), Huddles, The Greenhouse, Projects. Assigning to others is role-scoped server-side." },
    { id: "org-chart", name: "Org Chart (company)", note: "Universal company-readable reporting chart + directory search (/org); cards are read-only for field TECHNICIANS, and every other staff member may expand + edit a card's info (route, approved services, corporate role / who-to-go-to, scheduling) company-wide — enforced server-side in updateTileFields. SUPER ADMINS (Chris/Julie/April) additionally get an 'Edit structure' mode to reassign a person's supervisor (POST /api/org/reports-to, gated by canManageAccessRights, cycle-guarded) which updates their profile + team. Distinct from the HR-console Org Chart item." },
    { id: "ask-canopy", name: "Ask Canopy (Copilot)", note: "Universal docked assistant; answers are access-scoped server-side" },
    { id: "uniforms", name: "Uniform Guidelines", note: "Universal: the approved customer-facing uniform standard per field role (/uniforms). A viewer's own role is called out; referenced from onboarding." } ] },
];

export const ALL_ITEMS: AccessItem[] = MODULES.flatMap((m) => m.items);
export const ITEM_IDS: string[] = ALL_ITEMS.map((i) => i.id);
const VE_IDS = new Set(ALL_ITEMS.filter((i) => i.ve).map((i) => i.id));
export const isVeItem = (id: string): boolean => VE_IDS.has(id);

/** A level with access to everything (ve items at "edit"), minus any exceptions. */
function allAccess(except: string[] = []): Grants {
  const g: Grants = {};
  for (const i of ALL_ITEMS) {
    if (except.includes(i.id)) continue;
    g[i.id] = i.ve ? "edit" : true;
  }
  return g;
}

const SELF_BASIC: Grants = { me: true, "me-profile": true, "me-hr": true, "me-training": true, "me-pto": true, account: true, bulletin: true, inbox: true, help: true, groundwork: true, "org-chart": true, "ask-canopy": true, uniforms: true };

/** Each level's access AS IT IS TODAY — the pre-checked state on the admin screen. */
export const DEFAULT_GRANTS: Record<string, Grants> = {
  super_admin: allAccess(),
  // Data Connections and Copilot Insights (like Access Rights) are super-admin-only
  // surfaces; exclude them from the team-scoped admin's otherwise-full reach. The
  // pages self-guard with canManageAccessRights (Chris, Julie, April). Catalog
  // editing (products, stock-import, confirm/Catalog Review, product-requests) is
  // ALSO super-admin-only now — excluded here and self-guarded with isSuperAdmin.
  admin: allAccess(["access-rights", "connections", "copilot-insights", "product-requests", "products", "stock-import", "confirm", "scan-intel"]),
  field_ops: allAccess(["connections", "copilot-insights", "product-requests", "products", "stock-import", "confirm", "scan-intel"]),
  manager: {
    "my-branch": true, team: "edit", inspections: true, warehouse: "edit", qc: "edit", "branch-hub": true,
    scorecard: "edit", "branch-training": true, "branch-pto": true, "branch-command": "edit", "routing-approval": "edit", checklists: "edit", sops: "edit",
    dashboard: true, "check-in": true, "check-out": true, stock: true, "stock-count": true, history: true, reconcile: true, reports: true, "photo-catalog": true, "product-profile": true,
    fleet: true, "fleet-detail": true, "fleet-inspect": true, "fleet-assign": true, "fleet-fuel": true, "fleet-retired": true,
    management: "view", scorecards: "view", audits: "view", people: "view", "sales-team": "view", weather: true, ...SELF_BASIC,
  },
  senior: {
    board: "view", management: "view", executive: "view", benchmarking: true, insights: true, "sales-attrition": "view", compliance: "view", "system-map": true,
    "checklist-oversight": true, "branch-command-oversight": true, "routing-oversight": true, scorecards: "view", audits: "view", insurance: "view", documents: "view", "field-ops": true,
    "sop-library": "edit", sops: "view", weather: true,
    people: "view", org: true, ...SELF_BASIC,
  },
  hr: {
    "hr-home": true, people: "edit", "people-profile": "edit", "pto-calendar": true, callouts: true, reviews: true, hiring: true,
    candidates: true, "hiring-templates": true, prehires: true, former: true, org: true, "handbook-acks": true,
    // Catalog Review ("confirm") was removed from HR — catalog editing is now
    // super-admin-only.
    "training-assign": true, "training-record": "edit", "training-reports": true, certifications: "view",
    insurance: "view", documents: "view", ...SELF_BASIC,
  },
  // Admin-level reach for the sales domain (COO decision, Oct 2026): the Sales
  // Director oversees the sales team AND sees company + branch performance
  // metrics, plus the service advisors' profiles/logs (roster scoped to advisors
  // in `visibleEmployeeIds`; they still report to branch managers in the org
  // chart, who own day-to-day call-out/write-up/accident logging).
  sales_director: {
    "sales-team": "edit", "sales-attrition": "view", management: "view",
    people: "view", "people-profile": "edit", ...SELF_BASIC,
  },
  service_advisor: { "me-sales": "edit", ...SELF_BASIC },
  board: { board: "view", management: "view", executive: "view", benchmarking: true, "sales-attrition": "view", compliance: "view", bulletin: true, account: true, groundwork: true, "org-chart": true, "ask-canopy": true },
  employee: { ...SELF_BASIC },
};

/** True if these grants allow at least viewing the item. */
export function hasAccess(grants: Grants, itemId: string): boolean {
  return !!grants[itemId];
}
/** True if these grants allow editing (for a view/edit item). Non-ve items: access == edit. */
export function hasEdit(grants: Grants, itemId: string): boolean {
  const v = grants[itemId];
  if (!v) return false;
  return isVeItem(itemId) ? v === "edit" : true;
}

/** Normalize an unknown stored object into a clean Grants map over known items. */
export function sanitizeGrants(raw: unknown): Grants {
  const out: Grants = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ITEM_IDS.includes(k)) continue;
    if (v === true) out[k] = true;
    else if (v === false) out[k] = false;
    else if (v === "view" || v === "edit") out[k] = v;
  }
  return out;
}
