"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
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

export default function AppShell({
  children,
  managerName,
}: {
  children: React.ReactNode;
  managerName?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r border-line bg-surface">
        <div className="flex items-center gap-2 px-5 h-16 border-b border-line">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-600 text-white font-bold">
            C
          </span>
          <div className="leading-tight">
            <div className="font-semibold text-ink">Clements</div>
            <div className="text-xs text-muted">Inventory</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                }`}
              >
                <Icon path={item.icon} className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-2">
          <Link
            href="/help"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive(pathname, "/help")
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-ink"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 013.9-1.9c1.2.8 1.1 2.3 0 3.1-.7.5-1.4.9-1.4 1.8M12 17h.01" strokeLinecap="round" />
            </svg>
            Help
          </Link>
        </div>
        {managerName ? (
          <div className="border-t border-line px-4 py-3">
            <div className="text-xs text-muted">Signed in as</div>
            <div className="text-sm font-medium text-ink truncate">
              {managerName}
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="mt-2 text-xs font-medium text-brand-700 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </aside>

      {/* Main column */}
      <div className="flex-1 md:pl-60 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-2 h-14 px-4 bg-surface border-b border-line">
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-brand-600 text-white text-sm font-bold">
            C
          </span>
          <span className="font-semibold">Clements Inventory</span>
          <Link
            href="/help"
            aria-label="Help"
            className="ml-auto p-1 text-slate-500 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 013.9-1.9c1.2.8 1.1 2.3 0 3.1-.7.5-1.4.9-1.4 1.8M12 17h.01" strokeLinecap="round" />
            </svg>
          </Link>
        </header>

        <main className="flex-1 px-4 py-5 md:px-8 md:py-8 pb-24 md:pb-8 max-w-5xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-surface border-t border-line grid grid-cols-6">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                active ? "text-brand-700" : "text-slate-500"
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
