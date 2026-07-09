"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manage/products", label: "Products" },
  { href: "/manage/technicians", label: "Technicians" },
  { href: "/manage/managers", label: "Managers" },
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
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
