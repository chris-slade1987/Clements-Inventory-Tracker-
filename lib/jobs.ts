import { appUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { leadWindowOpen } from "@/lib/reminders-shared";
import { sendEmail } from "@/lib/email";
import { signatureRoles, recordTypeLabel, getHrEmail } from "@/lib/personnel";
import { dueFromStart, REVIEW_LABEL, templateForEmployee, notifyReviewAssigned } from "@/lib/review";
import { randomBytes } from "node:crypto";
import { branchLabel, BRANCHES } from "@/lib/management";
import { etParts } from "@/lib/date";
import { notifyThread } from "@/lib/threads";
import { DigestCollector, sendDigests, dueForDigest } from "@/lib/email-digest";

// Scheduled daily jobs — training reminders and outstanding-signature reminders.
// Called by the daily cron (/api/cron/daily) and the manual admin endpoints.
//
// Reminder EMAIL is a once-daily per-recipient DIGEST, not one email per item.
// Each source `collect*`s its pending items into a shared `DigestCollector`; the
// daily runner (`runDailyDigest`) flushes one email per recipient. The in-app
// Alert rows are kept exactly as before — Alerts stay the primary channel.
// Each public `remind*` wrapper stays runnable on its own (manual admin triggers)
// by collecting just its own items and flushing a single-section digest.

const base = () => appUrl();

/** Collect incomplete-training reminders into the digest (one line per employee). */
async function collectTraining(c: DigestCollector): Promise<{ candidates: number; queued: number }> {
  const now = c.now;
  const pending = await prisma.trainingAssignment.findMany({
    where: { status: { not: "completed" } },
    include: { course: { select: { title: true } }, employee: { select: { name: true, email: true } } },
  });
  let queued = 0;
  for (const a of pending) {
    if (!a.employee.email) continue;
    // Taper against how long the assignment has been outstanding (assignedAt).
    if (!dueForDigest(now, a.lastReminderAt, a.assignedAt)) continue;
    const due = a.dueDate ? ` (due ${a.dueDate.toLocaleDateString()})` : "";
    c.add({
      recipientEmail: a.employee.email,
      section: "Training",
      line: `Complete "${a.course.title}"${due}`,
      link: `${base()}/me/training/${a.id}`,
      stampKey: `training:${a.id}`,
      stamp: () => prisma.trainingAssignment.update({ where: { id: a.id }, data: { lastReminderAt: now } }).then(() => {}),
    });
    queued++;
  }
  return { candidates: pending.length, queued };
}

/** Manual admin trigger: send the training reminders as their own digest. */
export async function remindTraining() {
  const c = new DigestCollector();
  const r = await collectTraining(c);
  const d = await sendDigests(c);
  return { candidates: r.candidates, queued: r.queued, recipients: d.recipients, emailed: d.emailed };
}

/**
 * Detect new hires reaching their 30 / 60-day mark and create the review.
 * Runs daily; a 5-day lead window gives HR time. Idempotent (one per
 * employee+type).
 *
 * The review is role-aware and self-assigning where it can be:
 *   - The form `template` is resolved from the employee's access level/role.
 *   - The reviewer is the employee's DIRECT MANAGER (`reportsTo` → their login).
 *   - If BOTH resolve, the review is created already `sent`: reviewer + employee
 *     are notified (no "assign a reviewer" alert), and HR gets an FYI that it
 *     was created and assigned.
 *   - Otherwise (off-list role or no manager login) it falls back to today's
 *     behavior — `due`, with whatever resolved stamped on, and the HR
 *     "assign a reviewer" alert + email raised.
 */
// New-hire 30/60-day reviews only apply to people hired on/after the onboarding-
// review program start. Anyone hired before this is existing staff, not a new
// hire, and should never be assigned an onboarding review.
export const REVIEW_PROGRAM_START = new Date("2026-07-01T00:00:00.000Z");

/**
 * Remove stale onboarding reviews (and dismiss their "assign a reviewer" alerts)
 * for employees hired before the program start. Preserves already-completed
 * reviews as a historical record; only clears not-yet-completed ones. Idempotent.
 */
export async function clearPreProgramReviews(): Promise<{ removed: number; alertsDismissed: number }> {
  // Catch every spurious case: the employee was hired before the program start,
  // has no hire date at all (null), or the review itself was stamped with a
  // pre-program start date (e.g. a garbage/epoch hire date like 1975).
  const stale = await prisma.newHireReview.findMany({
    where: {
      status: { not: "completed" },
      OR: [
        { employee: { hireDate: { lt: REVIEW_PROGRAM_START } } },
        { employee: { hireDate: null } },
        { startDate: { lt: REVIEW_PROGRAM_START } },
      ],
    },
    select: { id: true },
  });
  if (stale.length === 0) return { removed: 0, alertsDismissed: 0 };
  const ids = stale.map((r) => r.id);
  const alerts = await prisma.alert.updateMany({
    where: { dedupeKey: { in: ids.map((id) => `review_due:${id}`) }, status: "open" },
    data: { status: "dismissed" },
  });
  const del = await prisma.newHireReview.deleteMany({ where: { id: { in: ids } } });
  return { removed: del.count, alertsDismissed: alerts.count };
}

export async function scheduleNewHireReviews(collector?: DigestCollector) {
  const now = collector?.now ?? new Date();
  // When run on its own (not from the daily digest), flush our own digest so the
  // fallback "assign a reviewer" items still reach HR.
  const c = collector ?? new DigestCollector(now);
  const hrEmail = await getHrEmail();
  const lead = new Date(now.getTime() + 5 * 864e5);
  // Self-heal: clear any stale onboarding reviews for pre-program hires each run.
  await clearPreProgramReviews();
  const employees = await prisma.employee.findMany({
    where: { status: "active", hireDate: { not: null, gte: REVIEW_PROGRAM_START } },
    include: {
      user: { select: { accessLevel: true } },
      reportsTo: { include: { user: { select: { id: true, name: true, email: true, active: true } } } },
    },
  });
  let created = 0;
  for (const e of employees) {
    for (const type of ["30_day", "60_day"] as const) {
      const dueDate = dueFromStart(e.hireDate!, type);
      if (dueDate > lead) continue; // not due yet
      const exists = await prisma.newHireReview.findUnique({ where: { employeeId_type: { employeeId: e.id, type } } });
      if (exists) continue;

      const label = REVIEW_LABEL[type];
      const b = e.branch ? ` (${branchLabel(e.branch)})` : "";
      const template = templateForEmployee({ accessLevel: e.user?.accessLevel, role: e.role, title: e.title });
      const mgrUser = e.reportsTo?.user ?? null;
      const reviewerResolved = !!(mgrUser && mgrUser.active && mgrUser.email);

      // Auto-assign path: both the form and the direct-manager login resolve.
      if (template && reviewerResolved) {
        const review = await prisma.newHireReview.create({
          data: {
            employeeId: e.id, branch: e.branch, type, template, startDate: e.hireDate!, dueDate,
            status: "sent", sentAt: now, hrNotifiedAt: now,
            reviewerUserId: mgrUser!.id, reviewerName: mgrUser!.name, employeeToken: randomBytes(24).toString("hex"),
          },
        });
        created++;
        // Notify reviewer + employee (same logic as the HR `send` action).
        // The "created & assigned — no action needed" FYI to HR is intentionally
        // not sent: it's noise. HR is notified when the review needs approval.
        await notifyReviewAssigned({
          reviewId: review.id, employeeName: e.name, employeeEmail: e.email,
          reviewerName: mgrUser!.name, reviewerEmail: mgrUser!.email,
          type, branch: e.branch, dueDate,
        });
        continue;
      }

      // Fallback path: create `due`, stamp what resolved, raise the HR alert.
      const review = await prisma.newHireReview.create({
        data: {
          employeeId: e.id, branch: e.branch, type, template: template ?? null, startDate: e.hireDate!, dueDate,
          status: "due", hrNotifiedAt: now,
          reviewerUserId: reviewerResolved ? mgrUser!.id : null,
          reviewerName: reviewerResolved ? mgrUser!.name : null,
        },
      });
      created++;
      await prisma.alert.upsert({
        where: { dedupeKey: `review_due:${review.id}` },
        create: { dedupeKey: `review_due:${review.id}`, type: "review_due", severity: "warning", status: "open", message: `${e.name}${b} is due for a ${label} (${dueDate.toLocaleDateString()}). Assign a reviewer.` },
        update: {},
      });
      // Action-required HR notice — route through the digest (one-shot at
      // creation; the standing Alert above keeps it visible until assigned).
      c.add({
        recipientEmail: hrEmail,
        section: "Reviews to sign",
        line: `Assign a reviewer: ${e.name}${b}'s ${label} (due ${dueDate.toLocaleDateString()})`,
        link: `${base()}/reviews/${review.id}`,
      });
    }
  }
  if (!collector) await sendDigests(c);
  return { created };
}

/**
 * Remind on new-hire reviews that are sent/in-progress but not fully signed —
 * the reviewer (in-app) and the employee (tokenized link), once per day.
 */
async function collectReviewSignatures(c: DigestCollector): Promise<{ candidates: number; queued: number }> {
  const now = c.now;
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const pending = await prisma.newHireReview.findMany({
    where: {
      status: { in: ["sent", "in_progress"] },
      sentAt: { lt: dayAgo },
    },
    include: { employee: { select: { name: true, email: true } } },
  });
  let queued = 0;
  for (const r of pending) {
    // One taper per review row (shared by reviewer + employee lines).
    if (!dueForDigest(now, r.lastReminderAt, r.sentAt)) continue;
    const label = REVIEW_LABEL[r.type] ?? "review";
    const stamp = () => prisma.newHireReview.update({ where: { id: r.id }, data: { lastReminderAt: now } }).then(() => {});
    let added = false;
    // Reviewer still needs to complete & sign.
    if (!r.reviewerSignedAt && r.reviewerUserId) {
      const reviewer = await prisma.user.findUnique({ where: { id: r.reviewerUserId }, select: { email: true } });
      if (reviewer?.email) {
        c.add({
          recipientEmail: reviewer.email,
          section: "Reviews to sign",
          line: `Complete and sign ${r.employee.name}'s ${label}`,
          link: `${base()}/reviews/${r.id}`,
          stampKey: `review:${r.id}`,
          stamp,
        });
        added = true;
      }
    }
    // Employee still needs to sign — the tokenized remote link.
    if (!r.employeeSignedAt && r.employeeToken && r.employee.email) {
      c.add({
        recipientEmail: r.employee.email,
        section: "Reviews to sign",
        line: `Review and e-sign your ${label}`,
        link: `${base()}/review-sign/${r.employeeToken}`,
        stampKey: `review:${r.id}`,
        stamp,
      });
      added = true;
    }
    if (added) queued++;
  }
  return { candidates: pending.length, queued };
}

/** Manual admin trigger: review-signature reminders as their own digest. */
export async function remindReviewSignatures() {
  const c = new DigestCollector();
  const r = await collectReviewSignatures(c);
  const d = await sendDigests(c);
  return { candidates: r.candidates, queued: r.queued, recipients: d.recipients, emailed: d.emailed };
}

/**
 * Vehicle-document renewals (insurance, registration). Emails HR when a filed
 * document with remindHr is within 45 days of expiring (or already expired),
 * once per day, and files an Alert.
 */
async function collectVehicleDocs(c: DigestCollector): Promise<{ candidates: number; queued: number }> {
  const now = c.now;
  const cutoff = new Date(now.getTime() + 45 * 864e5);
  const docs = await prisma.vehicleDocument.findMany({
    where: {
      status: "filed",
      remindHr: true,
      expirationDate: { not: null, lte: cutoff },
    },
    include: { vehicle: { select: { unitNumber: true, name: true, branch: true } } },
  });
  const hrEmail = await getHrEmail();
  let queued = 0;
  for (const d of docs) {
    const exp = d.expirationDate!;
    const overdue = exp < now;
    const veh = d.vehicle ? `${d.vehicle.unitNumber ? `#${d.vehicle.unitNumber} ` : ""}${d.vehicle.name}` : "a vehicle";
    const b = d.vehicle?.branch ? ` (${branchLabel(d.vehicle.branch)})` : "";
    const cat = d.category === "registration" ? "registration" : d.category === "insurance" ? "insurance" : "document";
    // Alert row is unchanged — upserted every run (idempotent).
    await prisma.alert.upsert({
      where: { dedupeKey: `doc_renewal:${d.id}` },
      create: { dedupeKey: `doc_renewal:${d.id}`, type: "doc_renewal", severity: overdue ? "critical" : "warning", status: "open", message: `${veh}${b}: ${cat} "${d.title}" ${overdue ? "expired" : "renews"} ${exp.toLocaleDateString()}.` },
      update: {},
    });
    // Taper against how long the document has been on file (createdAt).
    if (!dueForDigest(now, d.lastReminderAt, d.createdAt)) continue;
    c.add({
      recipientEmail: hrEmail,
      section: "Vehicle documents",
      line: `${veh}${b}: ${cat} "${d.title}" ${overdue ? `expired ${exp.toLocaleDateString()}` : `renews ${exp.toLocaleDateString()}`} — review or upload the renewal`,
      stampKey: `doc:${d.id}`,
      stamp: () => prisma.vehicleDocument.update({ where: { id: d.id }, data: { lastReminderAt: now } }).then(() => {}),
    });
    queued++;
  }
  return { candidates: docs.length, queued };
}

/** Manual admin trigger: vehicle-document renewal reminders as their own digest. */
export async function remindVehicleDocs() {
  const c = new DigestCollector();
  const r = await collectVehicleDocs(c);
  const d = await sendDigests(c);
  return { candidates: r.candidates, queued: r.queued, recipients: d.recipients, emailed: d.emailed };
}

/**
 * Manual reminders (tagged to an employee/vehicle). Once the lead window opens,
 * email the chosen recipients (HR and/or the creator) once per day and file an
 * Alert, until the reminder is completed or dismissed.
 */
async function collectManual(c: DigestCollector): Promise<{ candidates: number; queued: number }> {
  const now = c.now;
  const open = await prisma.reminder.findMany({
    where: { status: "open" },
    include: { employee: { select: { name: true } }, vehicle: { select: { unitNumber: true, name: true } } },
  });
  let hrEmail: string | null = null;
  let queued = 0;
  for (const r of open) {
    if (!leadWindowOpen(r.dueDate, r.leadDays, now.getTime())) continue; // lead window not open
    const days = Math.round((r.dueDate.getTime() - now.getTime()) / 864e5);
    const overdue = days < 0;
    const tag = r.employee ? ` — ${r.employee.name}` : r.vehicle ? ` — ${r.vehicle.unitNumber ? `#${r.vehicle.unitNumber} ` : ""}${r.vehicle.name}` : "";
    const b = r.branch ? ` (${branchLabel(r.branch)})` : "";
    const when = overdue ? `overdue (was due ${r.dueDate.toLocaleDateString()})` : days === 0 ? "due today" : `due in ${days} days (${r.dueDate.toLocaleDateString()})`;

    // Alert row is unchanged — upserted every run (idempotent).
    await prisma.alert.upsert({
      where: { dedupeKey: `reminder:${r.id}` },
      create: { dedupeKey: `reminder:${r.id}`, type: "reminder", severity: overdue ? "critical" : (r.severity === "critical" ? "critical" : r.severity === "warning" ? "warning" : "info"), status: "open", message: `${r.title}${tag}${b} — ${when}.` },
      update: {},
    });

    // Taper against how long the reminder has existed (createdAt).
    if (!dueForDigest(now, r.lastReminderAt, r.createdAt)) continue;

    const to: string[] = [];
    if (r.notify === "hr" || r.notify === "both") { hrEmail = hrEmail ?? (await getHrEmail()); to.push(hrEmail); }
    if ((r.notify === "creator" || r.notify === "both") && r.createdByEmail) to.push(r.createdByEmail);
    if (to.length === 0) continue;

    const stamp = () => prisma.reminder.update({ where: { id: r.id }, data: { lastReminderAt: now } }).then(() => {});
    for (const addr of to) {
      c.add({
        recipientEmail: addr,
        section: "Reminders",
        line: `${r.title}${tag}${b} — ${when}${r.notes ? ` · ${r.notes}` : ""}`,
        stampKey: `reminder:${r.id}`,
        stamp,
      });
    }
    queued++;
  }
  return { candidates: open.length, queued };
}

/** Manual admin trigger: manual reminders as their own digest. */
export async function remindManual() {
  const c = new DigestCollector();
  const r = await collectManual(c);
  const d = await sendDigests(c);
  return { candidates: r.candidates, queued: r.queued, recipients: d.recipients, emailed: d.emailed };
}

/** Collect outstanding signature requests — starts 24h out, then tapered. */
async function collectSignatures(c: DigestCollector): Promise<{ candidates: number; queued: number }> {
  const now = c.now;
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const pending = await prisma.signatureRequest.findMany({
    where: { signedAt: null, sentAt: { lt: dayAgo } },
    include: { record: { include: { employee: { select: { name: true } } } } },
  });
  let queued = 0;
  for (const r of pending) {
    if (!dueForDigest(now, r.lastReminderAt, r.sentAt)) continue;
    const label = recordTypeLabel(r.record.type);
    const roleDef = signatureRoles(r.record.type).find((x) => x.key === r.role);
    c.add({
      recipientEmail: r.email,
      section: "Signatures",
      line: `Review and e-sign the ${label.toLowerCase()} for ${r.record.employee.name} as ${roleDef?.label ?? r.role}`,
      link: `${base()}/sign/${r.token}`,
      stampKey: `sig:${r.id}`,
      stamp: () => prisma.signatureRequest.update({ where: { id: r.id }, data: { lastReminderAt: now } }).then(() => {}),
    });
    queued++;
  }
  return { candidates: pending.length, queued };
}

/** Manual admin trigger: outstanding-signature reminders as their own digest. */
export async function remindSignatures() {
  const c = new DigestCollector();
  const r = await collectSignatures(c);
  const d = await sendDigests(c);
  return { candidates: r.candidates, queued: r.queued, recipients: d.recipients, emailed: d.emailed };
}

/**
 * The once-daily unified digest run. Creates reviews/auto-assigns (direct
 * notifications), collects every reminder source into ONE shared collector, and
 * flushes a single "Your CanopyOS daily summary" email per recipient. Replaces
 * the former per-item email storm.
 */
export async function runDailyDigest() {
  const now = new Date();
  const c = new DigestCollector(now);
  // Reviews first: creates rows + queues any fallback "assign a reviewer" items.
  const reviews = await scheduleNewHireReviews(c);
  const [training, reviewSignatures, vehicleDocs, manual, signatures] = await Promise.all([
    collectTraining(c),
    collectReviewSignatures(c),
    collectVehicleDocs(c),
    collectManual(c),
    collectSignatures(c),
  ]);
  const digest = await sendDigests(c);
  return { reviews, training, reviewSignatures, vehicleDocs, manual, signatures, digest };
}

// Quarterly branch scorecards are due 30–60 days after each quarter-end. Once we
// pass day 30, alert every manager, HR, and admin that any branch whose scorecard
// isn't finalized yet needs to be completed — repeating weekly through day 60.
export async function remindScorecardsDue() {
  const now = new Date();
  const results: { period: string; outstanding: string[]; emailed: boolean }[] = [];

  // Quarter-end (last day of the quarter's final month), UTC.
  const quarterEnd = (year: number, q: number) => new Date(Date.UTC(year, q * 3, 0, 23, 59, 59));
  const DAY = 86_400_000;

  // Check the current year's quarters plus last year's Q4 (covers a January run).
  const y = now.getUTCFullYear();
  const candidates: { year: number; q: number }[] = [
    { year: y - 1, q: 4 }, { year: y, q: 1 }, { year: y, q: 2 }, { year: y, q: 3 }, { year: y, q: 4 },
  ];

  for (const { year, q } of candidates) {
    const end = quarterEnd(year, q);
    const open = new Date(end.getTime() + 30 * DAY); // due window opens day 30
    const close = new Date(end.getTime() + 60 * DAY); // …closes day 60
    if (now < open || now > close) continue;

    // Which branches don't yet have a finalized (archived) scorecard?
    const reviews = await prisma.scorecardReview.findMany({ where: { year, quarter: q }, select: { branch: true, status: true } });
    const doneBranches = new Set(reviews.filter((r) => r.status === "archived").map((r) => r.branch));
    const outstanding = BRANCHES.filter((b) => !doneBranches.has(b.key)).map((b) => b.key);
    if (outstanding.length === 0) { results.push({ period: `${year}Q${q}`, outstanding: [], emailed: false }); continue; }

    const daysLeft = Math.max(0, Math.ceil((close.getTime() - now.getTime()) / DAY));
    const names = outstanding.map(branchLabel).join(", ");

    // Standing in-app alert (idempotent by quarter).
    await prisma.alert.upsert({
      where: { dedupeKey: `scorecard_due:${year}Q${q}` },
      create: { type: "scorecard_due", severity: daysLeft <= 14 ? "critical" : "warning", status: "open", dedupeKey: `scorecard_due:${year}Q${q}`, message: `Q${q} ${year} branch scorecards are due (${daysLeft}d left): ${names}.` },
      update: { message: `Q${q} ${year} branch scorecards are due (${daysLeft}d left): ${names}.`, status: "open", severity: daysLeft <= 14 ? "critical" : "warning" },
    }).catch(() => null);

    // Weekly email (guarded by a Setting) — ONLY the managers of the branches
    // that are still outstanding, plus HR as an oversight copy. Not every
    // manager/admin/HR company-wide.
    const key = `scorecard_due_email:${year}Q${q}`;
    const setting = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
    const last = setting?.value ? new Date(setting.value) : null;
    const dueForEmail = !last || now.getTime() - last.getTime() >= 7 * DAY;
    let emailed = false;
    if (dueForEmail) {
      const managers = await prisma.user.findMany({ where: { active: true, role: "manager", branch: { in: outstanding } }, select: { email: true } });
      const recipients = [...new Set([...managers.map((u) => u.email), await getHrEmail()].filter(Boolean))];
      const link = `${base()}/management/scorecards?year=${year}&quarter=${q}`;
      const r = await sendEmail({
        to: recipients,
        subject: `Quarterly branch scorecards due: Q${q} ${year} (${daysLeft}d left)`,
        kind: "scorecard_due", relatedType: "scorecard_period", relatedId: `${year}Q${q}`,
        text: `Reminder: Q${q} ${year} branch manager scorecards are due 30–60 days after quarter-end — ${daysLeft} day(s) remain.\n\nStill outstanding: ${names}.\n\nStart or finish them here: ${link}\n\n— CanopyOS`,
        html: `<p>Reminder: <strong>Q${q} ${year}</strong> branch manager scorecards are due 30–60 days after quarter-end — <strong>${daysLeft} day(s)</strong> remain.</p><p>Still outstanding: <strong>${names}</strong>.</p><p><a href="${link}">Open the scorecards →</a></p><p>— CanopyOS</p>`,
      }).catch(() => null);
      emailed = !!r;
      await prisma.setting.upsert({ where: { key }, create: { key, value: now.toISOString() }, update: { value: now.toISOString() } }).catch(() => null);
    }
    results.push({ period: `${year}Q${q}`, outstanding, emailed });
  }
  return results;
}

/**
 * Monthly sales-goal review reminder — the first week of each month, alert the
 * Sales Director (and admins, who also manage sales) to (1) review & APPROVE
 * everyone's goals for the new month and (2) review & VERIFY last month's actuals.
 * In-app Alert is idempotent per month; the email is weekly-guarded by a Setting
 * stamp (mirrors `remindScorecardsDue`). No-ops after day 7.
 */
export async function remindMonthlyGoals() {
  const now = new Date();
  const day = now.getUTCDate();
  if (day > 7) return { skipped: "outside first week", day };

  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const link = `${base()}/sales`;
  const message = `New month (${monthLabel}) — review & approve this month's sales goals and verify last month's actuals.`;
  const DAY = 86_400_000;

  // Standing in-app alert, idempotent per month.
  await prisma.alert.upsert({
    where: { dedupeKey: `sales_goals_review:${periodKey}` },
    create: { type: "sales_goals_review", severity: "warning", status: "open", dedupeKey: `sales_goals_review:${periodKey}`, message },
    update: { message, status: "open", severity: "warning" },
  }).catch(() => null);

  // Weekly-guarded email to the Sales Director(s); fall back to admins if none.
  const key = `sales_goals_review_email:${periodKey}`;
  const setting = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  const last = setting?.value ? new Date(setting.value) : null;
  const dueForEmail = !last || now.getTime() - last.getTime() >= 7 * DAY;
  let emailed = false;
  if (dueForEmail) {
    const directors = await prisma.user.findMany({ where: { active: true, accessLevel: "sales_director" }, select: { email: true } });
    let recipients = directors.map((d) => d.email).filter(Boolean);
    if (recipients.length === 0) {
      const admins = await prisma.user.findMany({ where: { active: true, role: "admin" }, select: { email: true } });
      recipients = admins.map((a) => a.email).filter(Boolean);
    }
    recipients = [...new Set(recipients)];
    if (recipients.length) {
      const r = await sendEmail({
        to: recipients,
        subject: `Sales goals — review & approve for ${monthLabel}`,
        kind: "sales_goals_review", relatedType: "sales_period", relatedId: periodKey,
        text: `It's a new month. Two things to do in the Sales Team hub:\n\n1. Review & APPROVE each advisor's ${monthLabel} sales goal (approve the ones awaiting you, propose where needed).\n2. Review & VERIFY last month's actuals so everyone's funnel + pace are accurate.\n\nOpen the Sales Team hub: ${link}\n\n— CanopyOS`,
        html: `<p>It's a new month. Two things to do in the Sales Team hub:</p><ol><li>Review &amp; <strong>approve</strong> each advisor's ${monthLabel} sales goal (approve the ones awaiting you, propose where needed).</li><li>Review &amp; <strong>verify</strong> last month's actuals so everyone's funnel + pace are accurate.</li></ol><p><a href="${link}">Open the Sales Team hub →</a></p><p>— CanopyOS</p>`,
      }).catch(() => null);
      emailed = !!r;
    }
    await prisma.setting.upsert({ where: { key }, create: { key, value: now.toISOString() }, update: { value: now.toISOString() } }).catch(() => null);
  }
  return { periodKey, emailed };
}

/**
 * Daily birthday + work-anniversary celebrations. For every active employee whose
 * birthday or work anniversary (>= 1 year) falls TODAY in Eastern Time, this:
 *   1. Auto-posts a Buzz "shoutout" to the company bulletin (birthday first if
 *      both land today), published immediately.
 *   2. Sends the employee's supervisor (their org-chart `reportsTo` → linked
 *      login) a heads-up in Messages/Inbox, which emails them too.
 *
 * Both are idempotent once-per-person-per-YEAR via `Setting` stamp keys
 * (mirrors the `remindScorecardsDue` Setting-stamp pattern) so re-running the day's
 * cron — or a manual run — never duplicates. Each employee is wrapped in its own
 * try/catch so one failure can't abort the batch. The birth YEAR is never used or
 * exposed here — celebrations are month+day only.
 */
export async function runCelebrations() {
  const now = new Date();
  const { month, day, year } = etParts(now);

  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    select: {
      id: true, name: true, branch: true, hireDate: true, birthMonth: true, birthDay: true,
      reportsTo: { include: { user: { select: { id: true, name: true, email: true, active: true } } } },
    },
  });

  let posts = 0;
  let notifications = 0;
  let errors = 0;

  for (const e of employees) {
    try {
      const first = e.name.split(" ")[0] || e.name;
      const branchTag = e.branch ? ` (${branchLabel(e.branch)})` : "";

      // Which celebrations land today (ET)? Birthday first, then anniversary.
      const events: { kind: "birthday" | "anniversary"; years: number | null }[] = [];
      if (e.birthMonth === month && e.birthDay === day) events.push({ kind: "birthday", years: null });
      if (e.hireDate && e.hireDate.getUTCMonth() + 1 === month && e.hireDate.getUTCDate() === day) {
        const years = year - e.hireDate.getUTCFullYear();
        if (years >= 1) events.push({ kind: "anniversary", years });
      }
      if (events.length === 0) continue;

      // Resolve the supervisor's active login (org-chart reports-to → their user).
      const sup = e.reportsTo?.user ?? null;
      const supervisor = sup && sup.active && sup.email ? sup : null;

      for (const { kind, years } of events) {
        // --- 1. Bulletin auto-post (dedupe once/year) ---
        const postKey = `celebration_post:${kind}:${e.id}:${year}`;
        const postStamp = await prisma.setting.findUnique({ where: { key: postKey } }).catch(() => null);
        if (!postStamp) {
          const title = kind === "birthday"
            ? `Happy Birthday, ${first}!`
            : `${first} — ${years} year${years === 1 ? "" : "s"} at Clements!`;
          const excerpt = kind === "birthday"
            ? `Wishing ${first} a very happy birthday from everyone at Clements!`
            : `Congratulations to ${first} on ${years} year${years === 1 ? "" : "s"} at Clements${branchTag} — thank you for all you do!`;
          await prisma.bulletinPost.create({
            data: {
              type: "shoutout",
              title,
              excerpt,
              honoreeId: e.id,
              honoreeName: e.name,
              branch: e.branch,
              published: true,
              publishAt: now,
              authorName: "Buzz",
            },
          });
          // Stamp AFTER a successful create so a mid-run failure retries next run.
          await prisma.setting.create({ data: { key: postKey, value: now.toISOString() } });
          posts++;
        }

        // --- 2. Supervisor heads-up in Messages/Inbox (dedupe once/year) ---
        if (supervisor) {
          const notifyKey = `celebration_notify:${kind}:${e.id}:${year}`;
          const notifyStamp = await prisma.setting.findUnique({ where: { key: notifyKey } }).catch(() => null);
          if (!notifyStamp) {
            const subject = kind === "birthday"
              ? `Birthday today: ${e.name}`
              : `${e.name} — ${years}-year work anniversary today`;
            const body = kind === "birthday"
              ? `It's ${e.name}'s birthday today${branchTag}. Take a moment to wish ${first} a happy birthday — a quick word from their supervisor goes a long way.`
              : `${e.name}${branchTag} celebrates ${years} year${years === 1 ? "" : "s"} at Clements today. Please take a moment to recognize ${first} for the milestone.`;
            const thread = await prisma.thread.create({
              data: {
                subject,
                branch: e.branch,
                contextType: "employee",
                contextId: e.id,
                contextLabel: e.name,
                contextHref: `/my-branch/team/${e.id}`,
                createdByName: "Buzz",
                updatedAt: now,
                messages: { create: { authorName: "Buzz", body } },
                participants: { create: [{ userId: supervisor.id, name: supervisor.name, email: supervisor.email }] },
              },
            });
            await notifyThread({
              threadId: thread.id,
              subject,
              contextLabel: e.name,
              authorName: "Buzz",
              authorUserId: null,
              body,
              isNew: true,
            }).catch(() => {});
            await prisma.setting.create({ data: { key: notifyKey, value: now.toISOString() } });
            notifications++;
          }
        }
      }
    } catch (err) {
      errors++;
      console.error(`[runCelebrations] ${e.id} (${e.name}) failed:`, err);
    }
  }

  return { candidates: employees.length, posts, notifications, errors };
}
