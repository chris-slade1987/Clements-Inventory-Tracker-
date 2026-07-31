"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inventory catalog tabs, in workflow order. These are the everyday screens.
const CATALOG_TABS = [
  { href: "/manage/products", label: "Products" },
  { href: "/manage/inventory", label: "Stock Import" },
  { href: "/manage/confirm", label: "Confirm Queue" },
  { href: "/manage/technicians", label: "Technicians" },
];
// User & role administration — de-emphasized settings link, not a catalog tab.
const USERS_ACCESS = { href: "/manage/managers", label: "Users & Access" };

export default function ManageTabs({
  isAdmin = true,
  toConfirm = 0,
}: {
  isAdmin?: boolean;
  toConfirm?: number;
}) {
  const pathname = usePathname();
  // Admins get every catalog tab; HR-only users see just the confirm queue.
  const tabs = isAdmin
    ? CATALOG_TABS
    : CATALOG_TABS.filter((t) => t.href === "/manage/confirm");
  return (
    <div className="mb-4 flex items-center gap-1 border-b border-line overflow-x-auto">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        const isConfirm = t.href === "/manage/confirm";
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              active
                ? "border-white text-white"
                : "border-transparent text-mint hover:text-white"
            }`}
          >
            {t.label}
            {isConfirm && toConfirm > 0 ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {toConfirm}
              </span>
            ) : null}
          </Link>
        );
      })}
      {isAdmin ? (
        <Link
          href={USERS_ACCESS.href}
          title="Login accounts, roles, and branch access"
          className={`ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            pathname.startsWith(USERS_ACCESS.href)
              ? "bg-white/10 text-white"
              : "text-mint/80 hover:bg-white/5 hover:text-white"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V5l7-3zM12 11a2 2 0 100-4 2 2 0 000 4zm-3.2 5a3.2 3.2 0 016.4 0" />
          </svg>
          {USERS_ACCESS.label}
        </Link>
      ) : null}
    </div>
  );
}
