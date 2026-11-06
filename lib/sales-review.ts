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

// The quarterly scorecard metrics — grounded in the Director of Sales employment
// agreement (Howard Cohn, eff. 2026-08-03): the Quarterly Team Sales Bonus tiers,
// the base step-up milestone, and the Article 1.3 duties. Each is scored
// Met / Not met / N-A with a note by the reviewer. Weighted toward team build-out in
// year one — the agreement states meaningful bonus is not expected in Q1.
export const SALES_REVIEW_METRICS: ReviewMetric[] = [
  { key: "branch_tiers", label: "Branch sales vs bonus tiers (Stuart · Naples · Orlando)", target: "Each focus branch ≥ $50K/mo Total Branch Sales; stretch $65K / $80K", help: "Total Branch Sales = all new recurring + non-recurring sales at rate-card, per branch per month. The three focus markets drive the quarterly bonus (1.5% @ $50K+, 2% @ $65K+, 2.5% @ $80K+). Vero Beach is excluded from the bonus for now." },
  { key: "bonus", label: "Quarterly team-sales bonus earned", target: "On pace to the Year-1 target (~$20K–$25K/yr); minimal expected during Q1 build", help: "Sum of each participating branch's monthly tier % of Total Branch Sales, paid quarterly. Teams are being built in year one, so meaningful bonus ramps as branches reach the tiers." },
  { key: "step_up", label: "Producing-rep milestone (base step-up)", target: "Toward 5 reps each ≥ $30K/mo new recurring, 2 consecutive months", help: "The Step-Up Milestone: five sales reps concurrently producing ≥$30K/mo in gross new recurring revenue for two straight months. Track how many reps are at/above $30K/mo." },
  { key: "team_build", label: "Sales team build-out (focus markets)", target: "Recruiting, hiring & ramping advisors in Stuart, Naples, Orlando", help: "Building a producing sales team in the primary growth markets — recruiting, hiring, onboarding and ramping advisors (Article 1.1 / 1.3)." },
  { key: "pipeline_systems", label: "Pipeline, forecasting & accountability", target: "Sales process, KPIs, pipeline & forecasting in place and used; regular reporting", help: "Establishing and running sales processes, KPIs, pipeline management, forecasting, and accountability systems; regular reporting to executive leadership (Article 1.3.2 / 1.3.7)." },
  { key: "growth", label: "Profitable revenue growth across service lines", target: "Organic growth across GHP, L&O, termite and other lines", help: "Accelerating profitable organic revenue growth across all service lines, not one line only (Article 1.3.3)." },
  { key: "retention", label: "Customer retention / attrition", target: "Attrition reduced across markets", help: "Improving customer retention and reducing attrition across all markets (Article 1.3.6)." },
  { key: "pricing", label: "Pricing discipline & sales experience", target: "Rate-card pricing held; scopes standardized", help: "Standardizing scopes of service, holding rate-card pricing discipline, and a consistent customer sales experience (Article 1.3.4)." },
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
