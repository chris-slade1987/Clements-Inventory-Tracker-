import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { signatureRoles, recordTypeLabel } from "@/lib/personnel";

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
