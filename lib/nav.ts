// Central navigation config used by both the desktop sidebar and the mobile
// bottom bar. Icons are inline SVG path data (single-color, currentColor).

import { matchPathToItem } from "@/lib/access-paths";

export type NavItem = {
  href: string;
  label: string;
  /** Short label for the cramped mobile bottom bar. */
  shortLabel: string;
  /** SVG path(s) drawn inside a 24x24 viewBox. */
  icon: string;
};

// Two operating modes. The nav shows one group at a time; a toggle in the
// shell switches between them.
export type Mode = "employee" | "manager" | "inventory" | "management" | "fleet";

// Compliance Command Center — senior-leadership only. Lives inside the
// management nav, but is also surfaced on its own for employee-shell senior
// leaders (Julie, April) who otherwise never see the management area.
export const COMPLIANCE_NAV_ITEM: NavItem = {
  href: "/management/compliance",
  label: "Compliance",
  shortLabel: "Comply",
  icon: "M9 12l2 2 4-4m-2-6l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z",
};

// System Map — the auto-generated workflow/interconnection map, senior-leadership
// only (redirects others). A connected-nodes glyph. Gated in AppShell alongside
// Compliance so plain managers don't see a link that just bounces them.
export const SYSTEM_MAP_NAV_ITEM: NavItem = {
  href: "/management/system-map",
  label: "System Map",
  shortLabel: "SysMap",
  icon: "M5 6.5a2 2 0 114 0 2 2 0 01-4 0zm10 11a2 2 0 114 0 2 2 0 01-4 0zM7 8.5v3a2 2 0 002 2h4a2 2 0 012 2v.5M15 6.5h2a2 2 0 012 2v2",
};

// Insights assistant — conversational, grounded management Q&A. Exec-sensitive
// financials, so only admins + senior leadership reach the page (it redirects
// others). A chat-bubble/spark glyph, distinct from the other management icons.
export const INSIGHTS_NAV_ITEM: NavItem = {
  href: "/management/insights",
  label: "Insights",
  shortLabel: "Insights",
  icon: "M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5zM12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1L9 10.5l2.1-.9z",
};

// Sales Team hub — cross-branch service-advisor oversight + monthly goals.
// Surfaced for admins/super-admins (in the management nav) and the Sales
// Director (their fixed nav). A target/aim glyph.
export const SALES_TEAM_NAV_ITEM: NavItem = {
  href: "/sales",
  label: "Sales Team",
  shortLabel: "Sales Team",
  icon: "M12 8a4 4 0 100 8 4 4 0 000-8zm0-6v3m0 14v3m10-10h-3M5 12H2m15.5-6.5l-2 2m-9 9l-2 2m13 0l-2-2m-9-9l-2-2",
};

// Service-advisor self view — their monthly sales goal planner + dashboard.
export const MY_SALES_NAV_ITEM: NavItem = {
  href: "/me/sales",
  label: "My Sales Goals",
  shortLabel: "Sales",
  icon: "M3 17l6-6 4 4 8-8M21 7v5m0-5h-5",
};

// Pre-hire onboarding — surfaced for HR (admins + granted HR only), not in the
// general management nav.
export const PREHIRE_NAV_ITEM: NavItem = {
  href: "/management/people/prehires",
  label: "Pre-hires",
  shortLabel: "Pre-hires",
  icon: "M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h3M16 19l2 2 4-4",
};

// HR Command Center — the HR user's home: actionable queues + all HR areas.
// Surfaced first for HR grantees (and admins) on their shell nav.
export const HR_HOME_NAV_ITEM: NavItem = {
  href: "/hr",
  label: "HR Home",
  shortLabel: "HR",
  icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
};

// Field Ops Command Center — the Director of Field Operations' home: cross-branch
// audits, inspections, checklists, fleet & scorecards oversight.
export const FIELD_OPS_HOME_NAV_ITEM: NavItem = {
  href: "/field-ops",
  label: "Field Ops",
  shortLabel: "Field Ops",
  icon: "M9 12l2 2 4-4m-2-6l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z",
};

