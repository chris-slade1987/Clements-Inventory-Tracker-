import "server-only";
import { salesDirectorDashboard, currentPeriodKey } from "@/lib/sales";
import { branchLabel } from "@/lib/management";

// Quarterly Sales Director Review — the canonical template, drawn from the Sales
// Team section's own language (the advisor goal sheet's funnel + conversion rates
// and the director dashboard's team roll-ups): leads → ReIs/appointments →
// proposals → closed $, close rate, pipeline coverage, and goal-setting discipline.
// The review is OF the Sales Director (reviewer = COO), scored on the SALES TEAM'S
// quarterly performance plus leadership/process, mirroring how the manager
// quarterly scorecard reviews a branch manager on their branch's performance.
//
// This file is the template (pure data) + a live team snapshot that pre-fills the
// performance context. The page renders it; a director/COO fills Met-Not + notes
// and the narrative. (Persistence + e-signatures can be wired next, mirroring the
// manager scorecard's sign/finalize flow.)

export type ReviewMetric = {
  key: string;
  label: string;
  target: string;
  help: string;
};

// The intangibles — kept deliberately short. Howard's bonus is scored on the HARD
// branch sales data (the performance table at the top of the review); these are the
// few role-relevant intangibles that matter alongside it, from Article 1.3 of the
// Director of Sales agreement. Each is scored Strong / On track / Needs focus + a note.
export const SALES_REVIEW_METRICS: ReviewMetric[] = [
  { key: "team_build", label: "Sales team build-out & rep ramp", target: "Recruit, hire & ramp producing reps in Stuart, Naples, Orlando", help: "The year-one priority: build producing teams so the branches reach the bonus tiers. Most bonus-branch volume still comes from managers/Howard, with newer reps (Michael, Matthew) ramping. Tracks the step-up milestone (5 reps each ≥$30K/mo new recurring)." },
  { key: "pipeline_systems", label: "Pipeline, forecasting & accountability", target: "Sales process, KPIs, pipeline & forecasting in place and used; regular reporting", help: "Establishing and running sales processes, KPIs, pipeline management, forecasting, and accountability; regular reporting to executive leadership (Article 1.3.2 / 1.3.7)." },
  { key: "training_culture", label: "Team training, education & culture", target: "Ongoing rep training/coaching, skill development, and a strong team culture", help: "Investing in the sales team — structured training and product/sales education, skill development, and building a positive, high-accountability culture that keeps strong reps engaged." },
  { key: "pricing", label: "Pricing discipline & sales mix", target: "Rate-card pricing held; healthy recurring vs one-off mix", help: "Standardizing scopes, holding rate-card pricing, and watching the recurring base vs. large one-off jobs (e.g. the Naples bat-proofing deal) (Article 1.3.4)." },
];

// Contract facts that ground the review (from the Director of Sales agreement).
export const BONUS_TIERS = [
  { min: 80000, pct: 2.5 },
  { min: 65000, pct: 2.0 },
  { min: 50000, pct: 1.5 },
] as const;

export const BONUS_PARTICIPATING_BRANCHES = ["stuart", "naples", "orlando"] as const;

export const DIRECTOR_PROFILE = {
  name: "Howard Cohn",
  title: "Director of Sales",
  reportsTo: "Chief Operating Officer",
  effectiveDate: "August 3, 2026",
  bonusYear1Target: "~$20,000–$25,000 (Year 1)",
  stepUpMilestone: "5 reps each ≥ $30K/mo new recurring, 2 consecutive months (base $125K → $135K)",
  focusMarkets: ["Stuart", "Naples", "Orlando"],
  excludedMarket: "Vero Beach — established; added to the bonus later by mutual agreement",
};

/** The bonus tier a branch's monthly Total Branch Sales falls into (contract §3.3). */
export function bonusTierFor(monthlySales: number): { pct: number; label: string } {
  for (const t of BONUS_TIERS) if (monthlySales >= t.min) return { pct: t.pct, label: `${t.pct}%` };
  return { pct: 0, label: "0% (below $50K)" };
}

export type ReviewQuestion = { key: string; label: string; help?: string };
export type ReviewSection = { key: string; title: string; intro?: string; questions: ReviewQuestion[] };

// The notes section — the narrative wrap-up (the leadership items now live in the
// trimmed intangibles scorecard above).
export const SALES_REVIEW_SECTIONS: ReviewSection[] = [
  {
    key: "narrative",
    title: "Notes",
    questions: [
      { key: "strengths", label: "Strengths this quarter" },
      { key: "improve", label: "Areas to improve" },
      { key: "goals", label: "Goals & initiatives for next quarter" },
      { key: "director_comments", label: "Director's self-assessment / comments" },
      { key: "coo_notes", label: "COO summary & notes" },
    ],
  },
];

export const OVERALL_RATINGS = ["Exceeds", "Meets", "Below", "Needs improvement"] as const;

export type SalesReviewSnapshot = {
  periodKey: string;
  periodLabel: string;
  advisors: number;
  withGoal: number;
  teamTarget: number;
  closedYtd: number | null;
  pipeline: number | null;
  byBranch: { branch: string; label: string; advisors: number; withGoal: number; target: number; closed: number | null; participating: boolean }[];
  hasActuals: boolean;
};

// Live team context that pre-fills the performance section. Uses the latest month
// of the selected quarter that isn't in the future (closed/pipeline come from the
// latest connected sales snapshot, so they're labeled "current" in the UI).
export async function salesReviewSnapshot(year: number, quarter: number): Promise<SalesReviewSnapshot> {
  const lastMonth = quarter * 3; // Q1→3, Q2→6, Q3→9, Q4→12
  const nowKey = currentPeriodKey();
  let periodKey = `${year}-${String(lastMonth).padStart(2, "0")}`;
  if (periodKey > nowKey) periodKey = nowKey; // don't look into the future
  const d = await salesDirectorDashboard(periodKey);
  return {
    periodKey,
    periodLabel: `Q${quarter} ${year}`,
    advisors: d.totals.advisors,
    withGoal: d.totals.withGoal,
    teamTarget: d.totals.target,
    closedYtd: d.totals.closed ?? null,
    pipeline: d.totals.pipeline ?? null,
    byBranch: d.byBranch.map((b) => ({ branch: b.branch, label: branchLabel(b.branch), advisors: b.advisors, withGoal: b.withGoal, target: b.target, closed: b.closed ?? null, participating: (BONUS_PARTICIPATING_BRANCHES as readonly string[]).includes(b.branch) })),
    hasActuals: d.totals.closed != null,
  };
}
