"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Horizontal sub-navigation for the Check-Out / inventory area. Admin-only
// tabs (Labels, Catalog) are rendered only for admins. Mobile-first: scrolls
// horizontally with large tap targets.
const TABS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/check-out", label: "Check-Out" },
  { href: "/inventory/history", label: "History" },
  { href: "/inventory/stock", label: "Stock" },
  { href: "/inventory/stock-count", label: "Stock Count" },
  { href: "/inventory/photos", label: "Photo Catalog" },
  { href: "/inventory/labels", label: "Labels", adminOnly: true },
  { href: "/inventory/catalog", label: "Catalog", adminOnly: true },
];

export default function InventorySubnav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  return (
    <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-emerald-grad text-white shadow-sm"
                : "surface-light border border-line text-ink hover:bg-[#eef5f0]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
