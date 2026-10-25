import Link from "next/link";

// Reusable `?tab=` tab bar (brand-kit styled). Server component — plain Links that
// set `?tab=`, optionally preserving the selected month (`?p=`) across tabs so
// switching a tab doesn't reset the period. Only the tabs the viewer is entitled to
// are passed in. Used by the consolidated Executive dashboard (Overview · Branches ·
// Financials · Sales & Attrition) and the Compliance & Insurance center.
export default function ExecTabs({
  tabs,
  active,
  period,
  basePath = "/executive",
}: {
  tabs: { key: string; label: string }[];
  active: string;
  period?: string;
  basePath?: string;
}) {
  if (tabs.length <= 1) return null;
  const href = (key: string) => `${basePath}?tab=${key}${period ? `&p=${encodeURIComponent(period)}` : ""}`;
  return (
    <div className="mb-5 -mt-1 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={on ? "page" : undefined}
            className={`relative -mb-px rounded-t-lg px-4 py-2.5 text-sm font-light transition-colors ${
              on
                ? "border-b-2 border-brand-600 text-ink font-medium"
                : "text-muted hover:text-ink hover:bg-black/[0.03]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
