// Central navigation config used by both the desktop sidebar and the mobile
// bottom bar. Icons are inline SVG path data (single-color, currentColor).

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

// Insights assistant — conversational, grounded management Q&A. Exec-sensitive
// financials, so only admins + senior leadership reach the page (it redirects
// others). A chat-bubble/spark glyph, distinct from the other management icons.
export const INSIGHTS_NAV_ITEM: NavItem = {
  href: "/management/insights",
  label: "Insights",
  shortLabel: "Insights",
  icon: "M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5zM12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1L9 10.5l2.1-.9z",
};

// Pre-hire onboarding — surfaced for HR (admins + granted HR only), not in the
// general management nav.
export const PREHIRE_NAV_ITEM: NavItem = {
  href: "/management/people/prehires",
  label: "Pre-hires",
  shortLabel: "Pre-hires",
  icon: "M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h3M16 19l2 2 4-4",
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

// Company-wide bulletin — reachable from every center's nav.
export const BULLETIN_NAV_ITEM: NavItem = {
  href: "/bulletin",
  label: "Company Bulletin",
  shortLabel: "Bulletin",
  icon: "M3 10v4a1 1 0 001 1h3l6 4V5L7 9H4a1 1 0 00-1 1zM17 8a4 4 0 010 8",
};

// Employee ("My Work") home — their assigned training + lesson library.
export const EMPLOYEE_NAV: NavItem[] = [
  {
    href: "/me",
    label: "My Work",
    shortLabel: "Home",
    icon: "M3 12l9-9 9 9M5 10v10h14V10M9 21v-6h6v6",
  },
  {
    href: "/me/library",
    label: "Lesson Library",
    shortLabel: "Library",
    icon: "M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM8 7h6M8 11h8M8 15h8",
  },
  BULLETIN_NAV_ITEM,
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
  BULLETIN_NAV_ITEM,
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
  BULLETIN_NAV_ITEM,
];

export const MANAGEMENT_NAV: NavItem[] = [
  {
    href: "/management/board",
    label: "Board / Executive",
    shortLabel: "Board",
    icon: "M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6",
  },
  INSIGHTS_NAV_ITEM,
  {
    href: "/management",
    label: "Management",
    shortLabel: "Mgmt",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
  },
  {
    href: "/management/sales",
    label: "Sales & Attrition",
    shortLabel: "Sales",
    icon: "M3 17l6-6 4 4 8-8M21 7v5m0-5h-5",
  },
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
  {
    href: "/management/training",
    label: "Training",
    shortLabel: "Training",
    icon: "M12 4L2 9l10 5 8-4v6M6 12v5c0 1 3 2 6 2s6-1 6-2v-5",
  },
  {
    href: "/management/people",
    label: "People / HR",
    shortLabel: "People",
    icon: "M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0zm14 13v-2a4 4 0 00-3-3.9",
  },
  {
    href: "/management/documents",
    label: "Document Center",
    shortLabel: "Docs",
    icon: "M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h6",
  },
  {
    href: "/management/insurance",
    label: "Insurance",
    shortLabel: "Insure",
    icon: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3zM9 12l2 2 4-4",
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
  BULLETIN_NAV_ITEM,
];

// Back-compat: default export used by older imports.
export const NAV_ITEMS = INVENTORY_NAV;
