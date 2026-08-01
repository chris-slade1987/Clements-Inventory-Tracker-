import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isHrDirector, getHrEmail } from "@/lib/personnel";
import { REVIEW_LABEL } from "@/lib/review";
import { branchLabel } from "@/lib/management";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

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

      const token = review.employeeToken ?? randomBytes(24).toString("hex");
      const updated = await prisma.newHireReview.update({
        where: { id: review.id },
        data: {
          reviewerUserId: reviewer.id,
          reviewerName: reviewer.name,
          employeeToken: token,
          status: review.status === "due" || review.status === "sent" ? "sent" : review.status,
          sentAt: review.sentAt ?? new Date(),
        },
      });

      // Quiet the "assign a reviewer" alert now that it's assigned.
      await prisma.alert.updateMany({ where: { dedupeKey: `review_due:${review.id}`, status: "open" }, data: { status: "dismissed" } });

      // Notify the reviewer.
      await sendEmail({
        to: reviewer.email,
        subject: `Action needed: conduct ${review.employee.name}'s ${label}`,
        kind: "review_assigned",
        relatedType: "newhire_review",
        relatedId: review.id,
        text: `You've been asked to conduct ${review.employee.name}'s ${label}${b}, due ${review.dueDate.toLocaleDateString()}.\n\nOpen the review, complete it with the employee, and both of you sign:\n${link(review.id)}\n\n— Canopy OS`,
        html: `<p>You've been asked to conduct <strong>${review.employee.name}</strong>'s <strong>${label}</strong>${b}, due ${review.dueDate.toLocaleDateString()}.</p><p><a href="${link(review.id)}">Open the review →</a></p><p>Complete it with the employee, then both of you sign. It then returns to HR for final approval.</p><p>— Canopy OS</p>`,
      });
      // Notify the employee.
      if (review.employee.email) {
        await sendEmail({
          to: review.employee.email,
          subject: `Your ${label} is scheduled`,
          kind: "review_employee_notice",
          relatedType: "newhire_review",
          relatedId: review.id,
          text: `Hi ${review.employee.name.split(" ")[0]},\n\nYour ${label} with ${reviewer.name} is scheduled (target ${review.dueDate.toLocaleDateString()}). You'll complete it together and sign it in the portal.\n\n— Canopy OS`,
          html: `<p>Hi ${review.employee.name.split(" ")[0]},</p><p>Your <strong>${label}</strong> with ${reviewer.name} is scheduled (target ${review.dueDate.toLocaleDateString()}). You'll complete it together and sign it in the portal.</p><p>— Canopy OS</p>`,
        });
      }
      return NextResponse.json({ ok: true, status: updated.status });
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
          status: review.status === "sent" ? "in_progress" : review.status,
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
        await prisma.newHireReview.update({ where: { id: review.id }, data: { reviewerSignedName: signerName, reviewerSignedAt: now, status: review.status === "sent" ? "in_progress" : review.status } });
      } else if (role === "employee") {
        if (!isSubjectEmployee && !hr) return NextResponse.json({ error: "Only the employee can sign here." }, { status: 403 });
        await prisma.newHireReview.update({ where: { id: review.id }, data: { employeeSignedName: signerName, employeeSignedAt: now } });
      } else if (role === "hr") {
        if (!hr) return NextResponse.json({ error: "Only HR can give final approval." }, { status: 403 });
        if (!review.reviewerSignedAt || !review.employeeSignedAt)
          return NextResponse.json({ error: "Both the reviewer and employee must sign before HR approval." }, { status: 400 });
        await prisma.newHireReview.update({ where: { id: review.id }, data: { hrSignedName: signerName, hrSignedAt: now, status: "completed", completedAt: now, hrNotes: str(body?.hrNotes) ?? review.hrNotes } });
        // Finalized — let both signers know it's filed to the personnel record.
        const done = [review.reviewerUserId ? (await prisma.user.findUnique({ where: { id: review.reviewerUserId }, select: { email: true } }))?.email : null, review.employee.email].filter(Boolean) as string[];
        if (done.length)
          await sendEmail({
            to: done,
            subject: `Completed & approved: ${review.employee.name}'s ${label}`,
            kind: "review_completed",
            relatedType: "newhire_review",
            relatedId: review.id,
            text: `${review.employee.name}'s ${label} has been approved by HR and filed to the personnel record. Thank you.\n\n— Canopy OS`,
            html: `<p><strong>${review.employee.name}</strong>'s ${label} has been approved by HR and filed to the personnel record. Thank you.</p><p>— Canopy OS</p>`,
          });
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
          text: `${review.employee.name}${b} and their reviewer have both signed the ${label}. Please review and give final approval:\n${link(review.id)}\n\n— Canopy OS`,
          html: `<p><strong>${review.employee.name}</strong>${b} and their reviewer have both signed the <strong>${label}</strong>.</p><p><a href="${link(review.id)}">Review &amp; give final approval →</a></p><p>— Canopy OS</p>`,
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
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
