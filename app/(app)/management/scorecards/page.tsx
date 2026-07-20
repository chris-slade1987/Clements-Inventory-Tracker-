import { PageHeader, EmptyState } from "@/components/ui";
import { redirect } from "next/navigation";
import { requireUser, isBoardObserver, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { buildScorecardRows } from "@/lib/scorecard";
import { listPeriods } from "@/lib/management";
import ScorecardClient from "./ScorecardClient";

export const dynamic = "force-dynamic";

export default async function ScorecardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
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
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const locked = branchLocked(user);
  const branch = scopedBranch(user, requested) ?? BRANCHES[0].key;
  // Branch managers only see their own branch in the selector.
  const visibleBranches = locked ? BRANCHES.filter((b) => b.key === branch) : BRANCHES;

  const rows = await buildScorecardRows(year, quarter, branch);

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
        branches={visibleBranches.map((b) => ({ key: b.key, label: b.label }))}
        rows={rows}
        canEdit={user.role === "admin"}
      />
    </>
  );
}
