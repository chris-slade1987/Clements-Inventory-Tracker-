"use client";

import { useState } from "react";
import OrgChart, { type OrgChartProps } from "@/components/OrgChart";
import OrgChartClient, { type OrgEmployee } from "./OrgChartClient";

// HR-console wrapper around the shared Org Chart (Round 2). Presents the rich,
// company-readable reporting chart (square tiles + search + scoped tile editing)
// as the primary view, and — for super admins who may manage reporting lines and
// access levels — a second "Structure & access" tab that keeps the legacy
// reports-to / access-level / grant-login editor.
export default function OrgConsole({
  chart,
  employees,
  canEditLevels,
}: {
  chart: OrgChartProps;
  employees: OrgEmployee[];
  canEditLevels: boolean;
}) {
  const [tab, setTab] = useState<"chart" | "structure">("chart");

  if (!canEditLevels) return <OrgChart {...chart} />;

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setTab("chart")}
          aria-current={tab === "chart" ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tab === "chart" ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}
        >
          Org Chart
        </button>
        <button
          type="button"
          onClick={() => setTab("structure")}
          aria-current={tab === "structure" ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tab === "structure" ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}
        >
          Structure &amp; access
        </button>
      </div>

      {tab === "chart" ? (
        <OrgChart {...chart} />
      ) : (
        <OrgChartClient employees={employees} canEditLevels={canEditLevels} />
      )}
    </div>
  );
}