// Hiring / ATS — surfaced for HR (admins + granted HR), like PREHIRE. Jobs,
// candidates, interviews, and the pipeline through to onboarding.
export const HIRING_NAV_ITEM: NavItem = {
  href: "/management/people/jobs",
  label: "Hiring",
  shortLabel: "Hiring",
  icon: "M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h4M16 11l2 2 4-4M20 14v5a1 1 0 01-1 1h-4",
};

// My Hiring — for employees assigned an interview: the jobs they're involved in
// (read-only container access) plus their hiring results. A briefcase glyph,
// distinct from the HR "Hiring" (person) icon.
export const MY_HIRING_NAV_ITEM: NavItem = {
  href: "/me/hiring",
  label: "My Hiring",
  shortLabel: "Hiring",
  icon: "M4 7h16a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zM8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18",
};

// Company-wide PTO calendar — admins + HR only (everyone's approved time off).
// Surfaced like PREHIRE: not in the general management nav, but pushed onto the
// shell for anyone who canViewAllPto (admins reach it; April gets it too).
export const PTO_NAV_ITEM: NavItem = {
  href: "/management/people/pto",
  label: "PTO Calendar",
  shortLabel: "PTO",
  icon: "M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM9 14l2 2 4-4",
};

// Manager oversight checklists — the recurring weekly attested sign-offs.
// Surfaced in the My Branch (manager) nav for managers/admins.
export const CHECKLISTS_NAV_ITEM: NavItem = {
  href: "/checklists",
  label: "Checklists",
  shortLabel: "Checks",
  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2 2 2 0 01-2 2h-2a2 2 0 01-2-2zm-.5 9l2 2 4-4",
};

// SOP Runner — the generalized, guided Standard Operating Procedure runner
// (CanopyOS Theme 2). A My Branch (manager) responsibility like the oversight
// checklists; managers run their branch's assigned/on-demand SOPs. A play /
// run-through glyph, distinct from the checklist clipboard.
export const SOPS_NAV_ITEM: NavItem = {
  href: "/sops",
  label: "SOPs",
  shortLabel: "SOPs",
  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2 2 2 0 01-2 2h-2a2 2 0 01-2-2zm2 8l2 2 3-4",
};

// SOP Library — admin/leadership console to publish, version, and assign SOPs.
// Lives in the Management nav; the page self-guards (canManageSops). A stacked-
// documents / library glyph.
export const SOP_LIBRARY_NAV_ITEM: NavItem = {
  href: "/sops/library",
  label: "SOP Library",
  shortLabel: "SOPs",
  icon: "M4 6h12M4 10h12M4 14h8M18 14l3 3-3 3M4 18h8",
};

// Checklist oversight rollup — senior-leadership only (admins + senior
// leadership). Lives alongside the Compliance link.
export const CHECKLIST_OVERSIGHT_NAV_ITEM: NavItem = {
  href: "/checklists/oversight",
  label: "Checklist Oversight",
  shortLabel: "Oversight",
  icon: "M4 6h16M4 12h10M4 18h7M15 15l2 2 4-4",
};

// Resources / document center. Handbook is visible to every logged-in user;
// the Manager Operating Manual is manager/admin only. Rendered as a distinct
// "Resources" group in the shell (not tied to a single center).
export const HANDBOOK_NAV_ITEM: NavItem = {
  href: "/resources/handbook",
  label: "Employee Handbook",
  shortLabel: "Handbook",
  icon: "M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M9 13h6M9 17h6",
};

// Document Intake — the universal, agentic upload: drop any file, chat with
// Claude about what it is, and approve where it routes. Admin + manager; lives
// in the management nav next to the (vehicle) Document Center. An inbox/upload
// glyph, distinct from the folder-style Document Center icon.
export const INTAKE_NAV_ITEM: NavItem = {
  href: "/management/intake",
  label: "Document Intake",
  shortLabel: "Intake",
  icon: "M12 15V4M8 8l4-4 4 4M4 14v5a1 1 0 001 1h14a1 1 0 001-1v-5",
};

