import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel, listPeriods } from "@/lib/management";
import { buildScorecardRows, getScorecardReview, matchBranchManagerEmployee } from "@/lib/scorecard";
import ScorecardClient, { type ReviewSerialized } from "@/app/(app)/management/scorecards/ScorecardClient";

function serializeReview(r: Awaited<ReturnType<typeof getScorecardReview>>): ReviewSerialized | null {
  if (!r) return null;
  return {
    status: r.status,
    managerName: r.managerName,
    reviewerName: r.reviewerName,
    reviewDate: r.reviewDate ? r.reviewDate.toISOString() : null,
    overallNotes: r.overallNotes,
    strengths: r.strengths,
    areas: r.areas,
    goals: r.goals,
    score: r.score,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
    reopenedAt: r.reopenedAt ? r.reopenedAt.toISOString() : null,
    reopenedBy: r.reopenedBy,
    personnelRecordId: r.personnelRecordId,
    signatures: r.signatures.map((s) => ({ id: s.id, role: s.role, typedName: s.typedName, title: s.title, signedAt: s.signedAt.toISOString() })),
  };
}

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

  const [rows, review, mgr] = await Promise.all([
    buildScorecardRows(year, quarter, branch),
    getScorecardReview(year, quarter, branch),
    matchBranchManagerEmployee(branch),
  ]);

  return (
    <>
      <PageHeader title="My Scorecard" subtitle={`${branchLabel(branch)} · Q${quarter} ${year} — binary Met / Not-Met, weighted to 100%`} />
      <ScorecardClient
        year={year}
        quarter={quarter}
        branch={branch}
        branchLabel={branchLabel(branch)}
        years={years.length ? years : [year]}
        branches={[{ key: branch, label: branchLabel(branch) }]}
        rows={rows}
        canEdit={user.role === "admin"}
        canSign={user.role === "admin" || user.role === "manager"}
        canFinalize={user.role === "admin"}
        review={serializeReview(review)}
        suggestedManagerName={mgr?.name ?? ""}
        basePath="/my-branch/scorecard"
      />
    </>
  );
}
