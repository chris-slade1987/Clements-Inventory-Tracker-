"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string };

const ALL_TABS: Tab[] = [
  { href: "/management/training-center/assign", label: "Assign" },
  { href: "/management/training", label: "Courses" },
  { href: "/management/certifications", label: "Certifications" },
  { href: "/management/training-center/reports", label: "Reports" },
];

/**
 * Shared tab strip across the Training Center hub (Assign · Courses ·
 * Certifications · Reports). Highlights the active tab by pathname. The Courses
 * tab is admin-only (that page is requireAdmin), so pass `showCourses={false}`
 * for non-admin HR / senior-leadership viewers.
 */
export default function TrainingCenterTabs({ showCourses = true }: { showCourses?: boolean }) {
  const pathname = usePathname();
  const tabs = ALL_TABS.filter((t) => showCourses || t.href !== "/management/training");

  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-white/60 p-1">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              active ? "bg-emerald-grad text-white shadow-sm" : "text-ink hover:bg-black/[0.04]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
