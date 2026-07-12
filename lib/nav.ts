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
export type Mode = "inventory" | "management";

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
    href: "/management/upload",
    label: "Upload MBR",
    shortLabel: "Upload",
    icon: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  },
];

// Back-compat: default export used by older imports.
export const NAV_ITEMS = INVENTORY_NAV;