// Certifications — the read-only HR/admin console over the internal
// certification program (certifications, modules, prerequisites, pathways).
// Admins + HR + senior leadership only; gated in AppShell. An award/ribbon glyph.
export const CERTIFICATIONS_NAV_ITEM: NavItem = {
  href: "/management/certifications",
  label: "Certifications",
  shortLabel: "Certs",
  icon: "M12 15a5 5 0 100-10 5 5 0 000 10zm0 0l-3 6 3-1.5L15 21l-3-6m-2.1-4.4l1.4 1.4 2.8-2.8",
};

// Training Center — the HR/admin hub (Assign · Courses · Certifications ·
// Reports). Replaces the old "Training" link; the Certifications link now folds
// into this hub. Admins reach the Courses landing (requireAdmin); non-admin HR /
// senior-leadership grantees are routed to the Assign tab instead (see AppShell).
export const TRAINING_CENTER_NAV_ITEM: NavItem = {
  href: "/management/training",
  label: "Training Center",
  shortLabel: "Training",
  icon: "M12 4L2 9l10 5 8-4v6M6 12v5c0 1 3 2 6 2s6-1 6-2v-5",
};

export const MANUAL_NAV_ITEM: NavItem = {
  href: "/resources/manual",
  label: "Manager Manual",
  shortLabel: "Manual",
  icon: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V4H6.5A2.5 2.5 0 004 6.5v13zM9 8h7M9 12h7",
};

// Catalog administration — the former standalone "Manage" area, now owned by
// the Inventory center. One entry into the sub-area (Products, Stock Import,
// Confirm Queue, Technicians); href is /manage so it redirects each principal
// to their allowed landing (admin → Products, HR → Confirm Queue) and lights
// up on every /manage/* route. Admin + HR only — gated in AppShell.
export const CATALOG_ADMIN_NAV_ITEM: NavItem = {
  href: "/manage",
  label: "Catalog Admin",
  shortLabel: "Catalog",
  icon: "M20 7L12 3 4 7m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
};

// User & role administration — the former "Managers" tab. Login accounts,
// roles, active status, and branch assignment. Admin-only; surfaced as a
// de-emphasized settings link, never a prominent tab.
export const USERS_ACCESS_NAV_ITEM: NavItem = {
  href: "/manage/managers",
  label: "Users & Access",
  shortLabel: "Access",
  icon: "M12 2l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V5l7-3zM12 11a2 2 0 100-4 2 2 0 000 4zm-3.2 5a3.2 3.2 0 016.4 0",
};

// Access Rights — super-admin-only editor for each access level's default rights
// and per-user overrides. A shield/key glyph. Lives in the Settings & Admin
// footer links alongside Users & Access and Email Log.
export const ACCESS_RIGHTS_NAV_ITEM: NavItem = {
  href: "/settings/access-rights",
  label: "Access Rights",
  shortLabel: "Access Rights",
  icon: "M12 2l8 3v6c0 4-3 7.5-8 9-5-1.5-8-5-8-9V5z M9 12l2 2 4-4",
};

// Data Connections — super-admin-only, read-only health board for every external
// connector (SmarterLaunch, Coast, WorkWave/PestPac, Paychex): status, last sync,
// budget/quota, mode. Lives in the Settings & Admin footer links beside Access
// Rights and is gated the same way (canManageAccessRights: Chris, Julie, April).
// A linked-nodes / plug glyph, distinct from the Access Rights shield.
export const CONNECTIONS_NAV_ITEM: NavItem = {
  href: "/settings/connections",
  label: "Data Connections",
  shortLabel: "Connections",
  icon: "M9 15l6-6M8.5 10.5l-1.6 1.6a3 3 0 004.2 4.2l1.6-1.6m-1.4-7.4l1.6-1.6a3 3 0 014.2 4.2l-1.6 1.6",
};

// Copilot Insights — super-admin-only, read-only Copilot usage + knowledge-gaps
// report (Theme 5, Wave D). Lives in the Settings & Admin footer links beside
// Access Rights and Data Connections and is gated the same way
// (canManageAccessRights: Chris, Julie, April). A spark/insight glyph.
export const COPILOT_INSIGHTS_NAV_ITEM: NavItem = {
  href: "/settings/copilot",
  label: "Copilot Insights",
  shortLabel: "Copilot",
  icon: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5zM19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z",
};

