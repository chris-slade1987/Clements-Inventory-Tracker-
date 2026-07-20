"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EMPLOYEE_NAV, MANAGER_NAV, INVENTORY_NAV, MANAGEMENT_NAV, FLEET_NAV, BOARD_OBSERVER_NAV, COMPLIANCE_NAV_ITEM, CHECKLIST_OVERSIGHT_NAV_ITEM, PREHIRE_NAV_ITEM, HIRING_NAV_ITEM, MY_HIRING_NAV_ITEM, PTO_NAV_ITEM, BULLETIN_NAV_ITEM, type Mode, type NavItem } from "@/lib/nav";
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
    } ${active ? "bg-emerald-grad text-[#05271c] shadow-sm" : "text-mint hover:bg-white/5 hover:text-white"}`;

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

const GEAR =
  "M10.3 3.3a1 1 0 011.4 0l1 1a1 1 0 00.9.3l1.4-.2a1 1 0 011.1.7l.4 1.3a1 1 0 00.7.7l1.3.4a1 1 0 01.7 1.1l-.2 1.4a1 1 0 00.3.9l1 1a1 1 0 010 1.4l-1 1a1 1 0 00-.3.9l.2 1.4a1 1 0 01-.7 1.1l-1.3.4a1 1 0 00-.7.7l-.4 1.3a1 1 0 01-1.1.7l-1.4-.2a1 1 0 00-.9.3l-1 1a1 1 0 01-1.4 0l-1-1a1 1 0 00-.9-.3l-1.4.2a1 1 0 01-1.1-.7l-.4-1.3a1 1 0 00-.7-.7l-1.3-.4a1 1 0 01-.7-1.1l.2-1.4a1 1 0 00-.3-.9l-1-1a1 1 0 010-1.4l1-1a1 1 0 00.3-.9l-.2-1.4a1 1 0 01.7-1.1l1.3-.4a1 1 0 00.7-.7l.4-1.3a1 1 0 011.1-.7l1.4.2a1 1 0 00.9-.3z";
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
  unread?: number;
}) {
  const pathname = usePathname();
  const mode: Mode = pathname.startsWith("/me")
    ? "employee"
    : pathname.startsWith("/bulletin")
      // The company bulletin is shared by everyone; show it inside whichever
      // home nav fits the viewer (employees keep their self-service shell).
      ? (isEmployee ? "employee" : "manager")
      : pathname.startsWith("/my-branch")
        ? "manager"
        : pathname.startsWith("/management")
          ? "management"
          : pathname.startsWith("/fleet")
            ? "fleet"
            : "inventory";
  // Access grants (admins always qualify). Compliance = senior leadership;
  // Pre-hires = HR. An employee-shell user with any grant keeps their stripped
  // self-service shell and may reach ONLY their granted management pages.
  const canViewCompliance = isAdmin || isSeniorLeadership;
  const canManagePreHire = isAdmin || isHrAccess;
  const canManageAts = isAdmin || isHrAccess;
  const canViewAllPto = isAdmin || isHrAccess;
  const grantedMgmt: NavItem[] = [];
  if (canViewCompliance) grantedMgmt.push(COMPLIANCE_NAV_ITEM);
  if (canViewCompliance) grantedMgmt.push(CHECKLIST_OVERSIGHT_NAV_ITEM);
  if (canManageAts) grantedMgmt.push(HIRING_NAV_ITEM);
  if (canManagePreHire) grantedMgmt.push(PREHIRE_NAV_ITEM);
  if (canViewAllPto) grantedMgmt.push(PTO_NAV_ITEM);
  // Interviewers (non-HR) get a scoped "My Hiring" link. HR already has the full
  // Hiring nav, so don't double it up for them.
  const showMyHiring = isInterviewer && !canManageAts;
  const homeExtras: NavItem[] = [...grantedMgmt, ...(showMyHiring ? [MY_HIRING_NAV_ITEM] : [])];
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
  } else if (mode === "management" && privilegedEmployee) {
    // Never expose the full management nav to an employee-shell grantee (incl. a
    // tech interviewer on a job-container page) — only their allowed links.
    items = homeExtras;
  } else {
    // The Compliance Command Center + checklist oversight are senior-leadership only.
    let list = rawItems.filter((i) => (i.href !== COMPLIANCE_NAV_ITEM.href && i.href !== CHECKLIST_OVERSIGHT_NAV_ITEM.href) || canViewCompliance);
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
    items = list;
  }
  // Employees have a single self-service area — no center switcher, no admin.
  // Board observers likewise get no center switcher — their nav is fixed.
  const showCenters = !isEmployee && !isBoardObserver;
  // Most-specific match wins so e.g. /management/sales lights Sales, not Overview.
  const activeHref = items
    .map((i) => i.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-forest-grad border-r border-white/10">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-9 w-9 shrink-0" />
          <div className="leading-tight">
            <div className="font-semibold text-white tracking-[0.14em]">CLEMENTS</div>
            <div className="text-xs text-mint">Command &amp; Control</div>
          </div>
        </div>
        {showCenters ? (
          <div className="px-3 pt-3">
            <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mint/70">Center</div>
            <ModeToggle mode={mode} />
          </div>
        ) : null}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link key={item.href} href={item.href} className={navClass(active)}>
                <Icon path={item.icon} className="h-5 w-5 shrink-0" />
                {item.label}
                {active ? <span className="ml-auto text-mint">→</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-2 space-y-1">
          <NotificationBell initialCount={unread} layout="row" />
          {isAdmin ? (
            <Link href="/manage" className={navClass(isActive(pathname, "/manage"))}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <path d={GEAR} />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Manage
            </Link>
          ) : null}
          <Link href="/help" className={navClass(isActive(pathname, "/help"))}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="9" />
              <path d={HELP} strokeLinecap="round" />
            </svg>
            Help
          </Link>
        </div>
        {managerName ? (
          <div className="border-t border-white/10 px-4 py-3">
            <div className="text-xs text-mint">Signed in as</div>
            <div className="text-sm font-normal text-white truncate">
              {managerName}
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="mt-2 text-xs font-medium text-brand-300 hover:text-brand-200 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </aside>

      {/* Main column */}
      <div className="flex-1 md:pl-60 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-2 h-14 px-4 bg-forest-grad border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-7 w-7 shrink-0" />
          <span className="font-semibold text-white tracking-[0.12em]">CLEMENTS</span>
          {showCenters ? <div className="ml-1"><ModeToggle mode={mode} compact /></div> : null}
          <div className="ml-auto flex items-center gap-2">
          <NotificationBell initialCount={unread} />
          {isAdmin ? (
            <Link href="/manage" aria-label="Manage" className="p-1 text-mint hover:text-white">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
              </svg>
            </Link>
          ) : null}
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

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-forest-grad border-t border-white/10 grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-light ${
                active ? "text-brand-300" : "text-mint"
              }`}
            >
              <Icon path={item.icon} className="h-5 w-5" />
              {item.shortLabel}
            </Link>
          );
        })}
      </nav>

      {/* Floating grounded-Q&A assistant — leadership only. */}
      {isAdmin || isSeniorLeadership ? <InsightsWidget /> : null}
    </div>
  );
}
