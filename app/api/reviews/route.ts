import { appUrl } from "@/lib/app-url";
import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isHrDirector, getHrEmail } from "@/lib/personnel";
import { REVIEW_LABEL, isReviewTemplate, notifyReviewAssigned } from "@/lib/review";
import { branchLabel } from "@/lib/management";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const base = () => appUrl();

// New-hire 30/60-day review workflow.
//   send  — HR assigns a reviewer, notifies reviewer + employee (HR only)
//   save  — reviewer (or HR) saves the in-progress form
//   sign  — reviewer / employee / HR apply their e-signature (3 total)
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  const reviewId = str(body?.reviewId);
  if (!action || !reviewId) return NextResponse.json({ error: "Missing action or review." }, { status: 400 });

  const review = await prisma.newHireReview.findUnique({
    where: { id: reviewId },
    include: { employee: { select: { id: true, name: true, email: true, branch: true } } },
  });
  if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });

  const hr = isHrDirector(user);
  // HR for template management = admin/HR director OR anyone with the HR flag.
  const hrManage = hr || !!user.hrAccess;
  const isReviewer = !!review.reviewerUserId && review.reviewerUserId === user.id;
  const isSubjectEmployee = !!user.employeeId && user.employeeId === review.employeeId;
  const label = REVIEW_LABEL[review.type] ?? "review";
  const b = review.branch ? ` (${branchLabel(review.branch)})` : "";
  const link = (id: string) => `${base()}/reviews/${id}`;

  try {
    // ---- send: HR assigns a reviewer & notifies both parties ----------------
    if (action === "send") {
      if (!hr) return NextResponse.json({ error: "Only HR can assign a reviewer." }, { status: 403 });
      const reviewerUserId = str(body?.reviewerUserId);
      if (!reviewerUserId) return NextResponse.json({ error: "Choose who will conduct the review." }, { status: 400 });
      const reviewer = await prisma.user.findUnique({ where: { id: reviewerUserId }, select: { id: true, name: true, email: true } });
      if (!reviewer) return NextResponse.json({ error: "Reviewer not found." }, { status: 404 });

      // HR may also set/override the form while assigning (off-list roles).
      const sendTemplate = str(body?.template);
      if (sendTemplate && !isReviewTemplate(sendTemplate)) return NextResponse.json({ error: "Unknown review form." }, { status: 400 });

      const token = review.employeeToken ?? randomBytes(24).toString("hex");
      const updated = await prisma.newHireReview.update({
        where: { id: review.id },
        data: {
          reviewerUserId: reviewer.id,
          reviewerName: reviewer.name,
          employeeToken: token,
          template: sendTemplate ?? review.template,
          status: review.status === "due" || review.status === "sent" ? "sent" : review.status,
          sentAt: review.sentAt ?? new Date(),
        },
      });

      // Quiet the "assign a reviewer" alert now that it's assigned.
      await prisma.alert.updateMany({ where: { dedupeKey: `review_due:${review.id}`, status: "open" }, data: { status: "dismissed" } });

      // Notify the reviewer + employee (shared with the auto-assign job).
      await notifyReviewAssigned({
        reviewId: review.id,
        employeeName: review.employee.name,
        employeeEmail: review.employee.email,
        reviewerName: reviewer.name,
        reviewerEmail: reviewer.email,
        type: review.type,
        branch: review.branch,
        dueDate: review.dueDate,
      });
      return NextResponse.json({ ok: true, status: updated.status });
    }

    // ---- set_template: HR changes which role form the hire is on -------------
    if (action === "set_template") {
      if (!hrManage) return NextResponse.json({ error: "Only HR can change the review form." }, { status: 403 });
      const template = str(body?.template);
      if (!isReviewTemplate(template)) return NextResponse.json({ error: "Unknown review form." }, { status: 400 });
      if (review.status === "completed") return NextResponse.json({ error: "This review is completed — reopen it before changing the form." }, { status: 400 });
      await prisma.newHireReview.update({ where: { id: review.id }, data: { template } });
      return NextResponse.json({ ok: true, template });
    }

    // ---- save: reviewer/HR saves the form -----------------------------------
    if (action === "save") {
      if (!isReviewer && !hr) return NextResponse.json({ error: "Only the assigned reviewer or HR can edit this review." }, { status: 403 });
      const responses = body?.responses && typeof body.responses === "object" ? JSON.stringify(body.responses) : review.responses;
      await prisma.newHireReview.update({
        where: { id: review.id },
        data: {
          responses,
          overallRating: str(body?.overallRating) ?? review.overallRating,
          nextSteps: str(body?.nextSteps) ?? review.nextSteps,
          status: review.status === "sent" || review.status === "due" ? "in_progress" : review.status,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- sign: apply an e-signature -----------------------------------------
    if (action === "sign") {
      const role = str(body?.role);
      const signerName = str(body?.signerName);
      if (!signerName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });
      if (body?.agree !== true) return NextResponse.json({ error: "You must confirm the acknowledgment to sign." }, { status: 400 });
      const now = new Date();

      if (role === "reviewer") {
        if (!isReviewer && !hr) return NextResponse.json({ error: "Only the assigned reviewer can sign here." }, { status: 403 });
        await prisma.newHireReview.update({ where: { id: review.id }, data: { reviewerSignedName: signerName, reviewerSignedAt: now, status: review.status === "sent" || review.status === "due" ? "in_progress" : review.status } });
      } else if (role === "employee") {
        if (!isSubjectEmployee && !hr) return NextResponse.json({ error: "Only the employee can sign here." }, { status: 403 });
        await prisma.newHireReview.update({ where: { id: review.id }, data: { employeeSignedName: signerName, employeeSignedAt: now } });
      } else if (role === "hr") {
        if (!hr) return NextResponse.json({ error: "Only HR can give final approval." }, { status: 403 });
        if (!review.reviewerSignedAt || !review.employeeSignedAt)
          return NextResponse.json({ error: "Both the reviewer and employee must sign before HR approval." }, { status: 400 });
        await prisma.newHireReview.update({ where: { id: review.id }, data: { hrSignedName: signerName, hrSignedAt: now, status: "completed", completedAt: now, hrNotes: str(body?.hrNotes) ?? review.hrNotes } });
        // No standalone "completed & approved" self-receipt to reviewer+employee —
        // the completion already shows on-screen and is filed to the record.
        return NextResponse.json({ ok: true, status: "completed" });
      } else {
        return NextResponse.json({ error: "Unknown signature role." }, { status: 400 });
      }

      // After reviewer/employee signs: if both are signed, hand back to HR.
      const fresh = await prisma.newHireReview.findUnique({ where: { id: review.id } });
      if (fresh && fresh.reviewerSignedAt && fresh.employeeSignedAt && fresh.status !== "pending_approval" && fresh.status !== "completed") {
        await prisma.newHireReview.update({ where: { id: review.id }, data: { status: "pending_approval" } });
        await sendEmail({
          to: await getHrEmail(),
          subject: `Ready for approval: ${review.employee.name}'s ${label}`,
          kind: "review_pending_approval",
          relatedType: "newhire_review",
          relatedId: review.id,
          text: `${review.employee.name}${b} and their reviewer have both signed the ${label}. Please review and give final approval:\n${link(review.id)}\n\n— CanopyOS`,
          html: `<p><strong>${review.employee.name}</strong>${b} and their reviewer have both signed the <strong>${label}</strong>.</p><p><a href="${link(review.id)}">Review &amp; give final approval →</a></p><p>— CanopyOS</p>`,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ---- reset / reopen / recreate (HR & admin only) ------------------------
    // Undo signatures or send a review back to editable when a correction is
    // needed (e.g. someone signed by mistake).
    if (action === "reset_signature" || action === "reopen" || action === "recreate") {
      if (!hr) return NextResponse.json({ error: "Only HR or an admin can reset a review." }, { status: 403 });

      const data: Record<string, unknown> = {};
      if (action === "reset_signature") {
        const role = str(body?.role);
        if (role === "reviewer") { data.reviewerSignedName = null; data.reviewerSignedAt = null; }
        else if (role === "employee") { data.employeeSignedName = null; data.employeeSignedAt = null; }
        else if (role === "hr") { data.hrSignedName = null; data.hrSignedAt = null; }
        else return NextResponse.json({ error: "Unknown signature role." }, { status: 400 });
      } else {
        // reopen / recreate clear every signature and completion.
        data.reviewerSignedName = null; data.reviewerSignedAt = null;
        data.employeeSignedName = null; data.employeeSignedAt = null;
        data.hrSignedName = null; data.hrSignedAt = null;
        data.completedAt = null;
        if (action === "recreate") { data.responses = "{}"; data.overallRating = null; data.nextSteps = null; }
      }
      // Clearing the HR signature always drops it out of "completed".
      data.completedAt = null;
      await prisma.newHireReview.update({ where: { id: review.id }, data });

      // Recompute status from what remains.
      const fresh = await prisma.newHireReview.findUnique({ where: { id: review.id } });
      let status = "due";
      if (fresh) {
        const hasResponses = fresh.responses && fresh.responses !== "{}";
        if (fresh.hrSignedAt) status = "completed";
        else if (fresh.reviewerSignedAt && fresh.employeeSignedAt) status = "pending_approval";
        else if (fresh.reviewerSignedAt || fresh.employeeSignedAt || hasResponses) status = "in_progress";
        else status = fresh.reviewerUserId ? "sent" : "due";
      }
      await prisma.newHireReview.update({ where: { id: review.id }, data: { status } });
      return NextResponse.json({ ok: true, status });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
