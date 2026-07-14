import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods } from "@/lib/management";
import { buildScorecardRows } from "@/lib/scorecard";
import ScorecardClient from "@/app/(app)/management/scorecards/ScorecardClient";

export const dynamic = "force-dynamic";

// A branch manager's own quarterly scorecard — read-only, pinned to their
// branch. Reuses the same row-builder + client as the admin scorecard.
export default async function MyScorecardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const periods = await listPeriods();
  const years = Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => b - a);
  const now = new Date();
  const year = Number(sp.year) || years[0] || now.getFullYear();
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : Math.floor(now.getMonth() / 3) + 1;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null) ?? BRANCHES[0].key;

  if (years.length === 0) {
    return (
      <>
        <PageHeader title="My Scorecard" subtitle={`${branchLabel(branch)} · quarterly review`} />
        <EmptyState title="No report data yet" hint="Scorecard metrics populate once Monthly Board Reports are uploaded." />
      </>
    );
  }

  const rows = await buildScorecardRows(year, quarter, branch);

  return (
    <>
      <PageHeader title="My Scorecard" subtitle={`${branchLabel(branch)} · Q${quarter} ${year} — binary Met / Not-Met, weighted to 100%`} />
      <ScorecardClient
        year={year}
        quarter={quarter}
        branch={branch}
        years={years.length ? years : [year]}
        branches={[{ key: branch, label: branchLabel(branch) }]}
        rows={rows}
        canEdit={user.role === "admin"}
        basePath="/my-branch/scorecard"
      />
    </>
  );
}
