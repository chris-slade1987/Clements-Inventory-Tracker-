import Link from "next/link";

// Tabs across the Scorecards hub. Overview + Sales Director are super-admin only;
// everyone else who can reach Scorecards sees just the branch-manager scorecards
// (and no tab bar at all, since there'd be one tab).
export default function ScorecardTabs({
  active,
  isSuper,
  year,
  quarter,
}: {
  active: "overview" | "branch" | "sales-director";
  isSuper: boolean;
  year?: number;
  quarter?: number;
}) {
  if (!isSuper) return null;
  const q = year && quarter ? `?year=${year}&quarter=${quarter}` : "";
  const tabs = [
    { key: "overview", label: "Overview", href: `/management/scorecards/overview${q}` },
    { key: "branch", label: "Branch Managers", href: `/management/scorecards${q ? `${q}&view=branch` : "?view=branch"}` },
    { key: "sales-director", label: "Sales Director", href: `/management/scorecards/sales-director${q}` },
  ] as const;
  return (
    <div className="mb-4 flex w-fit flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1 print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-lg px-4 py-2 text-sm transition ${t.key === active ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
