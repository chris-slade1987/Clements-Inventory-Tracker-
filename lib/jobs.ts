import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { signatureRoles, recordTypeLabel, getHrEmail } from "@/lib/personnel";
import { dueFromStart, REVIEW_LABEL } from "@/lib/review";
import { branchLabel } from "@/lib/management";

// Scheduled daily jobs — training reminders and outstanding-signature reminders.
// Called by the daily cron (/api/cron/daily) and the manual admin endpoints.

const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

/** Email every employee with an incomplete training assignment, once per day. */
export async function remindTraining() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const pending = await prisma.trainingAssignment.findMany({
    where: { status: { not: "completed" }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday } }] },
    include: { course: { select: { title: true } }, employee: { select: { name: true, email: true } } },
  });
  let sent = 0;
  for (const a of pending) {
    const first = a.employee.name.split(" ")[0];
    const due = a.dueDate ? ` (due ${a.dueDate.toLocaleDateString()})` : "";
    const res = await sendEmail({
      to: a.employee.email,
      subject: `Reminder: complete "${a.course.title}"`,
      kind: "training_reminder",
      relatedType: "training_assignment",
      relatedId: a.id,
      text: `Hi ${first},\n\nReminder to complete your assigned training "${a.course.title}"${due}.\n\nComplete it here: ${base()}/me/training/${a.id}\n\n— Clements Command & Control`,
      html: `<p>Hi ${first},</p><p>Reminder to complete your assigned training <strong>${a.course.title}</strong>${due}.</p><p><a href="${base()}/me/training/${a.id}">Complete your training →</a></p><p>— Clements Command &amp; Control</p>`,
    });
    await prisma.trainingAssignment.update({ where: { id: a.id }, data: { lastReminderAt: now } });
    if (res.status === "sent") sent++;
  }
  return { candidates: pending.length, emailed: sent };
}

/**
 * Detect new hires reaching their 30 / 60-day mark and create the review in
 * "due" status, alerting the HR director. Runs daily; a 5-day lead window gives
 * HR time to schedule it. Idempotent (one review per employee+type).
 */
export async function scheduleNewHireReviews() {
  const now = new Date();
  const lead = new Date(now.getTime() + 5 * 864e5);
  const employees = await prisma.employee.findMany({ where: { status: "active", hireDate: { not: null } } });
  let created = 0;
  for (const e of employees) {
    for (const type of ["30_day", "60_day"] as const) {
      const dueDate = dueFromStart(e.hireDate!, type);
      if (dueDate > lead) continue; // not due yet
      const exists = await prisma.newHireReview.findUnique({ where: { employeeId_type: { employeeId: e.id, type } } });
      if (exists) continue;
      const review = await prisma.newHireReview.create({
        data: { employeeId: e.id, branch: e.branch, type, startDate: e.hireDate!, dueDate, status: "due", hrNotifiedAt: now },
      });
      created++;
      const label = REVIEW_LABEL[type];
      const b = e.branch ? ` (${branchLabel(e.branch)})` : "";
      await prisma.alert.upsert({
        where: { dedupeKey: `review_due:${review.id}` },
        create: { dedupeKey: `review_due:${review.id}`, type: "review_due", severity: "warning", status: "open", message: `${e.name}${b} is due for a ${label} (${dueDate.toLocaleDateString()}). Assign a reviewer.` },
        update: {},
      });
      await sendEmail({
        to: await getHrEmail(),
        subject: `New-hire review due: ${e.name} — ${label}`,
        kind: "review_due",
        relatedType: "newhire_review",
        relatedId: review.id,
        text: `${e.name}${b} is due for their ${label} (due ${dueDate.toLocaleDateString()}).\n\nOpen HR › New-hire reviews to assign a reviewer and notify the employee.`,
        html: `<p><strong>${e.name}</strong>${b} is due for their <strong>${label}</strong> (due ${dueDate.toLocaleDateString()}).</p><p>Open <em>HR › New-hire reviews</em> to assign a reviewer and notify the employee.</p>`,
      });
    }
  }
  return { created };
}

/**
 * Remind on new-hire reviews that are sent/in-progress but not fully signed —
 * the reviewer (in-app) and the employee (tokenized link), once per day.
 */
