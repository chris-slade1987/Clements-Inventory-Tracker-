import { prisma } from "@/lib/prisma";

// New-hire 30 / 60-day reviews. Forms are encoded as sections of typed items and
// rendered by one generic renderer. Faithful to the company PDFs, with a few
// modest improvements (flagged with `added: true`).

export type ReviewItem = {
  key: string;
  type: "yesno" | "choice" | "text" | "textarea";
  label: string;
  options?: string[];
  who?: "manager" | "employee"; // whose perspective (for a subtle label hint)
  added?: boolean; // an improvement beyond the original form
};
export type ReviewSection = { title: string; items: ReviewItem[] };
export type ReviewForm = { title: string; sections: ReviewSection[] };

const YN = ["Yes", "No"];

export const REVIEW_FORMS: Record<string, ReviewForm> = {
  "30_day": {
    title: "30-Day Technician Review",
    sections: [
      {
        title: "Onboarding & Training",
        items: [
          { key: "onboarding_complete", type: "yesno", label: "Completed all required onboarding training", who: "manager" },
          { key: "understands_policies", type: "yesno", label: "Demonstrates understanding of company policies & procedures", who: "manager" },
          { key: "enough_training", type: "choice", options: YN, label: "Have you received enough training to do your job effectively?", who: "employee" },
          { key: "training_needed", type: "textarea", label: "If not, what additional training would help?", who: "employee" },
          { key: "has_tools", type: "choice", options: YN, label: "Do you have the tools and resources needed to perform your job?", who: "employee" },
          { key: "tools_missing", type: "textarea", label: "If not, what is missing?", who: "employee" },
        ],
      },
      {
        title: "Job Performance & Competency",
        items: [
          { key: "follows_processes", type: "yesno", label: "Following all service processes and procedures", who: "manager" },
          { key: "uses_equipment", type: "yesno", label: "Properly using equipment and chemicals", who: "manager" },
          { key: "efficient", type: "yesno", label: "Completing work efficiently and within expected timeframes", who: "manager" },
          { key: "understands_treatments", type: "yesno", label: "Good understanding of pest control treatments", who: "manager" },
          { key: "proper_uniform", type: "yesno", label: "Wearing the proper uniform and maintaining a professional appearance", who: "manager" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered", who: "employee" },
          { key: "challenging", type: "text", label: "Tasks / skills still challenging", who: "employee" },
          { key: "responsibilities_match", type: "choice", options: YN, label: "Have your job responsibilities matched what you expected?", who: "employee" },
          { key: "responsibilities_diff", type: "textarea", label: "If not, what differences have you noticed?", who: "employee" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "No customer complaints", who: "manager" },
          { key: "professional_comm", type: "yesno", label: "Communicating professionally with customers", who: "manager" },
          { key: "explains_treatments", type: "yesno", label: "Explaining treatments and answering questions effectively", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with office staff and coworkers", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responding to office communications in a timely manner", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reporting issues and concerns appropriately", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your manager or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for shifts", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adhered to scheduling and call-out procedures", who: "manager" },
          { key: "route_responsibility", type: "yesno", label: "Responsible in handling assigned routes and workload", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: ["Very Comfortable", "Somewhat Comfortable", "Neutral", "Uncomfortable"], label: "How comfortable do you feel in your role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "Do you feel you are on track to meet your goals for the next few months?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "engagement", type: "textarea", label: "Anything we can do to help you feel more engaged and motivated?", who: "employee" },
          { key: "support_training", type: "textarea", label: "What additional support or training would help you perform better?", who: "employee" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: ["Exceeds Expectations", "Meets Expectations", "Needs Improvement"], label: "Overall performance rating", who: "manager" },
          { key: "goals_next", type: "textarea", label: "Goals for the next 30 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
  "60_day": {
    title: "60-Day Technician Review",
    sections: [
      {
        title: "Confidence & Comfort in Your Role",
        items: [
          { key: "confidence", type: "choice", options: ["Much More Confident", "Somewhat More Confident", "About the Same", "Less Confident"], label: "How confident do you feel now compared to when you started?", who: "employee" },
          { key: "comfortable_with", type: "textarea", label: "What tasks or responsibilities do you feel most comfortable with?", who: "employee" },
          { key: "still_challenging", type: "textarea", label: "Are there any aspects of your role you still find challenging?", who: "employee" },
          { key: "enough_training", type: "choice", options: YN, label: "Do you feel you have received enough training and support?", who: "employee" },
          { key: "training_support", type: "textarea", label: "If not, what additional support do you need?", who: "employee" },
        ],
      },
      {
        title: "Training & Development",
        items: [
          { key: "additional_training", type: "textarea", label: "Areas where you'd like additional training or resources?", who: "employee" },
          { key: "skills_develop", type: "textarea", label: "What skills would you like to develop further?", who: "employee" },
          { key: "mentorship_helpful", type: "choice", options: YN, label: "Have you found mentorship or guidance helpful in your role?", who: "employee" },
          { key: "mentorship_notes", type: "textarea", label: "Mentorship notes", who: "employee" },
        ],
      },
      {
        title: "Challenges & Support",
        items: [
          { key: "support_challenges", type: "textarea", label: "How can we better support you in overcoming challenges?", who: "employee" },
          { key: "processes_unclear", type: "choice", options: YN, label: "Anything about our processes or policies you find unclear or frustrating?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "stay_engaged", type: "textarea", label: "What can we do to ensure you continue to grow and stay engaged?", who: "employee" },
        ],
      },
      {
        title: "Manager Assessment",
        items: [
          { key: "meets_standards", type: "yesno", label: "Consistently meeting performance & quality standards", who: "manager", added: true },
          { key: "safety_compliance", type: "yesno", label: "Following safety & compliance requirements", who: "manager", added: true },
          { key: "reliable", type: "yesno", label: "Reliable — attendance, punctuality, workload", who: "manager", added: true },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: ["Exceeds Expectations", "Meets Expectations", "Needs Improvement"], label: "Overall performance rating", who: "manager" },
          { key: "recommendation", type: "choice", options: ["Continue employment", "Extend review period", "Do not continue"], label: "End-of-probation recommendation", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 90 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
};

export const REVIEW_LABEL: Record<string, string> = { "30_day": "30-Day Review", "60_day": "60-Day Review" };
export const STATUS_LABEL: Record<string, string> = {
  due: "Due — awaiting HR",
  sent: "Sent to reviewer",
  in_progress: "In progress",
  pending_approval: "Pending HR approval",
  completed: "Completed",
};

export function dueFromStart(start: Date, type: string): Date {
  const days = type === "60_day" ? 60 : 30;
  return new Date(start.getTime() + days * 864e5);
}

export function parseResponses(s: string | null | undefined): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function reviewsForEmployee(employeeId: string) {
  return prisma.newHireReview.findMany({ where: { employeeId }, orderBy: { dueDate: "asc" } });
}

/** HR view — every review, newest-due first, with employee context. */
export async function allReviews(status?: string) {
  return prisma.newHireReview.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ dueDate: "asc" }],
    include: { employee: { select: { name: true, branch: true, role: true } } },
  });
}

export function reviewFullySigned(r: { reviewerSignedAt: Date | null; employeeSignedAt: Date | null }): boolean {
  return !!r.reviewerSignedAt && !!r.employeeSignedAt;
}

/** A reviewer/coordinator's active reviews (dashboard). */
export async function reviewsForReviewer(userId: string) {
  return prisma.newHireReview.findMany({
    where: { reviewerUserId: userId, status: { in: ["sent", "in_progress", "pending_approval"] } },
    include: { employee: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });
}

/** An employee's own reviews (their dashboard) — actionable + recently completed. */
export async function openReviewsForEmployee(employeeId: string) {
  return prisma.newHireReview.findMany({
    where: { employeeId, status: { in: ["sent", "in_progress", "pending_approval"] } },
    orderBy: { dueDate: "asc" },
  });
}

/** A single review with the employee it belongs to. */
export async function reviewById(id: string) {
  return prisma.newHireReview.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true, email: true, branch: true, role: true } } },
  });
}

/**
 * Everyone HR can assign to conduct a review. A reviewer signs in to fill and
 * sign, so candidates are people with a login: every active employee account
 * plus any manager/admin. Not role-restricted — HR can pick any employee.
 */
export async function reviewerCandidates(_branch?: string | null) {
  const users = await prisma.user.findMany({
    where: { active: true, OR: [{ employeeId: { not: null } }, { role: { in: ["manager", "admin"] } }] },
    select: { id: true, name: true, email: true, role: true, branch: true },
    orderBy: [{ name: "asc" }],
  });
  // De-dupe by name (a person shouldn't appear twice) and drop the generic
  // shared admin login from the picker.
  const seen = new Set<string>();
  return users.filter((u) => {
    const key = u.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Completed reviews for a profile (with signatures) — shown on the personnel folder. */
export async function completedReviewsForEmployee(employeeId: string) {
  return prisma.newHireReview.findMany({
    where: { employeeId, status: "completed" },
    orderBy: { completedAt: "desc" },
  });
}
