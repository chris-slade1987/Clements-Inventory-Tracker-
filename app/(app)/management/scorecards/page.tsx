import { PageHeader, EmptyState } from "@/components/ui";
import { redirect } from "next/navigation";
import { requireUser, isBoardObserver, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { buildScorecardRows, getScorecardReview, listArchivedReviews, matchBranchManagerEmployee } from "@/lib/scorecard";
import { listPeriods } from "@/lib/management";
import ScorecardClient, { type ReviewSerialized, type ArchivedLite } from "./ScorecardClient";

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

  const [rows, review, archivedRows, mgr] = await Promise.all([
    buildScorecardRows(year, quarter, branch),
    getScorecardReview(year, quarter, branch),
    listArchivedReviews(visibleBranches.map((b) => b.key)),
    matchBranchManagerEmployee(branch),
  ]);

  const archived: ArchivedLite[] = archivedRows.map((a) => ({
    year: a.year, quarter: a.quarter, branch: a.branch, branchLabel: branchLabel(a.branch),
    score: a.score, archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
  }));

  return (
    <>
      <PageHeader
        title="Manager Scorecards"
        subtitle="Quarterly branch-manager review · fill-out → triple sign-off → file to personnel record → archive"
      />
      <ScorecardClient
        year={year}
        quarter={quarter}
        branch={branch}
        branchLabel={branchLabel(branch)}
        years={years}
        branches={visibleBranches.map((b) => ({ key: b.key, label: b.label }))}
        rows={rows}
        canEdit={user.role === "admin"}
        canSign={user.role === "admin" || user.role === "manager"}
        canFinalize={user.role === "admin"}
        review={serializeReview(review)}
        archived={archived}
        suggestedManagerName={mgr?.name ?? ""}
      />
    </>
  );
}
