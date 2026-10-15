"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { EMPLOYEE_NAV, MANAGER_NAV, INVENTORY_NAV, MANAGEMENT_NAV, FLEET_NAV, BOARD_OBSERVER_NAV, SALES_DIRECTOR_NAV, COMPLIANCE_NAV_ITEM, CHECKLIST_OVERSIGHT_NAV_ITEM, SYSTEM_MAP_NAV_ITEM, CERTIFICATIONS_NAV_ITEM, TRAINING_CENTER_NAV_ITEM, PREHIRE_NAV_ITEM, HR_HOME_NAV_ITEM, FIELD_OPS_HOME_NAV_ITEM, HIRING_NAV_ITEM, MY_HIRING_NAV_ITEM, PTO_NAV_ITEM, MY_SALES_NAV_ITEM, BULLETIN_NAV_ITEM, HANDBOOK_NAV_ITEM, MANUAL_NAV_ITEM, CATALOG_ADMIN_NAV_ITEM, USERS_ACCESS_NAV_ITEM, EMAIL_LOG_NAV_ITEM, ACCESS_RIGHTS_NAV_ITEM, type Mode, type NavItem } from "@/lib/nav";
import { matchPathToItem } from "@/lib/access-paths";
import NotificationBell from "@/components/NotificationBell";
import InsightsWidget from "@/components/InsightsWidget";

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

// Switcher between the Branch, Inventory, Management, and Fleet centers.
// Desktop renders a 2×2 grid of full labels; the mobile bar uses a compact row.
const CENTERS: { href: string; label: string; short: string; m: Mode }[] = [
  { href: "/my-branch", label: "My Branch", short: "Branch", m: "manager" },
  { href: "/dashboard", label: "Inventory", short: "Inventory", m: "inventory" },
  { href: "/management", label: "Management", short: "Mgmt", m: "management" },
  { href: "/fleet", label: "Fleet", short: "Fleet", m: "fleet" },
];