// Email delivery log — admin-only audit of every outbound notification (sent /
// skipped / errored). Surfaced as a de-emphasized settings link in the shell
// footer, alongside Users & Access. An envelope-with-check glyph.
export const EMAIL_LOG_NAV_ITEM: NavItem = {
  href: "/management/email-log",
  label: "Email Log",
  shortLabel: "Email",
  icon: "M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zm0 1.5l8 5.5 8-5.5",
};

// Company-wide bulletin — lives in the Resources section of the shell (and in
// the board-observer's fixed nav, which has no Resources group).
export const BULLETIN_NAV_ITEM: NavItem = {
  href: "/bulletin",
  label: "Company Bulletin",
  shortLabel: "Bulletin",
  icon: "M3 10v4a1 1 0 001 1h3l6 4V5L7 9H4a1 1 0 00-1 1zM17 8a4 4 0 010 8",
};

// Groundwork — the universal work home shared by EVERY login regardless of access
// level (like the Employee Hub / Ask Canopy): My Work (To-Dos + follow-ups),
// Huddles, The Greenhouse (someday ideas), and Projects. Surfaced as its own
// top-bar button (see AppShell). A sprouting-seedling glyph — things that grow.
export const GROUNDWORK_NAV_ITEM: NavItem = {
  href: "/groundwork",
  label: "Groundwork",
  shortLabel: "Work",
  icon: "M12 22V12m0 0c0-2.8-2.2-5-5-5H4v1.5A4.5 4.5 0 008.5 13H12zm0-2c0-3 2.5-5.5 5.5-5.5H20v1A5 5 0 0115 10.5h-3",
};

// Org Chart — the universal Company reporting chart + directory, shared by EVERY
// login regardless of access level (like Groundwork / the Employee Hub). Surfaced
// as its own top-bar button (see AppShell). Read-only tiles + search for all;
// tile editing is role/branch-scoped server-side. A hierarchy/org-tree glyph.
export const ORG_CHART_NAV_ITEM: NavItem = {
  href: "/org",
  label: "Org Chart",
  shortLabel: "Org",
  icon: "M9 3h6v4H9z M4 17h6v4H4z M14 17h6v4h-6z M12 7v7 M7 14h10 M7 17v-3 M17 17v-3",
};

// Employee Hub — the self-service home shared by EVERY login regardless of
// access level. Surfaced as its own top-bar button (see AppShell) and as the
// employee shell's home nav. A person/badge glyph, distinct from the house.
export const EMPLOYEE_HUB_NAV_ITEM: NavItem = {
  href: "/me",
  label: "Employee Hub",
  shortLabel: "Hub",
  icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0",
};

// Employee Hub home nav — the self-service area: hub landing, profile, time off,
// HR, lesson library.
export const EMPLOYEE_NAV: NavItem[] = [
  EMPLOYEE_HUB_NAV_ITEM,
  {
    href: "/me/profile",
    label: "My Profile",
    shortLabel: "Profile",
    icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM6 20a6 6 0 0112 0",
  },
  {
    href: "/me/pto",
    label: "Time Off",
    shortLabel: "Time Off",
    icon: "M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM9 14l2 2 4-4",
  },
  {
    href: "/me/hr",
    label: "HR & Support",
    shortLabel: "HR",
    icon: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4",
  },
  {
    href: "/me/library",
    label: "Lesson Library",
    shortLabel: "Library",
    icon: "M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM8 7h6M8 11h8M8 15h8",
  },
];

