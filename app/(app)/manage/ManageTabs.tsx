"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_TABS = [
  { href: "/manage/products", label: "Products" },
  { href: "/manage/technicians", label: "Employees" },
  { href: "/manage/managers", label: "Managers" },
  { href: "/manage/inventory", label: "Stock import" },
];
const CONFIRM_TAB = { href: "/manage/confirm", label: "Confirm queue" };

export default function ManageTabs({
  isAdmin = true,
  toConfirm = 0,
}: {
  isAdmin?: boolean;
  toConfirm?: number;
}) {
  const pathname = usePathname();
  // Admins see every tab; HR-only users see just the confirm queue.
  const tabs = isAdmin ? [...ADMIN_TABS, CONFIRM_TAB] : [CONFIRM_TAB];
  return (
    <div className="mb-4 flex gap-1 border-b border-line overflow-x-auto">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        const isConfirm = t.href === CONFIRM_TAB.href;
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
    </div>
  );
}
