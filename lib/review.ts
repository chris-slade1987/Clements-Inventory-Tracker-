import { appUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { branchLabel } from "@/lib/management";
import { REVIEW_LABEL } from "@/lib/review-forms";

// New-hire 30 / 60-day reviews — server side. The role-specific FORMS and the
// pure helpers that both server and client share live in `lib/review-forms.ts`
// (client-safe: no server imports). This module re-exports them so existing
// `@/lib/review` imports keep working, and adds the Prisma queries + email.

export * from "@/lib/review-forms";

/**
 * Send the "review assigned" notifications — the reviewer (in-app link) and the
 * employee (scheduled notice). Shared by the HR `send` action and the
 * auto-assign path in `scheduleNewHireReviews`.
 */
export async function notifyReviewAssigned(params: {
  reviewId: string;
  employeeName: string;
  employeeEmail: string | null;
  reviewerName: string;
  reviewerEmail: string;
  type: string;
  branch: string | null;
  dueDate: Date;
}): Promise<void> {
  const label = REVIEW_LABEL[params.type] ?? "review";
  const b = params.branch ? ` (${branchLabel(params.branch)})` : "";
  const link = `${appUrl()}/reviews/${params.reviewId}`;

  await sendEmail({
    to: params.reviewerEmail,
    subject: `Action needed: conduct ${params.employeeName}'s ${label}`,
    kind: "review_assigned",
    relatedType: "newhire_review",
    relatedId: params.reviewId,
    text: `You've been asked to conduct ${params.employeeName}'s ${label}${b}, due ${params.dueDate.toLocaleDateString()}.\n\nOpen the review, complete it with the employee, and both of you sign:\n${link}\n\n— CanopyOS`,
    html: `<p>You've been asked to conduct <strong>${params.employeeName}</strong>'s <strong>${label}</strong>${b}, due ${params.dueDate.toLocaleDateString()}.</p><p><a href="${link}">Open the review →</a></p><p>Complete it with the employee, then both of you sign. It then returns to HR for final approval.</p><p>— CanopyOS</p>`,
  });

  if (params.employeeEmail) {
    await sendEmail({
      to: params.employeeEmail,
      subject: `Your ${label} is scheduled`,
      kind: "review_employee_notice",
      relatedType: "newhire_review",
      relatedId: params.reviewId,
      text: `Hi ${params.employeeName.split(" ")[0]},\n\nYour ${label} with ${params.reviewerName} is scheduled (target ${params.dueDate.toLocaleDateString()}). You'll complete it together and sign it in the portal.\n\n— CanopyOS`,
      html: `<p>Hi ${params.employeeName.split(" ")[0]},</p><p>Your <strong>${label}</strong> with ${params.reviewerName} is scheduled (target ${params.dueDate.toLocaleDateString()}). You'll complete it together and sign it in the portal.</p><p>— CanopyOS</p>`,
    });
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
    include: { employee: { select: { name: true, branch: true, role: true, title: true, user: { select: { accessLevel: true } } } } },
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
    include: { employee: { select: { id: true, name: true, email: true, branch: true, role: true, title: true, user: { select: { accessLevel: true } } } } },
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