// Branch-manager home: their operational dashboard — reminders, this month's
// inspections, and the responsibilities that feed their quarterly scorecard.
export const MANAGER_NAV: NavItem[] = [
  {
    href: "/my-branch",
    label: "My Dashboard",
    shortLabel: "Home",
    icon: "M3 12l9-9 9 9M5 10v10h14V10M9 21v-6h6v6",
  },
  {
    href: "/my-branch/team",
    label: "My Team",
    shortLabel: "Team",
    icon: "M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0zm14 13v-2a4 4 0 00-3-3.9",
  },
  {
    href: "/my-branch/inspections",
    label: "Vehicle Inspections",
    shortLabel: "Vehicles",
    icon: "M9 11l3 3 8-8M9 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  },
  {
    href: "/my-branch/warehouse",
    label: "Warehouse Inspection",
    shortLabel: "Warehouse",
    icon: "M3 21h18M4 21V8l8-4 8 4v13M9 21v-6h6v6M8 11h.01M16 11h.01",
  },
  {
    href: "/my-branch/qc",
    label: "Quality Control",
    shortLabel: "QC",
    icon: "M9 12l2 2 4-4m-2-6l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z",
  },
  {
    href: "/my-branch/documents",
    label: "Branch Hub",
    shortLabel: "Hub",
    icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 10h.01M15 10h.01M9 13h.01M15 13h.01",
  },
  {
    href: "/my-branch/scorecard",
    label: "Scorecard",
    shortLabel: "Score",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
  },
  CHECKLISTS_NAV_ITEM,
  SOPS_NAV_ITEM,
  // Sales Team lives in this center (My Branch for managers = "Company" for admins):
  // company-wide for admins/super admins, own-branch read-only for branch managers.
  SALES_TEAM_NAV_ITEM,
  // Document Center — company licensing / leases / vehicle docs. Lives in the
  // Company center (moved here from Executive). Still grant-gated via the
  // `documents` access key, so branch managers without it don't see the link.
  {
    href: "/management/documents",
    label: "Documents",
    shortLabel: "Docs",
    icon: "M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h6",
  },
];

export const INVENTORY_NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  },
  {
    href: "/check-in",
    label: "Check-In",
    shortLabel: "In",
    icon: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  },
  {
    // The single, consolidated Check-Out: the smart scan-to-issue flow (scan /
    // unknown-barcode linker / AI photo / shelf QR → cart → signature → submit →
    // 15-min undo + history), with over-on-hand escalation. The separate "Scan
    // Checkout" screen was retired and now redirects here.
    href: "/check-out",
    label: "Check-Out",
    shortLabel: "Out",
    icon: "M12 21V9m0 0l-4 4m4-4l4 4M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2",
  },
  {
    href: "/reconcile",
    label: "Reconcile",
    shortLabel: "Fix",
    icon: "M4 4v6h6M20 20v-6h-6M20 8a8 8 0 00-14.9-2M4 16a8 8 0 0014.9 2",
  },
  {
    href: "/reports",
    label: "Reports",
    shortLabel: "Reports",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
  },
  {
    href: "/alerts",
    label: "Alerts",
    shortLabel: "Alerts",
    icon: "M12 3a6 6 0 00-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 00-6-6zM10.5 20a2 2 0 003 0",
  },
];

// Branch Benchmarking — cross-branch league table + first-slice forecasting
// (CanopyOS Theme 10). Exec-sensitive cross-branch comparison, gated the same as
// the Executive operating view (admins / senior leadership / board). A bar-ladder
// glyph, distinct from the exec bar-chart icon.
export const BENCHMARKING_NAV_ITEM: NavItem = {
  href: "/management/benchmarking",
  label: "Branch Benchmarking",
  shortLabel: "Bench",
  icon: "M4 20h16M7 20v-6M12 20V8M17 20v-9M5.5 11l4-4 3 2 5-5",
};