export async function remindReviewSignatures() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const pending = await prisma.newHireReview.findMany({
    where: {
      status: { in: ["sent", "in_progress"] },
      sentAt: { lt: dayAgo },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday } }],
    },
    include: { employee: { select: { name: true, email: true } } },
  });
  let sent = 0;
  for (const r of pending) {
    const label = REVIEW_LABEL[r.type] ?? "review";
    // Reviewer still needs to complete & sign.
    if (!r.reviewerSignedAt && r.reviewerUserId) {
      const reviewer = await prisma.user.findUnique({ where: { id: r.reviewerUserId }, select: { email: true } });
      if (reviewer?.email) {
        const res = await sendEmail({
          to: reviewer.email,
          subject: `Reminder: complete ${r.employee.name}'s ${label}`,
          kind: "review_reminder",
          relatedType: "newhire_review",
          relatedId: r.id,
          text: `Reminder to complete and sign ${r.employee.name}'s ${label}.\n\nOpen it: ${base()}/reviews/${r.id}\n\nYou'll keep receiving daily reminders until it's signed.\n\n— Clements Command & Control`,
          html: `<p>Reminder to complete and sign <strong>${r.employee.name}</strong>'s ${label}.</p><p><a href="${base()}/reviews/${r.id}">Open the review →</a></p><p>You'll keep receiving daily reminders until it's signed.</p><p>— Clements Command &amp; Control</p>`,
        });
        if (res.status === "sent") sent++;
      }
    }
    // Employee still needs to sign — send the tokenized remote link.
    if (!r.employeeSignedAt && r.employeeToken && r.employee.email) {
      const res = await sendEmail({
        to: r.employee.email,
        subject: `Reminder: sign your ${label}`,
        kind: "review_reminder",
        relatedType: "newhire_review",
        relatedId: r.id,
        text: `Hi ${r.employee.name.split(" ")[0]},\n\nReminder to review and e-sign your ${label}.\n\nSign here: ${base()}/review-sign/${r.employeeToken}\n\nYou'll keep receiving daily reminders until it's signed.\n\n— Clements Command & Control`,
        html: `<p>Hi ${r.employee.name.split(" ")[0]},</p><p>Reminder to review and e-sign your ${label}.</p><p><a href="${base()}/review-sign/${r.employeeToken}">Review &amp; e-sign →</a></p><p>You'll keep receiving daily reminders until it's signed.</p><p>— Clements Command &amp; Control</p>`,
      });
      if (res.status === "sent") sent++;
    }
    await prisma.newHireReview.update({ where: { id: r.id }, data: { lastReminderAt: now } });
  }
  return { candidates: pending.length, emailed: sent };
}

/** Email signers with an outstanding signature request — starts 24h out, then daily. */
export async function remindSignatures() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const pending = await prisma.signatureRequest.findMany({
    where: { signedAt: null, sentAt: { lt: dayAgo }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday } }] },
    include: { record: { include: { employee: { select: { name: true } } } } },
  });
  let sent = 0;
  for (const r of pending) {
    const label = recordTypeLabel(r.record.type);
    const roleDef = signatureRoles(r.record.type).find((x) => x.key === r.role);
    const link = `${base()}/sign/${r.token}`;
    const res = await sendEmail({
      to: r.email,
      subject: `Reminder — signature still needed: ${label} for ${r.record.employee.name}`,
      kind: "signature_reminder",
      relatedType: "personnel_record",
      relatedId: r.recordId,
      text: `Reminder to review and e-sign the ${label.toLowerCase()} as "${roleDef?.label ?? r.role}".\n\nSign here: ${link}\n\nYou'll keep receiving daily reminders until it's signed.\n\n— Clements Command & Control`,
      html: `<p>Reminder to review and e-sign the <strong>${label.toLowerCase()}</strong> as <strong>${roleDef?.label ?? r.role}</strong>.</p><p><a href="${link}">Review &amp; e-sign →</a></p><p>You'll keep receiving daily reminders until it's signed.</p><p>— Clements Command &amp; Control</p>`,
    });
    await prisma.signatureRequest.update({ where: { id: r.id }, data: { lastReminderAt: now } });
    if (res.status === "sent") sent++;
  }
  return { candidates: pending.length, emailed: sent };
}
