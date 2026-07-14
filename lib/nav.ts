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
    href: "/my-branch/scorecard",
    label: "Scorecard",
    shortLabel: "Score",
    icon: "M4 20V10m6 10V4m6 16v-7M4 20h16",
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

export const MANAGEMENT_NAV: NavItem[] = [
  {
    href: "/management/board",
    label: "Board / Executive",
    shortLabel: "Board",
    icon: "M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6",
  },
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
    href: "/management/upload",
    label: "Upload MBR",
    shortLabel: "Upload",
    icon: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  },
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
];

// Back-compat: default export used by older imports.
export const NAV_ITEMS = INVENTORY_NAV;