export const MANAGEMENT_NAV: NavItem[] = [
  {
    href: "/management/board",
    label: "Board — Financial statements",
    shortLabel: "Board",
    icon: "M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6",
  },
  INSIGHTS_NAV_ITEM,
  {
    href: "/executive",
    label: "Executive — Operating",
    shortLabel: "Exec",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
  },
  BENCHMARKING_NAV_ITEM,
  {
    href: "/management/sales",
    label: "Sales & Attrition",
    shortLabel: "Sales",
    icon: "M3 17l6-6 4 4 8-8M21 7v5m0-5h-5",
  },
  // NOTE: the Sales Team hub (SALES_TEAM_NAV_ITEM) now lives in the My Branch /
  // Company center (MANAGER_NAV), not here under Executive — see that array.
  {
    href: "/management/scorecards",
    label: "Scorecards",
    shortLabel: "Scores",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  },
  {
    href: "/management/audits",
    label: "Branch Audits",
    shortLabel: "Audits",
    icon: "M9 11l3 3 8-8M20 4v7m0 0h-7M4 20h6M4 16h10M4 12h4",
  },
  TRAINING_CENTER_NAV_ITEM,
  {
    href: "/management/people",
    label: "People / HR",
    shortLabel: "People",
    icon: "M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0zm14 13v-2a4 4 0 00-3-3.9",
  },
  // NOTE: the Document Center (DOCUMENTS_NAV_ITEM) now lives in the My Branch /
  // Company center (MANAGER_NAV), not here under Executive — see that array.
  {
    href: "/management/insurance",
    label: "Insurance",
    shortLabel: "Insure",
    icon: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3zM9 12l2 2 4-4",
  },
  SYSTEM_MAP_NAV_ITEM,
  COMPLIANCE_NAV_ITEM,
  CHECKLIST_OVERSIGHT_NAV_ITEM,
  SOP_LIBRARY_NAV_ITEM,
];

// Sales Director — a focused principal who oversees service advisors and their
// monthly goals across all branches. Fixed nav (no center switcher): the Sales
// Team hub plus the read-only Sales & Attrition analytics.
export const SALES_DIRECTOR_NAV: NavItem[] = [
  SALES_TEAM_NAV_ITEM,
  {
    href: "/management/sales",
    label: "Sales & Attrition",
    shortLabel: "Analytics",
    icon: "M3 17l6-6 4 4 8-8M21 7v5m0-5h-5",
  },
  // Company KPIs (operational: revenue · sales · cancels · expenses), company-wide.
  {
    href: "/management",
    label: "Company KPIs",
    shortLabel: "KPIs",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
  },
  // The service advisors' profiles + logs (scoped to advisors in visibleEmployeeIds).
  {
    href: "/management/people",
    label: "Service Advisors",
    shortLabel: "Advisors",
    icon: "M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0zm14 13v-2a4 4 0 00-3-3.9",
  },
];

// Board Observer — a distinct, strictly read-only principal (board members who
// log in after the board meeting). They see ONLY the executive views: Board /
// Executive, Management, Sales & Attrition, Compliance, and the company
// bulletin — never inventory, fleet, my-branch, HR, scorecards, or manage.
export const BOARD_OBSERVER_NAV: NavItem[] = [
  {
    href: "/management/board",
    label: "Board — Financial statements",
    shortLabel: "Board",
    icon: "M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6",
  },
  {
    href: "/executive",
    label: "Executive — Operating",
    shortLabel: "Exec",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
  },
  {
    href: "/management/sales",
    label: "Sales & Attrition",
    shortLabel: "Sales",
    icon: "M3 17l6-6 4 4 8-8M21 7v5m0-5h-5",
  },
  COMPLIANCE_NAV_ITEM,
  BULLETIN_NAV_ITEM,
];

export const FLEET_NAV: NavItem[] = [
  {
    href: "/fleet",
    label: "Fleet Overview",
    shortLabel: "Fleet",
    icon: "M3 13l2-5h11l3 5M5 13h14v4H5zM7 17a2 2 0 104 0 2 2 0 00-4 0zm8 0a2 2 0 104 0 2 2 0 00-4 0z",
  },
  {
    href: "/fleet/service",
    label: "Log Service",
    shortLabel: "Service",
    icon: "M14.7 6.3a4 4 0 01-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 015.4-5.4l-2.6 2.6-2-2 2.6-2.6z",
  },
  {
    href: "/fleet/fuel",
    label: "Fuel",
    shortLabel: "Fuel",
    icon: "M14 20V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14m0 0h10M4 20H3m11-9h2.5a1.5 1.5 0 011.5 1.5V16a1.5 1.5 0 003 0V8l-3-3M7 8h4",
  },
];

