import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import {
  SCORECARD_METRICS,
  autoActuals,
  savedResults,
  suggestMet,
} from "@/lib/scorecard";
import { listPeriods } from "@/lib/management";
import ScorecardClient from "./ScorecardClient";

export const dynamic = "force-dynamic";

export default async function ScorecardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const periods = await listPeriods();
  const years = Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => b - a);
  if (years.length === 0) {
    return (
      <>
        <PageHeader title="Manager Scorecards" subtitle="Quarterly branch-manager review" />
        <EmptyState title="No report data yet" hint="Upload a Monthly Board Report so scorecard metrics can be scored." />
      </>
    );
  }

  const year = Number(sp.year) || years[0];
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : 2;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? BRANCHES[0].key;

  const [auto, saved] = await Promise.all([
    autoActuals(year, quarter, branch),
    savedResults(year, quarter, branch),
  ]);

  // Build the row model the client renders/edits.
  const rows = SCORECARD_METRICS.map((m) => {
    const a = auto[m.key];
    const savedRow = saved[m.key] ?? { target: null, met: null, note: null };
    // Target: reviewer-entered wins; else the budget from reports (auto).
    const budgetTarget = a?.budget ?? null;
    const suggested = m.type === "auto" ? suggestMet(m.direction, a?.actual ?? null, budgetTarget) : null;
    return {
      key: m.key,
      label: m.label,
      weight: m.weight,
      type: m.type,
      unit: a?.unit ?? m.unit ?? null,
      actual: a?.actual ?? null,
      budgetTarget,
      target: savedRow.target,
      met: savedRow.met,
      note: savedRow.note,
      suggested,
    };
  });

  return (
    <>
      <PageHeader
        title="Manager Scorecards"
        subtitle="Quarterly branch-manager review · binary Met / Not-Met, weighted to 100%"
      />
      <ScorecardClient
        year={year}
        quarter={quarter}
        branch={branch}
        years={years}
        branches={BRANCHES.map((b) => ({ key: b.key, label: b.label }))}
        rows={rows}
        canEdit={user.role === "admin"}
      />
    </>
  );
}
