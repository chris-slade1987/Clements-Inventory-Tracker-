import "server-only";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import {
  SCORECARD_METRICS,
  buildScorecardRows,
  weightedScore,
  bonusEarned,
  matchBranchManagerEmployee,
  type ScorecardRow,
} from "@/lib/scorecard";

// Bulk "Prepare quarter" — draft every branch's manager scorecard for a quarter in
// one action, so the reviewer starts from the system's computed Met/Not instead of
// setting each metric by hand. NON-DESTRUCTIVE and safe to re-run:
//   • a branch whose review is archived (filed) or final (published, awaiting the
//     manager's signature) is left untouched and reported as skipped;
//   • a metric the reviewer has ALREADY marked (met != null) is never overwritten —
//     only still-blank metrics are filled from the auto-suggestion;
//   • placeholders / metrics with no suggestion (no data) are left blank for the
//     reviewer to handle.
// Nothing is published, signed, filed, or paid here — this only seeds draft values.

export type PrepareBranchResult = {
  branch: string;
  branchLabel: string;
  status: "prepared" | "skipped_archived" | "skipped_published";
  managerName: string | null;
  filled: number; // metrics auto-filled this run
  alreadySet: number; // metrics a reviewer had already marked (left as-is)
  needsReview: number; // metrics with no suggestion (placeholder / missing data)
  draftScore: number; // weighted score from the resulting Met/Not
  projectedBonus: number; // $ at that score
};

function fmtTarget(row: ScorecardRow): string | null {
  const t = row.budgetTarget;
  if (t == null) return null;
  if (row.unit === "usd") return `$${Math.round(t).toLocaleString()}`;
  if (row.unit === "pct") return `${Math.round(t * 10) / 10}%`;
  return Math.round(t).toLocaleString();
}

export async function prepareBranchQuarter(
  year: number,
  quarter: number,
  branch: string,
): Promise<PrepareBranchResult> {
  const label = branchLabel(branch);
  const existing = await prisma.scorecardReview.findUnique({
    where: { year_quarter_branch: { year, quarter, branch } },
    select: { id: true, status: true, managerName: true },
  });
  if (existing?.status === "archived")
    return { branch, branchLabel: label, status: "skipped_archived", managerName: existing.managerName, filled: 0, alreadySet: 0, needsReview: 0, draftScore: 0, projectedBonus: 0 };
  if (existing?.status === "final")
    return { branch, branchLabel: label, status: "skipped_published", managerName: existing.managerName, filled: 0, alreadySet: 0, needsReview: 0, draftScore: 0, projectedBonus: 0 };

  // Ensure a draft review exists, pre-filling the manager's name when we can resolve it.
  const mgr = await matchBranchManagerEmployee(branch);
  if (!existing) {
    await prisma.scorecardReview.create({
      data: { year, quarter, branch, status: "draft", managerName: mgr?.name ?? null },
    });
  } else if (!existing.managerName && mgr?.name) {
    await prisma.scorecardReview.update({ where: { id: existing.id }, data: { managerName: mgr.name } });
  }

  const rows = await buildScorecardRows(year, quarter, branch);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  let filled = 0;
  let alreadySet = 0;
  let needsReview = 0;
  for (const m of SCORECARD_METRICS) {
    const row = rowByKey.get(m.key);
    if (!row) continue;
    if (row.met != null) { alreadySet++; continue; } // reviewer already marked it — never clobber
    if (row.suggested == null) { needsReview++; continue; } // placeholder / no data — leave for the reviewer
    await prisma.scorecardResult.upsert({
      where: { year_quarter_branch_metricKey: { year, quarter, branch, metricKey: m.key } },
      create: { year, quarter, branch, metricKey: m.key, met: row.suggested, target: fmtTarget(row) },
      update: { met: row.suggested, target: fmtTarget(row) },
    });
    filled++;
  }

  // Draft score from the resulting Met/Not (saved + just-filled).
  const metState: Record<string, boolean | null> = {};
  for (const m of SCORECARD_METRICS) {
    const row = rowByKey.get(m.key);
    metState[m.key] = row?.met != null ? row.met : (row?.suggested ?? null);
  }
  const draftScore = weightedScore(metState);

  return {
    branch,
    branchLabel: label,
    status: "prepared",
    managerName: mgr?.name ?? existing?.managerName ?? null,
    filled,
    alreadySet,
    needsReview,
    draftScore,
    projectedBonus: bonusEarned(draftScore),
  };
}

/** Prepare every branch for the quarter. Returns a per-branch summary. */
export async function prepareQuarter(year: number, quarter: number): Promise<PrepareBranchResult[]> {
  const out: PrepareBranchResult[] = [];
  for (const b of BRANCHES) out.push(await prepareBranchQuarter(year, quarter, b.key));
  return out;
}
