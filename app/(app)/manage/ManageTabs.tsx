"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manage/products", label: "Products" },
  { href: "/manage/technicians", label: "Employees" },
  { href: "/manage/managers", label: "Managers" },
  { href: "/manage/inventory", label: "Stock import" },
];

export default function ManageTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-4 flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              active
                ? "border-white text-white"
                : "border-transparent text-mint hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
