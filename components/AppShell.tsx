"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EMPLOYEE_NAV, MANAGER_NAV, INVENTORY_NAV, MANAGEMENT_NAV, FLEET_NAV, type Mode } from "@/lib/nav";

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

// Segmented control switching between the Inventory, Management, and Fleet centers.
function ModeToggle({ mode, compact = false }: { mode: Mode; compact?: boolean }) {
  const base = compact ? "px-1.5 py-1 text-[10px]" : "flex-1 px-1 py-1.5 text-[10px]";
  const opt = (active: boolean) =>
    `${base} rounded-lg font-medium text-center transition-colors ${
      active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"
    }`;
  const centers: { href: string; label: string; m: Mode }[] = [
    { href: "/my-branch", label: "My Branch", m: "manager" },
    { href: "/dashboard", label: "Inventory", m: "inventory" },
    { href: "/management", label: "Mgmt", m: "management" },
    { href: "/fleet", label: "Fleet", m: "fleet" },
  ];
  return (
    <div className="flex gap-1 rounded-xl bg-black/20 p-1">
      {centers.map((c) => (
        <Link key={c.m} href={c.href} className={opt(mode === c.m)}>
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
}: {
  children: React.ReactNode;
  managerName?: string;
  isAdmin?: boolean;
  isEmployee?: boolean;
}) {
  const pathname = usePathname();
  const mode: Mode = pathname.startsWith("/me")
    ? "employee"
    : pathname.startsWith("/my-branch")
      ? "manager"
      : pathname.startsWith("/management")
        ? "management"
        : pathname.startsWith("/fleet")
          ? "fleet"
          : "inventory";
  const items =
    mode === "employee" ? EMPLOYEE_NAV
      : mode === "manager" ? MANAGER_NAV
        : mode === "management" ? MANAGEMENT_NAV
          : mode === "fleet" ? FLEET_NAV
            : INVENTORY_NAV;
  // Employees have a single self-service area — no center switcher, no admin.
  const showCenters = !isEmployee;
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
          <span className="grid place-items-center h-9 w-9 rounded-xl bg-emerald-grad text-[#05271c] font-semibold shadow-lg shadow-brand-600/30">
            C
          </span>
          <div className="leading-tight">
            <div className="font-normal text-white tracking-tight">Clements</div>
            <div className="text-xs text-mint">Command &amp; Control</div>
          </div>
        </div>
        {showCenters ? (
          <div className="px-3 pt-3">
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
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-emerald-grad text-[#05271c] text-sm font-semibold">
            C
          </span>
          <span className="font-normal text-white tracking-tight">Clements</span>
          {showCenters ? <div className="ml-1"><ModeToggle mode={mode} compact /></div> : null}
          {isAdmin ? (
            <Link href="/manage" aria-label="Manage" className="ml-auto p-1 text-mint hover:text-white">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
              </svg>
            </Link>
          ) : null}
          <Link
            href="/help"
            aria-label="Help"
            className={`${isAdmin ? "" : "ml-auto"} p-1 text-mint hover:text-white`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="9" />
              <path d={HELP} strokeLinecap="round" />
            </svg>
          </Link>
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
    </div>
  );
}
