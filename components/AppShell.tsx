"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  EMPLOYEE_HUB_NAV_ITEM,
  GROUNDWORK_NAV_ITEM,
  ORG_CHART_NAV_ITEM,
  ACCESS_RIGHTS_NAV_ITEM,
  CONNECTIONS_NAV_ITEM,
  COPILOT_INSIGHTS_NAV_ITEM,
  USERS_ACCESS_NAV_ITEM,
  EMAIL_LOG_NAV_ITEM,
  buildNavForMode,
  buildResources,
  homeMode,
  type Mode,
  type NavItem,
  type NavPrincipal,
} from "@/lib/nav";
import { ToastProvider } from "@/components/ui";
import NotificationBell from "@/components/NotificationBell";
import CanopyCopilot from "@/components/CanopyCopilot";
import type { CopilotRole } from "@/lib/copilot/prompts";

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
  { href: "/executive", label: "Executive", short: "Exec", m: "management" },
  { href: "/fleet", label: "Fleet", short: "Fleet", m: "fleet" },
];

function ModeToggle({ mode, compact = false, centers = CENTERS }: { mode: Mode; compact?: boolean; centers?: typeof CENTERS }) {
  const cell = (active: boolean) =>
    `rounded-lg font-medium text-center transition-colors ${
      compact ? "px-2.5 py-1 text-[11px]" : "px-2.5 py-2 text-xs"
    } ${active ? "bg-emerald-grad text-white shadow-sm" : "text-mint hover:bg-white/5 hover:text-white"}`;

  if (compact) {
    return (
      <div className="flex gap-1 rounded-xl bg-black/20 p-1">
        {centers.map((c) => (
          <Link key={c.m} href={c.href} aria-current={mode === c.m ? "page" : undefined} className={cell(mode === c.m)}>
            {c.short}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-1">
      {centers.map((c) => (
        <Link key={c.m} href={c.href} aria-current={mode === c.m ? "page" : undefined} className={cell(mode === c.m)}>
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

/**
 * Dialog behavior for the nav pop-ups: Escape-to-close, a Tab focus trap inside
 * the dialog, and focus restore to the trigger on close. Call once per dialog.
 */
function useNavDialog(open: boolean, onClose: () => void, ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    const focusablesIn = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement)
        : [];
    // Move focus into the dialog so keyboard users land inside it.
    const initial = focusablesIn();
    (initial[0] ?? node)?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const f = focusablesIn();
        if (f.length === 0) {
          e.preventDefault();
          node?.focus?.();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
  }, [open, onClose, ref]);
}

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
  branch = null,
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
  /** The viewer's home branch (for the Copilot's suggested prompts). */
  branch?: string | null;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<Mode | "menu" | null>(null); // desktop/tablet launcher
  const [denied, setDenied] = useState<string | null>(null);

  const principal: NavPrincipal = {
    isAdmin,
    isEmployee,
    isSeniorLeadership,
    isHrAccess,
    isInterviewer,
    isBoardObserver,
    isSalesDirector,
    isServiceAdvisor,
    isFieldOpsDirector,
    grantedKeys,
  };

  // The Copilot's suggested-prompt picker resolves a single coarse role from the
  // same principal flags (most-specific first), plus the viewer's home branch.
  const copilotRole: CopilotRole = isBoardObserver
    ? "board"
    : isSalesDirector
      ? "sales_director"
      : isFieldOpsDirector
        ? "field_ops"
        : isAdmin
          ? "admin"
          : isSeniorLeadership
            ? "senior"
            : isHrAccess
              ? "hr"
              : isServiceAdvisor
                ? "service_advisor"
                : isEmployee
                  ? "employee"
                  : "manager";

  // Which center the current route belongs to. "Homeless" shared routes
  // (/inbox, /account, /help) and anything unmatched fall back to the viewer's
  // HOME center (role-aware) — never a blanket Inventory nav that is empty for
  // employees.
  const mode: Mode = pathname.startsWith("/me")
    ? "employee"
    // New-hire review pages live under People/HR (the Management center), so light
    // that section rather than falling through to the admin's Inventory home.
    : pathname.startsWith("/reviews")
      ? "management"
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
      // SOPs: the runner is a My Branch (manager) responsibility; the admin SOP
      // library lives under Management.
      : pathname.startsWith("/sops/library")
        ? "management"
        : pathname.startsWith("/sops")
          ? "manager"
      : pathname.startsWith("/my-branch")
        ? "manager"
        // Company KPIs live at /management (the Company center); the /management/*
        // subpages + the Executive financial dashboard (/executive) are the
        // Executive center. The Document Center is an exception — it lives in the
        // Company center (moved there from Executive).
        : pathname === "/management"
          ? "manager"
          : pathname.startsWith("/management/documents")
            ? "manager"
          : (pathname.startsWith("/management") || pathname.startsWith("/executive"))
            ? "management"
          // The Sales Team hub lives in the My Branch / Company center (company-wide
          // for admins, own-branch read-only for managers). The Sales Director has a
          // fixed nav, so mode is cosmetic for them.
          : pathname.startsWith("/sales")
            ? "manager"
          : pathname.startsWith("/fleet")
            ? "fleet"
          : pathname.startsWith("/dashboard") ||
              pathname.startsWith("/check-in") ||
              pathname.startsWith("/check-out") ||
              pathname.startsWith("/inventory") ||
              pathname.startsWith("/reconcile") ||
              pathname.startsWith("/reports") ||
              pathname.startsWith("/alerts") ||
              pathname.startsWith("/manage")
            ? "inventory"
            // Homeless routes (/inbox, /account, /help, /hr, /field-ops, …) resolve
            // to the viewer's home center.
            : homeMode(principal);

  // The SINGLE nav builder drives both the active nav and the launcher preview.
  const items = buildNavForMode(mode, principal);
  const resources: NavItem[] = buildResources(principal);

  // Employees have a single self-service area — no center switcher, no admin.
  // Board observers likewise get no center switcher — their nav is fixed.
  const showCenters = !isEmployee && !isBoardObserver && !isSalesDirector;
  // The Executive center (/executive — company financials / P&L) is admin/exec
  // only; everyone else uses the operational Company KPIs at /management, so the
  // Executive center is hidden from them (the page guard redirects direct hits).
  const canViewExecCenter = isAdmin || isSeniorLeadership;
  const visibleCenters = CENTERS
    .filter((c) => c.m !== "management" || canViewExecCenter)
    // Admins / super admins default the "My Branch" center to a COMPANY-WIDE view
    // (all-branch to-dos + company KPIs), so label its button "Company" for them.
    // Branch managers keep "My Branch" / "Branch".
    .map((c) => (c.m === "manager" && isAdmin ? { ...c, label: "Company", short: "Company" } : c));

  // Most-specific match wins so e.g. /management/sales lights Sales, not Overview.
  const activeHref = [...items, ...resources]
    .map((i) => i.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];

  // Mobile bottom bar: show only the CURRENT module's primary actions (first few),
  // and tuck the rest behind a single "More" sheet. Board observers keep ALL their
  // fixed-nav items visible (incl. the company bulletin) since they have no "More"
  // overflow of their own.
  const MAX_PRIMARY = isBoardObserver ? items.length : 4;
  const mobileExtras: NavItem[] = [
    ...resources,
    ...(canManageAccessRights ? [ACCESS_RIGHTS_NAV_ITEM, CONNECTIONS_NAV_ITEM, COPILOT_INSIGHTS_NAV_ITEM] : []),
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

  // The launcher preview reuses the SAME builder as the active nav — they cannot
  // drift. The active center reuses the already-computed `items`.
  const panelItems = openPanel && openPanel !== "menu" ? buildNavForMode(openPanel, principal) : items;
  const panelLabel =
    openPanel === "menu" || openPanel === null
      ? "Menu"
      : (visibleCenters.find((c) => c.m === openPanel)?.label ?? "Menu");

  // Access-denied flash: the (app) layout redirects a missing-grant hit to a home
  // page with ?denied=<item>. Read it client-side (layouts don't see searchParams),
  // show a dismissible notice, and strip the param so a refresh doesn't repeat it.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const d = sp.get("denied");
      if (d) {
        setDenied(d);
        sp.delete("denied");
        const qs = sp.toString();
        window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
    } catch {
      /* ignore */
    }
  }, [pathname]);

  // Close the pop-ups on navigation.
  useEffect(() => {
    setOpenPanel(null);
    setMoreOpen(false);
  }, [pathname]);

  const closePanel = useCallback(() => setOpenPanel(null), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useNavDialog(openPanel !== null, closePanel, panelRef);
  useNavDialog(moreOpen, closeMore, moreRef);

  return (
    <ToastProvider>
    <div className="flex min-h-screen flex-col">
      {/* Desktop / tablet top bar — center switcher + launcher trigger. */}
      <header className="hidden md:flex sticky top-0 z-30 items-center gap-3 h-16 px-5 bg-forest-grad border-b border-white/10">
        <Link href="/" aria-label="CanopyOS home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-8 w-auto" />
        </Link>
        {showCenters ? (
          <nav className="ml-3 flex items-center gap-1">
            {visibleCenters.map((c) => {
              const current = mode === c.m;
              const open = openPanel === c.m;
              return (
                <button
                  key={c.m}
                  type="button"
                  onClick={() => setOpenPanel((v) => (v === c.m ? null : c.m))}
                  aria-expanded={open}
                  aria-current={current ? "page" : undefined}
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
          <Link
            href={ORG_CHART_NAV_ITEM.href}
            aria-current={isActive(pathname, ORG_CHART_NAV_ITEM.href) ? "page" : undefined}
            className={`mr-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-light transition-colors ${
              isActive(pathname, ORG_CHART_NAV_ITEM.href) ? "bg-white/10 text-white" : "text-mint hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon path={ORG_CHART_NAV_ITEM.icon} className="h-5 w-5" />
            Org Chart
          </Link>
          <Link
            href={GROUNDWORK_NAV_ITEM.href}
            aria-current={isActive(pathname, GROUNDWORK_NAV_ITEM.href) ? "page" : undefined}
            className={`mr-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-light transition-colors ${
              isActive(pathname, GROUNDWORK_NAV_ITEM.href) ? "bg-white/10 text-white" : "text-mint hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon path={GROUNDWORK_NAV_ITEM.icon} className="h-5 w-5" />
            Groundwork
          </Link>
          {!isBoardObserver && mode !== "employee" ? (
            <Link
              href={EMPLOYEE_HUB_NAV_ITEM.href}
              aria-current={isActive(pathname, "/me") ? "page" : undefined}
              className={`mr-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-light transition-colors ${
                isActive(pathname, "/me") ? "bg-white/10 text-white" : "text-mint hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon path={EMPLOYEE_HUB_NAV_ITEM.icon} className="h-5 w-5" />
              Employee Hub
            </Link>
          ) : null}
          <NotificationBell initialCount={unread} />
          <Link href="/help" aria-label="Help" aria-current={isActive(pathname, "/help") ? "page" : undefined} className="flex h-9 w-9 items-center justify-center rounded-xl text-mint hover:bg-white/5 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="12" cy="12" r="9" /><path d={HELP} strokeLinecap="round" /></svg>
          </Link>
          {managerName ? (
            <button
              type="button"
              onClick={() => setOpenPanel((v) => (v ? null : showCenters ? mode : "menu"))}
              aria-label="Menu"
              aria-expanded={openPanel !== null}
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
          <div className="absolute inset-0 bg-black/40" onClick={closePanel} />
          <div ref={panelRef} tabIndex={-1} className="absolute inset-x-0 top-0 max-h-screen overflow-y-auto bg-forest-grad border-b border-white/10 shadow-2xl outline-none">
            <div className="mx-auto w-full max-w-6xl px-6 pt-4 pb-6">
              <div className="flex items-center justify-between h-10 mb-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-mint/70">{panelLabel}</div>
                <button type="button" onClick={closePanel} aria-label="Close menu" className="rounded-lg p-2 text-mint hover:bg-white/5 hover:text-white">
                  <Icon path="M6 6l12 12M18 6L6 18" className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {panelItems.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link key={item.href} href={item.href} onClick={closePanel} aria-current={active ? "page" : undefined} className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-4 px-1 text-center text-[11px] font-light ${active ? "bg-white/10 text-brand-300" : "text-mint hover:bg-white/5 hover:text-white"}`}>
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
                        <Link key={item.href} href={item.href} onClick={closePanel} aria-current={active ? "page" : undefined} className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-4 px-1 text-center text-[11px] font-light ${active ? "bg-white/10 text-brand-300" : "text-mint hover:bg-white/5 hover:text-white"}`}>
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
                  <>
                    <Link href={ACCESS_RIGHTS_NAV_ITEM.href} onClick={closePanel} aria-current={isActive(pathname, ACCESS_RIGHTS_NAV_ITEM.href) ? "page" : undefined} className={navClass(isActive(pathname, ACCESS_RIGHTS_NAV_ITEM.href))}>
                      <Icon path={ACCESS_RIGHTS_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {ACCESS_RIGHTS_NAV_ITEM.label}
                    </Link>
                    <Link href={CONNECTIONS_NAV_ITEM.href} onClick={closePanel} aria-current={isActive(pathname, CONNECTIONS_NAV_ITEM.href) ? "page" : undefined} className={navClass(isActive(pathname, CONNECTIONS_NAV_ITEM.href))}>
                      <Icon path={CONNECTIONS_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {CONNECTIONS_NAV_ITEM.label}
                    </Link>
                    <Link href={COPILOT_INSIGHTS_NAV_ITEM.href} onClick={closePanel} aria-current={isActive(pathname, COPILOT_INSIGHTS_NAV_ITEM.href) ? "page" : undefined} className={navClass(isActive(pathname, COPILOT_INSIGHTS_NAV_ITEM.href))}>
                      <Icon path={COPILOT_INSIGHTS_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {COPILOT_INSIGHTS_NAV_ITEM.label}
                    </Link>
                  </>
                ) : null}
                {isAdmin ? (
                  <>
                    <Link href={USERS_ACCESS_NAV_ITEM.href} onClick={closePanel} aria-current={isActive(pathname, USERS_ACCESS_NAV_ITEM.href) ? "page" : undefined} className={navClass(isActive(pathname, USERS_ACCESS_NAV_ITEM.href))}>
                      <Icon path={USERS_ACCESS_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {USERS_ACCESS_NAV_ITEM.label}
                    </Link>
                    <Link href={EMAIL_LOG_NAV_ITEM.href} onClick={closePanel} aria-current={isActive(pathname, EMAIL_LOG_NAV_ITEM.href) ? "page" : undefined} className={navClass(isActive(pathname, EMAIL_LOG_NAV_ITEM.href))}>
                      <Icon path={EMAIL_LOG_NAV_ITEM.icon} className="h-5 w-5 shrink-0" />
                      {EMAIL_LOG_NAV_ITEM.label}
                    </Link>
                  </>
                ) : null}
                <Link href="/help" onClick={closePanel} aria-current={isActive(pathname, "/help") ? "page" : undefined} className={navClass(isActive(pathname, "/help"))}>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="12" cy="12" r="9" /><path d={HELP} strokeLinecap="round" /></svg>
                  Help
                </Link>
                {managerName ? (
                  <>
                    <Link href="/account" onClick={closePanel} aria-current={isActive(pathname, "/account") ? "page" : undefined} className={navClass(isActive(pathname, "/account"))}>
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
          <Link href="/" aria-label="CanopyOS home" className="flex h-11 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-7 w-auto" />
          </Link>
          {showCenters ? <div className="ml-1"><ModeToggle mode={mode} compact centers={visibleCenters} /></div> : null}
          <div className="ml-auto flex items-center">
          <Link
            href={ORG_CHART_NAV_ITEM.href}
            aria-label="Org Chart"
            aria-current={isActive(pathname, ORG_CHART_NAV_ITEM.href) ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${isActive(pathname, ORG_CHART_NAV_ITEM.href) ? "text-white" : "text-mint hover:text-white hover:bg-white/5"}`}
          >
            <Icon path={ORG_CHART_NAV_ITEM.icon} className="h-6 w-6" />
          </Link>
          <Link
            href={GROUNDWORK_NAV_ITEM.href}
            aria-label="Groundwork"
            aria-current={isActive(pathname, GROUNDWORK_NAV_ITEM.href) ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${isActive(pathname, GROUNDWORK_NAV_ITEM.href) ? "text-white" : "text-mint hover:text-white hover:bg-white/5"}`}
          >
            <Icon path={GROUNDWORK_NAV_ITEM.icon} className="h-6 w-6" />
          </Link>
          {!isBoardObserver && mode !== "employee" ? (
            <Link
              href={EMPLOYEE_HUB_NAV_ITEM.href}
              aria-label="Employee Hub"
              aria-current={isActive(pathname, "/me") ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${isActive(pathname, "/me") ? "text-white" : "text-mint hover:text-white hover:bg-white/5"}`}
            >
              <Icon path={EMPLOYEE_HUB_NAV_ITEM.icon} className="h-6 w-6" />
            </Link>
          ) : null}
          <NotificationBell initialCount={unread} />
          <Link
            href="/help"
            aria-label="Help"
            aria-current={isActive(pathname, "/help") ? "page" : undefined}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-mint hover:text-white hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="9" />
              <path d={HELP} strokeLinecap="round" />
            </svg>
          </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 md:px-8 md:py-8 pb-24 md:pb-8 max-w-5xl w-full mx-auto">
          {denied ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5m0 3h.01" />
              </svg>
              <span className="min-w-0 flex-1">
                You don&apos;t have access to that page, so we brought you here instead. Ask an
                administrator if you need it.
              </span>
              <button
                type="button"
                onClick={() => setDenied(null)}
                aria-label="Dismiss"
                className="shrink-0 rounded-lg p-1 text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ) : null}
          {children}
        </main>
      </div>

      {/* Mobile "More" sheet — overflow nav + resources + account actions. */}
      {moreOpen ? (
        <div className="md:hidden fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label="More menu">
          <div className="absolute inset-0 bg-black/50" onClick={closeMore} />
          <div ref={moreRef} tabIndex={-1} className="absolute bottom-0 inset-x-0 bg-forest-grad border-t border-white/10 rounded-t-2xl p-3 pb-6 max-h-[75vh] overflow-y-auto outline-none">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <div className="grid grid-cols-3 gap-2">
              {moreItems.map((item) => {
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMore}
                    aria-current={active ? "page" : undefined}
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
              <Link href="/help" onClick={closeMore} aria-current={isActive(pathname, "/help") ? "page" : undefined} className={navClass(isActive(pathname, "/help"))}>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  <circle cx="12" cy="12" r="9" />
                  <path d={HELP} strokeLinecap="round" />
                </svg>
                Help
              </Link>
              {managerName ? (
                <>
                  <Link href="/account" onClick={closeMore} aria-current={isActive(pathname, "/account") ? "page" : undefined} className={navClass(isActive(pathname, "/account"))}>
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
              aria-current={active ? "page" : undefined}
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
            aria-expanded={moreOpen}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-light ${
              moreActive ? "text-brand-300" : "text-mint"
            }`}
          >
            <Icon path="M5 12h.01M12 12h.01M19 12h.01" className="h-5 w-5" />
            More
          </button>
        ) : null}
      </nav>

      {/* Canopy Copilot — the docked, grounded assistant for EVERY authenticated
          user. Content is access-scoped server-side by the /api/copilot route;
          the panel just resolves role/branch for its suggested prompts. Replaces
          the retired, leadership-only InsightsWidget. */}
      <CanopyCopilot user={{ name: managerName ?? null, role: copilotRole, branch }} />
    </div>
    </ToastProvider>
  );
}
