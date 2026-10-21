"use client";

import { useState } from "react";

// Tab switcher for the Catalog Review screen. Server builds each panel; this just
// toggles which one shows, with a count badge per tab.
export default function ReviewTabs({
  tabs,
}: {
  tabs: { key: string; label: string; count: number; node: React.ReactNode }[];
}) {
  const first = tabs.find((t) => t.count > 0)?.key ?? tabs[0]?.key ?? "";
  const [active, setActive] = useState(first);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <>
      <div className="mb-4 flex items-center gap-1 border-b border-line overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              active === t.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count > 0 ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{t.count}</span>
            ) : null}
          </button>
        ))}
      </div>
      {current?.node}
    </>
  );
}