// ---- Shared nav assembly ------------------------------------------------- //
// The SINGLE source of truth for which pages a principal sees in a given center.
// Both the active shell nav AND the desktop launcher's per-center preview call
// `buildNavForMode`, so the two can never drift (previously AppShell had a second
// `itemsForMode` that duplicated — and could diverge from — the main derivation).

/** The viewer's flags, lifted from the (app) layout. All optional so a partial
 *  principal (e.g. a quick preview) still resolves. */
export type NavPrincipal = {
  isAdmin?: boolean;
  isEmployee?: boolean;
  isSeniorLeadership?: boolean;
  isHrAccess?: boolean;
  isInterviewer?: boolean;
  isBoardObserver?: boolean;
  isSalesDirector?: boolean;
  isServiceAdvisor?: boolean;
  isFieldOpsDirector?: boolean;
  /** Saved Access-Rights grant keys; empty disables nav filtering (fail-open). */
  grantedKeys?: string[];
};

/**
 * The viewer's HOME center — used as the mode fallback for "homeless" shared
 * routes (`/inbox`, `/account`, `/help`) so an employee never falls through to
 * the empty Inventory nav. Mirrors `homePath` in lib/auth: employees → their
 * self-service hub, admins → the Inventory dashboard, branch managers → My Branch.
 * (Board observers / the Sales Director have a fixed nav, so mode is cosmetic.)
 */
export function homeMode(p: NavPrincipal): Mode {
  if (p.isEmployee) return "employee";
  if (p.isAdmin) return "inventory";
  return "manager";
}

/**
 * Build the nav item list for ANY center for a given principal, applying every
 * gate and insertion exactly once. Board observers and the Sales Director have a
 * fixed nav on every route; everyone else gets the per-mode list (with granted
 * management links folded onto an employee home, the Field Ops / My Hiring /
 * Catalog Admin / My Sales insertions, and the compliance / certifications /
 * saved-grant filters). This is what both the shell and the launcher render.
 */