function ModeToggle({ mode, compact = false }: { mode: Mode; compact?: boolean }) {
  const cell = (active: boolean) =>
    `rounded-lg font-medium text-center transition-colors ${
      compact ? "px-2.5 py-1 text-[11px]" : "px-2.5 py-2 text-xs"
    } ${active ? "bg-emerald-grad text-white shadow-sm" : "text-mint hover:bg-white/5 hover:text-white"}`;

  if (compact) {
    return (
      <div className="flex gap-1 rounded-xl bg-black/20 p-1">
        {CENTERS.map((c) => (
          <Link key={c.m} href={c.href} className={cell(mode === c.m)}>
            {c.short}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-1">
      {CENTERS.map((c) => (
        <Link key={c.m} href={c.href} className={cell(mode === c.m)}>
          {c.label}
        </Link>
      ))}
    </div>
  );
}

// Shared classes for dark-chrome nav links.
function navClass(active: boolean) {
  return `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-light transition-colors ${
    active
      ? "bg-brand-400/15 text-white"
      : "text-mint hover:bg-white/5 hover:text-white"
  }`;
}

const HELP = "M9.5 9a2.5 2.5 0 013.9-1.9c1.2.8 1.1 2.3 0 3.1-.7.5-1.4.9-1.4 1.8M12 17h.01";

export default function AppShell({
  children,
  managerName,
  isAdmin = false,
  isEmployee = false,
  isSeniorLeadership = false,
  isHrAccess = false,
  isInterviewer = false,
  isBoardObserver = false,
  isSalesDirector = false,
  isServiceAdvisor = false,
  isFieldOpsDirector = false,
  canManageAccessRights = false,
  grantedKeys = [],
  unread = 0,
}: {
  children: React.ReactNode;
  managerName?: string;
  isAdmin?: boolean;
  isEmployee?: boolean;
  isSeniorLeadership?: boolean;
  isHrAccess?: boolean;
  isInterviewer?: boolean;
  isBoardObserver?: boolean;
  isSalesDirector?: boolean;
  isServiceAdvisor?: boolean;
  isFieldOpsDirector?: boolean;
  canManageAccessRights?: boolean;
  grantedKeys?: string[];
  unread?: number;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<Mode | "menu" | null>(null); // desktop/tablet launcher
  const mode: Mode = pathname.startsWith("/me")
    ? "employee"
    : pathname.startsWith("/bulletin")
      // The company bulletin is shared by everyone; show it inside whichever
      // home nav fits the viewer (employees keep their self-service shell).
      ? (isEmployee ? "employee" : "manager")
      // Oversight checklists are a My Branch (manager) responsibility; the
      // leadership rollup lives under Management.
      : pathname.startsWith("/checklists/oversight")
        ? "management"
        : pathname.startsWith("/checklists")
          ? "manager"
      : pathname.startsWith("/my-branch")
        ? "manager"
        : pathname.startsWith("/management")
          ? "management"
          // The Sales Team hub is a management-style cross-branch view.
          : pathname.startsWith("/sales")
            ? "management"
          : pathname.startsWith("/fleet")
            ? "fleet"
            : "inventory";
  // Access Rights nav filtering: hide links a user's saved grants turn off.
  // Admins are never filtered; an empty grant set disables filtering entirely
  // (fail-open); unmapped hrefs are always shown. Hiding a link never locks
  // anyone out — the (app) layout guard handles direct-URL access.
  const enforceNav = !isAdmin && grantedKeys.length > 0;
  const navAllowed = (href: string) => {
    if (!enforceNav) return true;
    const k = matchPathToItem(href);
    return !k || grantedKeys.includes(k);
  };
  // Access grants (admins always qualify). Compliance = senior leadership;
  // Pre-hires = HR. An employee-shell user with any grant keeps their stripped
  // self-service shell and may reach ONLY their granted management pages.
  const canViewCompliance = isAdmin || isSeniorLeadership;
  // Certifications console — admins + HR + senior leadership (read-only).
  const canViewCertifications = isAdmin || isHrAccess || isSeniorLeadership;
  const canManagePreHire = isAdmin || isHrAccess;
  const canManageAts = isAdmin || isHrAccess;
  const canViewAllPto = isAdmin || isHrAccess;
  const grantedMgmt: NavItem[] = [];
  // HR grantees land on the HR Command Center — give them the link first.
  if (isHrAccess) grantedMgmt.push(HR_HOME_NAV_ITEM);
  if (canViewCompliance) grantedMgmt.push(COMPLIANCE_NAV_ITEM);
  if (canViewCompliance) grantedMgmt.push(CHECKLIST_OVERSIGHT_NAV_ITEM);
  // Certifications folded into the Training Center hub. Non-admin HR / senior-
  // leadership grantees land on the Assign tab (the Courses landing is admin-only).
  if (canViewCertifications)
    grantedMgmt.push(
      isAdmin ? TRAINING_CENTER_NAV_ITEM : { ...TRAINING_CENTER_NAV_ITEM, href: "/management/training-center/assign" },
    );
  if (canManageAts) grantedMgmt.push(HIRING_NAV_ITEM);
  if (canManagePreHire) grantedMgmt.push(PREHIRE_NAV_ITEM);
  if (canViewAllPto) grantedMgmt.push(PTO_NAV_ITEM);
  // Interviewers (non-HR) get a scoped "My Hiring" link. HR already has the full
  // Hiring nav, so don't double it up for them.
  const showMyHiring = isInterviewer && !canManageAts;
  const homeExtras: NavItem[] = [...grantedMgmt, ...(showMyHiring ? [MY_HIRING_NAV_ITEM] : [])].filter((i) => navAllowed(i.href));
  const privilegedEmployee = isEmployee && homeExtras.length > 0;

  const rawItems =
    mode === "employee" ? EMPLOYEE_NAV
      : mode === "manager" ? MANAGER_NAV
        : mode === "management" ? MANAGEMENT_NAV
          : mode === "fleet" ? FLEET_NAV
            : INVENTORY_NAV;

  let items: NavItem[];
  if (isBoardObserver) {
    // A board observer is a distinct read-only principal: they get their own
    // minimal exec nav on EVERY route, never the full management/inventory nav.
    items = BOARD_OBSERVER_NAV;
  } else if (isSalesDirector) {
    // The Sales Director is a focused principal: a fixed Sales nav on every
    // route (admins/super-admins instead get Sales Team inside their full nav).
    items = SALES_DIRECTOR_NAV;
  } else if (mode === "management" && privilegedEmployee) {
    // Never expose the full management nav to an employee-shell grantee (incl. a
    // tech interviewer on a job-container page) — only their allowed links.
    items = homeExtras;
  } else {
    // The Compliance Command Center + checklist oversight are senior-leadership only.
    let list = rawItems.filter((i) => (i.href !== COMPLIANCE_NAV_ITEM.href && i.href !== CHECKLIST_OVERSIGHT_NAV_ITEM.href && i.href !== SYSTEM_MAP_NAV_ITEM.href) || canViewCompliance);
    // Certifications console is admin / HR / senior-leadership only.
    list = list.filter((i) => i.href !== CERTIFICATIONS_NAV_ITEM.href || canViewCertifications);
    // Surface granted management links + My Hiring on the grantee's employee home
    // nav (inserted just before the company bulletin).
    if (mode === "employee" && privilegedEmployee) {
      const idx = list.findIndex((i) => i.href === BULLETIN_NAV_ITEM.href);
      const at = idx === -1 ? list.length : idx;
      list = [...list.slice(0, at), ...homeExtras, ...list.slice(at)];
    } else if (showMyHiring && mode !== "employee") {
      // Manager/other non-employee interviewer: add a My Hiring link before the
      // bulletin without stripping their normal nav.
      const idx = list.findIndex((i) => i.href === BULLETIN_NAV_ITEM.href);
      const at = idx === -1 ? list.length : idx;
      list = [...list.slice(0, at), MY_HIRING_NAV_ITEM, ...list.slice(at)];
    }
    // Service advisors get a "My Sales Goals" link right after their home.
    if (isServiceAdvisor && mode === "employee" && !list.some((i) => i.href === MY_SALES_NAV_ITEM.href)) {
      const homeIdx = list.findIndex((i) => i.href === "/me");
      const at = homeIdx === -1 ? 0 : homeIdx + 1;
      list = [...list.slice(0, at), MY_SALES_NAV_ITEM, ...list.slice(at)];
    }
    items = list;
  }
  // The Director of Field Ops gets a "Field Ops" home link at the top of every
  // center's nav (he's a full admin, so he keeps the full nav but can always get
  // back to his command center).
  if (isFieldOpsDirector && !isBoardObserver && mode !== "employee" && !items.some((i) => i.href === FIELD_OPS_HOME_NAV_ITEM.href)) {
    items = [FIELD_OPS_HOME_NAV_ITEM, ...items];
  }
  // Catalog administration (the former standalone "Manage" area) now lives in
  // the Inventory center. Admins and HR grantees get a single entry into it;
  // /manage redirects each to their allowed landing. Board observers never do.
  if (mode === "inventory" && !isBoardObserver && (isAdmin || isHrAccess)) {
    items = [...items, CATALOG_ADMIN_NAV_ITEM];
  }
  // Hide any remaining links the viewer's saved grants turn off (admins/empty
  // grants are unaffected; see navAllowed).
  items = items.filter((i) => navAllowed(i.href));
  // Employees have a single self-service area — no center switcher, no admin.
  // Board observers likewise get no center switcher — their nav is fixed.
  const showCenters = !isEmployee && !isBoardObserver && !isSalesDirector;
  // Resources / document center. Handbook + Company Bulletin are for everyone;
  // the Manager Manual is managers/admin only. Board observers keep their fixed
  // nav untouched (the bulletin lives directly in BOARD_OBSERVER_NAV for them).
  const resources: NavItem[] = isBoardObserver
    ? []
    : [HANDBOOK_NAV_ITEM, ...(!isEmployee ? [MANUAL_NAV_ITEM] : []), BULLETIN_NAV_ITEM].filter((i) => navAllowed(i.href));
  // Most-specific match wins so e.g. /management/sales lights Sales, not Overview.
  const activeHref = [...items, ...resources]
    .map((i) => i.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  // Mobile bottom bar: show only the CURRENT module's primary actions (first few),
  // and tuck the rest — extra module items, cross-module resources, and admin/
  // account links — behind a single "More" sheet. The top module switcher already
  // lets the user change centers, so the bar stays uncluttered and thumb-friendly.
  const MAX_PRIMARY = 4;
  const mobileExtras: NavItem[] = [
    ...resources,
    ...(canManageAccessRights ? [ACCESS_RIGHTS_NAV_ITEM] : []),
    ...(isAdmin ? [USERS_ACCESS_NAV_ITEM, EMAIL_LOG_NAV_ITEM] : []),
  ];
  const needMore = items.length > MAX_PRIMARY || mobileExtras.length > 0;
  const primaryItems = needMore ? items.slice(0, MAX_PRIMARY) : items;
  const moreItems = needMore ? [...items.slice(MAX_PRIMARY), ...mobileExtras] : [];
  const moreActive = moreItems.some((i) => i.href === activeHref);
  const bottomCols = primaryItems.length + (needMore ? 1 : 0);

  const initials = managerName
    ? managerName.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
    : "";

  // Build the page list for ANY center (so clicking a center opens its grid in
  // place, without navigating there first). Mirrors the `items` derivation above
  // for the non-special principals who get a center switcher. The active center
  // reuses the already-computed `items` so its behavior is unchanged.
  function itemsForMode(m: Mode): NavItem[] {
    if (m === mode) return items;
    const raw =
      m === "manager" ? MANAGER_NAV
        : m === "management" ? MANAGEMENT_NAV
          : m === "fleet" ? FLEET_NAV
            : INVENTORY_NAV;
    let list = raw.filter((i) => (i.href !== COMPLIANCE_NAV_ITEM.href && i.href !== CHECKLIST_OVERSIGHT_NAV_ITEM.href && i.href !== SYSTEM_MAP_NAV_ITEM.href) || canViewCompliance);
    list = list.filter((i) => i.href !== CERTIFICATIONS_NAV_ITEM.href || canViewCertifications);
    if (showMyHiring) {
      const idx = list.findIndex((i) => i.href === BULLETIN_NAV_ITEM.href);
      const at = idx === -1 ? list.length : idx;
      list = [...list.slice(0, at), MY_HIRING_NAV_ITEM, ...list.slice(at)];
    }
    if (isFieldOpsDirector && !list.some((i) => i.href === FIELD_OPS_HOME_NAV_ITEM.href)) {
      list = [FIELD_OPS_HOME_NAV_ITEM, ...list];
    }
    if (m === "inventory" && (isAdmin || isHrAccess)) {
      list = [...list, CATALOG_ADMIN_NAV_ITEM];
    }
    return list.filter((i) => navAllowed(i.href));
  }

  const panelItems = openPanel && openPanel !== "menu" ? itemsForMode(openPanel) : items;
  const panelLabel =
    openPanel === "menu" || openPanel === null
      ? "Menu"
      : (CENTERS.find((c) => c.m === openPanel)?.label ?? "Menu");

  return (
    <div className="flex min-h-screen flex-col">
      {/* Desktop / tablet top bar — center switcher + launcher trigger. The old
          scrolling sidebar is replaced by an on-demand icon grid (same tiles as
          the mobile "More" sheet), so the page gets the full width. */}
      <header className="hidden md:flex sticky top-0 z-30 items-center gap-3 h-16 px-5 bg-forest-grad border-b border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-8 w-auto" />
        {showCenters ? (
          <nav className="ml-3 flex items-center gap-1">
            {CENTERS.map((c) => {
              const current = mode === c.m;
              const open = openPanel === c.m;
              return (
                <button
                  key={c.m}
                  type="button"
                  onClick={() => setOpenPanel((v) => (v === c.m ? null : c.m))}
                  aria-expanded={open}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-light transition-colors ${
                    open ? "bg-white/10 text-white" : current ? "bg-white/5 text-white hover:bg-white/10" : "text-mint hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {c.label}
                  <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              );
            })}
          </nav>
        ) : (
          <button
            type="button"
            onClick={() => setOpenPanel((v) => (v === "menu" ? null : "menu"))}
            aria-expanded={openPanel === "menu"}
            className="ml-3 flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-light text-mint hover:bg-white/5 hover:text-white"
          >
            <Icon path="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
            Menu
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell initialCount={unread} />
          <Link href="/help" aria-label="Help" className="rounded-xl p-2 text-mint hover:bg-white/5 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="12" cy="12" r="9" /><path d={HELP} strokeLinecap="round" /></svg>
          </Link>
          {managerName ? (
            <button
              type="button"
              onClick={() => setOpenPanel((v) => (v ? null : showCenters ? mode : "menu"))}
              aria-label="Menu"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand-400 text-[12px] font-semibold text-forest-ink"
            >
              {initials}
            </button>
          ) : null}
        </div>
      </header>

      {/* Desktop / tablet launcher pop-up — the current center's pages as an icon grid. */}
      {openPanel ? (
        <div className="hidden md:block fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`${panelLabel} menu`}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenPanel(null)} />
          <div className="absolute inset-x-0 top-0 max-h-screen overflow-y-auto bg-forest-grad border-b border-white/10 shadow-2xl">
            <div className="mx-auto w-full max-w-6xl px-6 pt-4 pb-6">
              <div className="flex items-center justify-between h-10 mb-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-mint/70">{panelLabel}</div>
                <button type="button" onClick={() => setOpenPanel(null)} aria-label="Close menu" className="rounded-lg p-2 text-mint hover:bg-white/5 hover:text-white">
                  <Icon path="M6 6l12 12M18 6L6 18" className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {panelItems.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setOpenPanel(null)} className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-4 px-1 text-center text-[11px] font-light ${active ? "bg-white/10 text-brand-300" : "text-mint hover:bg-white/5 hover:text-white"}`}>
                      <Icon path={item.icon} className="h-6 w-6" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              {resources.length ? (
                <>
                  <div className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-mint/70">Resources</div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {resources.map((item) => {
                      const active = item.href === activeHref;
                      return (
                        <Link key={item.href} href={item.href} onClick={() => setOpenPanel(null)} className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-4 px-1 text-center text-[11px] font-light ${active ? "bg-white/10 text-brand-300" : "text-mint hover:bg-white/5 hover:text-white"}`}>
                          <Icon path={item.icon} className="h-6 w-6" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </>
              ) : null}
              <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center gap-1">
                {canManageAccessRights ? (
                  <Link href={ACCESS_RIGHTS_NAV_ITEM.href} onClick={() => setOpenPanel(null)} className={navClass(isActive(pathname, ACCESS_RIGHTS_NAV_ITEM.href))}>
                    <Icon path={ACCESS_RIGHTS_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                    {ACCESS_RIGHTS_NAV_ITEM.label}
                  </Link>
                ) : null}
                {isAdmin ? (
                  <>
                    <Link href={USERS_ACCESS_NAV_ITEM.href} onClick={() => setOpenPanel(null)} className={navClass(isActive(pathname, USERS_ACCESS_NAV_ITEM.href))}>
                      <Icon path={USERS_ACCESS_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {USERS_ACCESS_NAV_ITEM.label}
                    </Link>
                    <Link href={EMAIL_LOG_NAV_ITEM.href} onClick={() => setOpenPanel(null)} className={navClass(isActive(pathname, EMAIL_LOG_NAV_ITEM.href))}>
                      <Icon path={EMAIL_LOG_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {EMAIL_LOG_NAV_ITEM.label}
                    </Link>
                  </>
                ) : null}
                <Link href="/help" onClick={() => setOpenPanel(null)} className={navClass(isActive(pathname, "/help"))}>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="12" cy="12" r="9" /><path d={HELP} strokeLinecap="round" /></svg>
                  Help
                </Link>
                {managerName ? (
                  <>
                    <Link href="/account" onClick={() => setOpenPanel(null)} className={navClass(isActive(pathname, "/account"))}>
                      <Icon path="M12 15a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0" className="h-5 w-5 shrink-0" />
                      Change password
                    </Link>
                    <form action="/api/auth/logout" method="post">
                      <button className={`${navClass(false)} w-full text-left`}>
                        <Icon path="M15 17l5-5-5-5M20 12H9M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4" className="h-5 w-5 shrink-0" />
                        Sign out
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
              {managerName ? (
                <div className="mt-3 text-[11px] text-mint/70">Signed in as <span className="text-white">{managerName}</span></div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex-1 flex flex-col app-canvas">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-2 h-14 px-4 bg-forest-grad border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-7 w-auto" />
          {showCenters ? <div className="ml-1"><ModeToggle mode={mode} compact /></div> : null}
          <div className="ml-auto flex items-center gap-2">
          <NotificationBell initialCount={unread} />
          <Link
            href="/help"
            aria-label="Help"
            className="p-1 text-mint hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="9" />
              <path d={HELP} strokeLinecap="round" />
            </svg>
          </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 md:px-8 md:py-8 pb-24 md:pb-8 max-w-5xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile "More" sheet — overflow nav + resources + account actions. */}
      {moreOpen ? (
        <div className="md:hidden fixed inset-0 z-30" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-forest-grad border-t border-white/10 rounded-t-2xl p-3 pb-6 max-h-[75vh] overflow-y-auto">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <div className="grid grid-cols-3 gap-2">
              {moreItems.map((item) => {
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 px-1 text-center text-[11px] font-light ${
                      active ? "bg-white/10 text-brand-300" : "text-mint hover:bg-white/5"
                    }`}
                  >
                    <Icon path={item.icon} className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 border-t border-white/10 pt-3 space-y-1">
              <Link href="/help" onClick={() => setMoreOpen(false)} className={navClass(isActive(pathname, "/help"))}>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  <circle cx="12" cy="12" r="9" />
                  <path d={HELP} strokeLinecap="round" />
                </svg>
                Help
              </Link>
              {managerName ? (
                <>
                  <Link href="/account" onClick={() => setMoreOpen(false)} className={navClass(isActive(pathname, "/account"))}>
                    <Icon path="M12 15a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0" className="h-5 w-5 shrink-0" />
                    Change password
                  </Link>
                  <form action="/api/auth/logout" method="post">
                    <button className={`${navClass(false)} w-full text-left`}>
                      <Icon path="M15 17l5-5-5-5M20 12H9M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4" className="h-5 w-5 shrink-0" />
                      Sign out
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Mobile bottom nav — current module's primary actions + a More button. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-forest-grad border-t border-white/10 grid"
        style={{ gridTemplateColumns: `repeat(${bottomCols}, minmax(0, 1fr))` }}
      >
        {primaryItems.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-light ${
                active ? "text-brand-300" : "text-mint"
              }`}
            >
              <span className="relative">
                <Icon path={item.icon} className="h-5 w-5" />
              </span>
              {item.shortLabel}
            </Link>
          );
        })}
        {needMore ? (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-light ${
              moreActive ? "text-brand-300" : "text-mint"
            }`}
          >
            <Icon path="M5 12h.01M12 12h.01M19 12h.01" className="h-5 w-5" />
            More
          </button>
        ) : null}
      </nav>

      {/* Floating grounded-Q&A assistant — leadership only. */}
      {isAdmin || isSeniorLeadership ? <InsightsWidget /> : null}
    </div>
  );
}
