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

// The four response types a Hiring Template question can carry. Interview
// templates render rating_1_5 as a rated competency and basics_yesno_unsure as
// a basics check; free-text / yes-no questions render in an "Additional
// questions" section. Screening templates use all four.
export type ResponseType = "rating_1_5" | "yes_no" | "text" | "basics_yesno_unsure";

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  rating_1_5: "Rating (1–5)",
  yes_no: "Yes / No",
  text: "Free text",
  basics_yesno_unsure: "Basics (Yes / No / Unsure)",
};

export function isResponseType(v: unknown): v is ResponseType {
  return v === "rating_1_5" || v === "yes_no" || v === "text" || v === "basics_yesno_unsure";
}

// An extra (non-competency, non-basics) question rendered on the interview form
// — a free-text or yes/no prompt that came from a template. Answers are stored
// in ScorecardResponses.extras keyed by the question id.
export type ExtraQuestion = { key: string; label: string; responseType: "text" | "yes_no" };

export type InterviewTemplate = {
  // Present when the template is DB-driven (from the Hiring Template Library);
  // null for the legacy hardcoded questionnaire.
  id?: string | null;
  name?: string | null;
  ratingScale: RatingLevel[];
  competencies: Competency[];
  basics: BasicsCheck[];
  extras?: ExtraQuestion[];
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
  // Answers to template-driven free-text / yes-no "extra" questions, keyed by
  // question id. Optional — never part of validateScorecard.
  extras?: Record<string, string>;
  // Two OPTIONAL subjective free-text sections the interviewer fills in for
  // later reference (not part of validateScorecard — never block submission).
  impressions?: string; // "Overall impressions & culture fit"
  additional?: string; // "Additional comments for the hiring decision"
};

// ---- Screening-call responses ----------------------------------------------
// The HR screening call renders its assigned template's questions; answers are
// stored keyed by question id. rating_1_5 → number; yes_no → "yes"/"no";
// text → string. Kept alongside the free-text screeningNotes (red-flag notes).
export type ScreeningResponses = Record<string, string | number | null>;

// ---- Stage / status labels -------------------------------------------------

export const STAGE_ORDER = [
  "applied",
  "screening",
  "interviewing",
  "ranked",
  "selected",
  "pre_hire",
  "offer",
  "onboarding",
  "hired",
  "excluded",
  "rejected",
] as const;
export type Stage = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interview",
  ranked: "Ranked",
  selected: "Selected",
  pre_hire: "Pre-hire",
  offer: "Offer",
  onboarding: "Onboarding",
  hired: "Hired",
  excluded: "Excluded",
  rejected: "Excluded",
};

// The canonical, ordered pipeline this build surfaces on the job container
// (grouped, current-stage-always-visible). Terminal states are handled apart.
export const PIPELINE_STAGE_FLOW: Stage[] = [
  "applied",
  "screening",
  "interviewing",
  "ranked",
  "selected",
  "pre_hire",
];

// Terminal excluded states — "rejected" is retained as a legacy alias of
// "excluded" so any pre-existing rows still read as excluded.
export const EXCLUDED_STAGES = ["excluded", "rejected"] as const;
export function isExcludedStage(stage: string): boolean {
  return (EXCLUDED_STAGES as readonly string[]).includes(stage);
}

// Active pipeline stages (exclude terminal states) for legacy grouped views.
export const PIPELINE_STAGES: Stage[] = ["applied", "screening", "interviewing", "offer", "onboarding"];

// ---- Stage-specific exclusion reasons --------------------------------------
// The exclude control offers ONLY the reasons that make sense at the stage the
// candidate is being cut from. "Other" always requires a note. "Not selected"
// is the runner-up case at the interview stage (used by the selection flow).

export type ExclusionGroup = "application" | "screening" | "interview";

export const EXCLUSION_REASONS: Record<ExclusionGroup, string[]> = {
  application: [
    "Insufficient experience",
    "Missing/incomplete documentation",
    "Not a good fit",
    "Compensation mismatch",
    "Position filled",
    "Other",
  ],
  screening: [
    "Did not pass screening",
    "Availability mismatch",
    "Compensation mismatch",
    "Not a good fit (post-call)",
    "Withdrew",
    "Unresponsive",
    "Other",
  ],
  interview: [
    "No-show",
    "Weak interview",
    "Not a good fit",
    "Withdrew",
    "Accepted another offer",
    "Not selected",
    "Other",
  ],
};

/** Map a candidate's current pipeline stage to the exclusion reason group. */
export function exclusionGroupForStage(stage: string): ExclusionGroup {
  if (stage === "applied") return "application";
  if (stage === "screening") return "screening";
  // interviewing / ranked / selected all cut with the interview reason set.
  return "interview";
}

/** The reason list to show when excluding a candidate at their current stage. */
export function exclusionReasonsForStage(stage: string): string[] {
  return EXCLUSION_REASONS[exclusionGroupForStage(stage)];
}

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
 *
 * The `template` defaults to the legacy hardcoded questionnaire; pass the job's
 * assigned template so the required competencies match what the form rendered.
 */
export function validateScorecard(
  data: {
    responses: ScorecardResponses;
    overallRating?: number | null;
    recommendation?: string | null;
    summary?: string | null;
  },
  template: InterviewTemplate = INTERVIEW_TEMPLATE,
): string[] {
  const missing: string[] = [];
  const comps = data.responses.competencies ?? {};
  for (const c of template.competencies) {
    if (normRating(comps[c.key]?.rating) == null) missing.push(`${c.label}: rating`);
  }
  if (!normalizeRecommendation(data.recommendation)) missing.push("Overall recommendation");
  if (!(typeof data.summary === "string" && data.summary.trim())) missing.push("Summary");
  return missing;
}