export function buildNavForMode(mode: Mode, p: NavPrincipal): NavItem[] {
  const isAdmin = !!p.isAdmin;
  const grantedKeys = p.grantedKeys ?? [];
  const enforceNav = !isAdmin && grantedKeys.length > 0;
  const navAllowed = (href: string) => {
    if (!enforceNav) return true;
    const k = matchPathToItem(href);
    return !k || grantedKeys.includes(k);
  };

  // Fixed-nav principals: the same minimal nav on every route, never a center's.
  if (p.isBoardObserver) return BOARD_OBSERVER_NAV.filter((i) => navAllowed(i.href));
  if (p.isSalesDirector) return SALES_DIRECTOR_NAV.filter((i) => navAllowed(i.href));

  const canViewCompliance = isAdmin || !!p.isSeniorLeadership;
  const canViewCertifications = isAdmin || !!p.isHrAccess || !!p.isSeniorLeadership;
  const canManageAts = isAdmin || !!p.isHrAccess;
  const canManagePreHire = isAdmin || !!p.isHrAccess;
  const canViewAllPto = isAdmin || !!p.isHrAccess;

  // Granted management links an employee-shell grantee carries onto their home.
  const grantedMgmt: NavItem[] = [];
  if (p.isHrAccess) grantedMgmt.push(HR_HOME_NAV_ITEM);
  if (canViewCompliance) grantedMgmt.push(COMPLIANCE_NAV_ITEM);
  if (canViewCompliance) grantedMgmt.push(CHECKLIST_OVERSIGHT_NAV_ITEM);
  if (canViewCertifications)
    grantedMgmt.push(
      isAdmin ? TRAINING_CENTER_NAV_ITEM : { ...TRAINING_CENTER_NAV_ITEM, href: "/management/training-center/assign" },
    );
  if (canManageAts) grantedMgmt.push(HIRING_NAV_ITEM);
  if (canManagePreHire) grantedMgmt.push(PREHIRE_NAV_ITEM);
  if (canViewAllPto) grantedMgmt.push(PTO_NAV_ITEM);

  const showMyHiring = !!p.isInterviewer && !canManageAts;
  const homeExtras: NavItem[] = [...grantedMgmt, ...(showMyHiring ? [MY_HIRING_NAV_ITEM] : [])].filter((i) =>
    navAllowed(i.href),
  );
  const privilegedEmployee = !!p.isEmployee && homeExtras.length > 0;

  const rawItems =
    mode === "employee" ? EMPLOYEE_NAV
      : mode === "manager" ? MANAGER_NAV
        : mode === "management" ? MANAGEMENT_NAV
          : mode === "fleet" ? FLEET_NAV
            : INVENTORY_NAV;

  let items: NavItem[];
  if (mode === "management" && privilegedEmployee) {
    // Never expose the full management nav to an employee-shell grantee — only
    // their allowed links.
    items = homeExtras;
  } else {
    // The Compliance Command Center + checklist oversight + system map are
    // senior-leadership only.
    let list = rawItems.filter(
      (i) =>
        (i.href !== COMPLIANCE_NAV_ITEM.href &&
          i.href !== CHECKLIST_OVERSIGHT_NAV_ITEM.href &&
          i.href !== SYSTEM_MAP_NAV_ITEM.href) ||
        canViewCompliance,
    );
    // Certifications console is admin / HR / senior-leadership only.
    list = list.filter((i) => i.href !== CERTIFICATIONS_NAV_ITEM.href || canViewCertifications);
    if (mode === "employee" && privilegedEmployee) {
      const idx = list.findIndex((i) => i.href === BULLETIN_NAV_ITEM.href);
      const at = idx === -1 ? list.length : idx;
      list = [...list.slice(0, at), ...homeExtras, ...list.slice(at)];
    } else if (showMyHiring && mode !== "employee") {
      const idx = list.findIndex((i) => i.href === BULLETIN_NAV_ITEM.href);
      const at = idx === -1 ? list.length : idx;
      list = [...list.slice(0, at), MY_HIRING_NAV_ITEM, ...list.slice(at)];
    }
    // Service advisors get a "My Sales Goals" link right after their home.
    if (p.isServiceAdvisor && mode === "employee" && !list.some((i) => i.href === MY_SALES_NAV_ITEM.href)) {
      const homeIdx = list.findIndex((i) => i.href === "/me");
      const at = homeIdx === -1 ? 0 : homeIdx + 1;
      list = [...list.slice(0, at), MY_SALES_NAV_ITEM, ...list.slice(at)];
    }
    items = list;
  }
  // Director of Field Ops: a "Field Ops" home link at the top of every center.
  if (p.isFieldOpsDirector && mode !== "employee" && !items.some((i) => i.href === FIELD_OPS_HOME_NAV_ITEM.href)) {
    items = [FIELD_OPS_HOME_NAV_ITEM, ...items];
  }
  // Catalog administration lives in the Inventory center (admin + HR only).
  if (mode === "inventory" && (isAdmin || !!p.isHrAccess)) {
    items = [...items, CATALOG_ADMIN_NAV_ITEM];
  }
  // Hide any remaining links the viewer's saved grants turn off.
  return items.filter((i) => navAllowed(i.href));
}

/** The cross-center Resources group (Handbook + Manual + Bulletin), gated by the
 *  same saved-grant filter. Board observers get none (their bulletin is in their
 *  fixed nav). Shared so the shell and launcher render the same list. */
export function buildResources(p: NavPrincipal): NavItem[] {
  if (p.isBoardObserver) return [];
  const isAdmin = !!p.isAdmin;
  const grantedKeys = p.grantedKeys ?? [];
  const enforceNav = !isAdmin && grantedKeys.length > 0;
  const navAllowed = (href: string) => {
    if (!enforceNav) return true;
    const k = matchPathToItem(href);
    return !k || grantedKeys.includes(k);
  };
  return [HANDBOOK_NAV_ITEM, ...(!p.isEmployee ? [MANUAL_NAV_ITEM] : []), BULLETIN_NAV_ITEM].filter((i) =>
    navAllowed(i.href),
  );
}
