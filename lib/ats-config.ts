// Client-safe ATS constants, types, and pure helpers. NO prisma / server
// imports here so both server code (lib/ats.ts) and client components (the
// scorecard form, candidate actions) can share one source of truth. The
// server-only DB/email helpers live in lib/ats.ts and re-export from here.

// ---- Scorecard template ----------------------------------------------------

export type RatingLevel = { value: number; label: string };

export const RATING_SCALE: RatingLevel[] = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Below expectations" },
  { value: 3, label: "Meets" },
  { value: 4, label: "Exceeds" },
  { value: 5, label: "Outstanding" },
];

export type Competency = { key: string; label: string; question: string };
export type BasicsCheck = { key: string; label: string };

export type RecommendationKey = "strong_yes" | "yes" | "lean_yes" | "lean_no" | "no";

export const RECOMMENDATION_LABELS: Record<RecommendationKey, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  lean_yes: "Lean yes",
  lean_no: "Lean no",
  no: "No",
};

export const RECOMMENDATION_ORDER: RecommendationKey[] = ["strong_yes", "yes", "lean_yes", "lean_no", "no"];

export type InterviewTemplate = {
  ratingScale: RatingLevel[];
  competencies: Competency[];
  basics: BasicsCheck[];
};

// General-purpose interview scorecard — works across roles (role-specific sets
// are a future v2).
export const INTERVIEW_TEMPLATE: InterviewTemplate = {
  ratingScale: RATING_SCALE,
  competencies: [
    {
      key: "reliability",
      label: "Reliability & work ethic",
      question:
        "Tell me about a time you had to show up and perform under tough conditions (bad weather, a long day, short-staffed). How did you handle it?",
    },
    {
      key: "customer",
      label: "Customer service & communication",
      question:
        "Describe a time you dealt with an upset or difficult customer. What did you do and how did it end?",
    },
    {
      key: "detail",
      label: "Attention to detail & follow-through",
      question:
        "Give an example of a job where being thorough really mattered. How do you make sure nothing gets missed?",
    },
    {
      key: "safety",
      label: "Safety & compliance mindset",
      question:
        "How do you approach following rules and procedures even when no one is watching? Any experience with safety protocols or regulated work?",
    },
    {
      key: "problem",
      label: "Problem-solving & adaptability",
      question: "Tell me about a problem you solved on your own when things didn't go as planned.",
    },
    {
      key: "teamwork",
      label: "Teamwork & coachability",
      question: "Describe a time you got tough feedback. How did you respond?",
    },
    {
      key: "professional",
      label: "Professionalism & driving",
      question:
        "You'd represent Clements in a branded truck at customers' homes and businesses. What does being professional on the road and on-site mean to you? (Any driving record concerns?)",
    },
    {
      key: "motivation",
      label: "Motivation & role fit",
      question: "Why this role, and why Clements? Where do you want to grow?",
    },
  ],
  basics: [
    { key: "license", label: "Valid driver's license" },
    { key: "physical", label: "Comfortable with outdoor / physical work (lifting ~50 lb)" },
    { key: "transportation", label: "Reliable transportation" },
    { key: "schedule", label: "Available for the required schedule" },
    { key: "screening", label: "Aware of the pre-employment drug screen + background check" },
  ],
};

export const BASICS_OPTIONS = ["yes", "no", "unsure"] as const;
export const BASICS_LABELS: Record<string, string> = { yes: "Yes", no: "No", unsure: "Unsure" };

// ---- Scorecard responses shape --------------------------------------------

export type CompetencyResponse = { rating?: number | null; notes?: string };
export type ScorecardResponses = {
  competencies?: Record<string, CompetencyResponse>;
  basics?: Record<string, string>;
};

// ---- Stage / status labels -------------------------------------------------

export const STAGE_ORDER = [
  "applied",
  "screening",
  "interviewing",
  "offer",
  "onboarding",
  "hired",
  "rejected",
] as const;
export type Stage = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  onboarding: "Onboarding",
  hired: "Hired",
  rejected: "Rejected",
};

// Active pipeline stages (exclude terminal states) for grouped views.
export const PIPELINE_STAGES: Stage[] = ["applied", "screening", "interviewing", "offer", "onboarding"];

export const JOB_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  on_hold: "On hold",
  filled: "Filled",
  closed: "Closed",
};

export const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  in_person: "In person",
  video: "Video",
};

// ---- Pure validation -------------------------------------------------------

function normRating(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
}

export function normalizeRecommendation(v: unknown): RecommendationKey | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && (RECOMMENDATION_ORDER as string[]).includes(s) ? (s as RecommendationKey) : null;
}

/**
 * Validate the scorecard is complete: EVERY competency has a 1-5 rating, a
 * recommendation is chosen, and the summary is non-empty. Returns the list of
 * missing items (empty = valid). Shared by the client form and the server.
 */
export function validateScorecard(data: {
  responses: ScorecardResponses;
  overallRating?: number | null;
  recommendation?: string | null;
  summary?: string | null;
}): string[] {
  const missing: string[] = [];
  const comps = data.responses.competencies ?? {};
  for (const c of INTERVIEW_TEMPLATE.competencies) {
    if (normRating(comps[c.key]?.rating) == null) missing.push(`${c.label}: rating`);
  }
  if (!normalizeRecommendation(data.recommendation)) missing.push("Overall recommendation");
  if (!(typeof data.summary === "string" && data.summary.trim())) missing.push("Summary");
  return missing;
}
