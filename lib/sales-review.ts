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

// The quarterly scorecard metrics — the measurable half, in the Sales section's
// vocabulary. Each is scored Met / Not met / N-A with a note by the reviewer.
export const SALES_REVIEW_METRICS: ReviewMetric[] = [
  { key: "attainment", label: "Team sales attainment", target: "≥ 100% of the combined team goal", help: "Total $ closed by the team vs. the sum of the advisors' monthly goals across the quarter." },
  { key: "close_rate", label: "Team closing rate", target: "≥ the benchmark set with the COO", help: "Total $ sold ÷ total exposure (PC + TC), averaged across the team — the goal sheet's total closing %." },
  { key: "pipeline", label: "Pipeline coverage", target: "Open pipeline ≥ 1.5× next month's team goal", help: "Enough live exposure in the funnel to cover the upcoming goal, so the quarter doesn't start cold." },
  { key: "goal_discipline", label: "Goal-setting discipline", target: "100% of advisors set & agree a goal every month", help: "Every service advisor has a monthly goal sheet set and agreed (not left blank) each month of the quarter." },
  { key: "conversion", label: "Lead → proposal conversion", target: "≥ the prior quarter's rate", help: "Proposals per prospect (ReIs + appointments) for the team — are leads being turned into proposals." },
  { key: "production", label: "Termite units / new agreements", target: "≥ plan", help: "TC units sold and new recurring agreements vs. the planned run-rate." },
  { key: "development", label: "Advisor development", target: "Most advisors improving quarter-over-quarter; ride-alongs done", help: "Coaching is moving the needle — advisors' close rate / attainment trending up, ride-alongs completed." },
];

export type ReviewQuestion = { key: string; label: string; help?: string };
export type ReviewSection = { key: string; title: string; intro?: string; questions: ReviewQuestion[] };

// The qualitative half — leadership & process, then the narrative wrap-up.
export const SALES_REVIEW_SECTIONS: ReviewSection[] = [
  {
    key: "leadership",
    title: "Leadership & process",
    intro: "How the director is running the sales operation this quarter.",
    questions: [
      { key: "coaching", label: "Coaching cadence", help: "1:1s, ride-alongs, and goal reviews actually happening on schedule." },
      { key: "retention", label: "Hiring & retention", help: "Advisor staffing, ramp of new advisors, and retention of strong performers." },
      { key: "marketing", label: "Marketing & lead quality", help: "Channel performance and lead quality managed (company-provided vs. self-generated)." },
      { key: "process", label: "Process adherence", help: "Goal sheets completed on time, funnel kept clean, SmarterLaunch readiness." },
    ],
  },
  {
    key: "narrative",
    title: "Summary & goals",
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
  byBranch: { branch: string; label: string; advisors: number; withGoal: number; target: number; closed: number | null }[];
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
    byBranch: d.byBranch.map((b) => ({ branch: b.branch, label: branchLabel(b.branch), advisors: b.advisors, withGoal: b.withGoal, target: b.target, closed: b.closed ?? null })),
    hasActuals: d.totals.closed != null,
  };
}
