import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/app-url";
import { hrDirectorEmail } from "@/lib/personnel";
import { superAdminRecipients } from "@/lib/product-requests";
import { quarterlyBonusBreakdown, monthLabel, MIN_BONUS_TIER } from "@/lib/sales-review-data";
import { SALES_REVIEW_METRICS, SALES_REVIEW_SECTIONS, DIRECTOR_PROFILE } from "@/lib/sales-review";

// Persistence + release/sign-off for the Quarterly Sales Director Review.
// Mirrors the manager scorecard flow: the COO fills the form and RELEASES it
// (snapshot persisted, token minted, emailed to the Director), the Director
// e-signs via the tokenized link, which files the review to their personnel
// record and copies HR + the super admins.

export type ReleaseDraft = {
  hits?: Record<string, boolean>;
  metrics?: Record<string, { score?: string; note?: string }>;
  answers?: Record<string, string>;
  rating?: string;
  reviewerName?: string;
  directorName?: string;
  reviewDate?: string;
};

export type ReleaseSnapshot = {
  periodLabel: string;
  bonus: number;
  rating: string;
  reviewDate: string;
  perfGroups: {
    branch: string;
    label: string;
    totalSales: number;
    bonus: number;
    months: { id: string; monthLabel: string; target: number; actual: number; tierPct: number; hit: boolean; bonus: number }[];
  }[];
  veroGroup: { label: string; totalSales: number; months: { monthLabel: string; sales: number }[] } | null;
  intangibles: { key: string; label: string; score: string; note: string }[];
  notes: { key: string; label: string; answer: string }[];
};

/** One sales review per year+quarter. */
export async function getSalesReview(year: number, quarter: number) {
  return prisma.salesReview.findUnique({ where: { year_quarter: { year, quarter } } });
}

export function parseSnapshot(data: string | null | undefined): ReleaseSnapshot | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as ReleaseSnapshot;
  } catch {
    return null;
  }
}

/** Resolve the Sales Director's employee record + email (Howard Cohn). */
export async function resolveDirector(): Promise<{ employeeId: string | null; name: string; email: string | null; branch: string | null }> {
  let emp = await prisma.employee.findFirst({
    where: { OR: [{ name: { contains: "Cohn" } }, { name: DIRECTOR_PROFILE.name }] },
    include: { user: { select: { email: true } } },
  });
  // Fallback: the employee profile linked to the Sales Director login.
  if (!emp) {
    const u = await prisma.user.findFirst({ where: { accessLevel: "sales_director", active: true, employeeId: { not: null } }, select: { employeeId: true } });
    if (u?.employeeId) emp = await prisma.employee.findUnique({ where: { id: u.employeeId }, include: { user: { select: { email: true } } } });
  }
  return {
    employeeId: emp?.id ?? null,
    name: emp?.name ?? DIRECTOR_PROFILE.name,
    email: emp?.email || emp?.user?.email || null,
    branch: emp?.branch ?? null,
  };
}

/**
 * Build the released snapshot. The branch sales + bonus tiers are re-derived
 * server-side from the authoritative data (quarterlyBonusBreakdown), so the client
 * can only drive the Met/Not toggles, the intangible scores, the notes and the
 * rating — never the dollars.
 */
function buildSnapshot(year: number, quarter: number, draft: ReleaseDraft): ReleaseSnapshot {
  const breakdown = quarterlyBonusBreakdown(year, quarter);
  const perfGroups = breakdown.branches.map((b) => {
    const months = b.months.map((c) => {
      const id = `${b.branch}:${c.key}`;
      const hit = draft.hits?.[id] ?? c.hit;
      const bonus = hit ? Math.round((c.sales * c.pct) / 100) : 0;
      return { id, monthLabel: monthLabel(c.key).replace(` ${year}`, ""), target: MIN_BONUS_TIER, actual: c.sales, tierPct: c.pct, hit, bonus };
    });
    return { branch: b.branch, label: b.label, totalSales: b.totalSales, bonus: months.reduce((s, m) => s + m.bonus, 0), months };
  });
  const bonus = perfGroups.reduce((s, g) => s + g.bonus, 0);
  const veroGroup = breakdown.vero
    ? { label: "Vero Beach", totalSales: breakdown.vero.totalSales, months: breakdown.vero.months.map((v) => ({ monthLabel: v.label, sales: v.sales })) }
    : null;
  const intangibles = SALES_REVIEW_METRICS.map((m) => ({ key: m.key, label: m.label, score: draft.metrics?.[m.key]?.score ?? "", note: draft.metrics?.[m.key]?.note ?? "" }));
  const notes = SALES_REVIEW_SECTIONS.flatMap((sec) => sec.questions.map((q) => ({ key: q.key, label: q.label, answer: draft.answers?.[q.key] ?? "" })));
  return { periodLabel: `Q${quarter} ${year}`, bonus, rating: draft.rating ?? "", reviewDate: draft.reviewDate ?? "", perfGroups, veroGroup, intangibles, notes };
}

/**
 * Release the review: persist the snapshot, mint a sign token, and email the
 * Sales Director the tokenized sign link. Re-releasing (after a revise) overwrites
 * the snapshot and clears any prior Director signature. Returns the resolved
 * recipient + sign URL + email status for the UI.
 */
export async function releaseSalesReview(opts: {
  year: number;
  quarter: number;
  draft: ReleaseDraft;
  reviewerName: string;
  baseUrl?: string;
}): Promise<{ ok: true; reviewId: string; directorEmail: string | null; directorName: string; signUrl: string; emailStatus: string; bonus: number }> {
  const { year, quarter } = opts;
  const snapshot = buildSnapshot(year, quarter, opts.draft);
  const director = await resolveDirector();
  const token = randomBytes(24).toString("base64url");
  const directorName = opts.draft.directorName?.trim() || director.name;

  const base = {
    status: "released",
    data: JSON.stringify(snapshot),
    bonus: snapshot.bonus,
    reviewerName: opts.reviewerName || null,
    reviewerSignedAt: new Date(),
    releasedAt: new Date(),
    directorName,
    signToken: token,
    employeeId: director.employeeId,
    directorSignName: null,
    directorSignedAt: null,
    personnelRecordId: null,
  };
  const review = await prisma.salesReview.upsert({
    where: { year_quarter: { year, quarter } },
    create: { year, quarter, ...base },
    update: base,
  });

  const signUrl = `${(opts.baseUrl || appUrl()).replace(/\/$/, "")}/sales-review-sign/${token}`;
  const bonusStr = `$${snapshot.bonus.toLocaleString()}`;
  const r = await sendEmail({
    to: director.email,
    subject: `Signature needed: your ${snapshot.periodLabel} Sales Director review`,
    kind: "sales_review_sign_request",
    relatedType: "sales_review",
    relatedId: review.id,
    text: `Hi ${directorName.split(" ")[0]},\n\nYour ${snapshot.periodLabel} quarterly Sales Director review has been completed and is ready for your signature. Open the secure link below to review the branch performance, bonus (${bonusStr}), notes, and add your signature:\n\n${signUrl}\n\nYour signature confirms receipt and discussion — not necessarily agreement. Once you sign, the review is filed to your personnel record and a copy goes to HR.\n\n— CanopyOS`,
    html: `<p>Hi ${directorName.split(" ")[0]},</p><p>Your <strong>${snapshot.periodLabel}</strong> quarterly Sales Director review has been completed and is ready for your signature.</p><p>Quarterly bonus: <strong>${bonusStr}</strong></p><p><a href="${signUrl}">Review &amp; sign your review →</a></p><p style="color:#5b7a70;font-size:13px">Your signature confirms receipt and discussion — not necessarily agreement. Once you sign, the review is filed to your personnel record and a copy goes to HR.</p><p>— CanopyOS</p>`,
  }).catch(() => null);

  return { ok: true, reviewId: review.id, directorEmail: director.email, directorName, signUrl, emailStatus: r?.status ?? "error", bonus: snapshot.bonus };
}

/** Re-open a released (or signed) review back to draft so the COO can revise it. */
export async function reopenSalesReview(year: number, quarter: number) {
  const review = await getSalesReview(year, quarter);
  if (!review) return { ok: false as const, error: "No released review to reopen." };
  await prisma.salesReview.update({
    where: { id: review.id },
    data: { status: "draft", signToken: null },
  });
  return { ok: true as const };
}

/** The latest sign-request email attempt logged for a review (admin visibility). */
export async function lastSalesReviewSignEmail(reviewId: string) {
  const row = await prisma.emailLog.findFirst({
    where: { kind: "sales_review_sign_request", relatedId: reviewId },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true, error: true },
  }).catch(() => null);
  return row ? { status: row.status, at: row.createdAt, error: row.error } : null;
}

/**
 * Record the Director's signature (via the tokenized public link) and finalize:
 * file the review to the Director's personnel record and notify HR + the super
 * admins + the Director. Idempotent-ish: refuses a second signature.
 */
export async function signSalesReview(token: string, directorSignName: string): Promise<{ ok: true; bonus: number; periodLabel: string } | { ok: false; code: number; error: string }> {
  const review = await prisma.salesReview.findUnique({ where: { signToken: token } });
  if (!review) return { ok: false, code: 404, error: "This signing link is not valid or has already been used." };
  if (review.status === "signed") return { ok: false, code: 409, error: "This review is already signed and on file." };

  await prisma.salesReview.update({
    where: { id: review.id },
    data: { directorSignName: directorSignName.trim(), directorSignedAt: new Date(), status: "signed", signToken: null },
  });
  const fin = await finalizeSalesReview(review.id).catch((e) => ({ error: String(e) }));
  const snapshot = parseSnapshot(review.data);
  if ((fin as { error?: string }).error) {
    // Signed, but filing failed — leave it signed; an admin can re-file.
    return { ok: true, bonus: review.bonus, periodLabel: snapshot?.periodLabel ?? `Q${review.quarter} ${review.year}` };
  }
  return { ok: true, bonus: review.bonus, periodLabel: snapshot?.periodLabel ?? `Q${review.quarter} ${review.year}` };
}

/**
 * File the signed review to the Director's personnel record (create or overwrite)
 * and email the completion notice to HR + the super admins + the Director.
 */
export async function finalizeSalesReview(reviewId: string) {
  const review = await prisma.salesReview.findUnique({ where: { id: reviewId } });
  if (!review) throw new Error("Sales review not found.");
  if (!review.directorSignedAt) throw new Error("The Director has not signed yet.");
  const snapshot = parseSnapshot(review.data);
  const periodLabel = snapshot?.periodLabel ?? `Q${review.quarter} ${review.year}`;
  const bonusStr = `$${review.bonus.toLocaleString()}`;

  // Re-resolve if the Director's profile wasn't linked at release time.
  const directorId = review.employeeId ?? (await resolveDirector()).employeeId;
  const director = directorId
    ? await prisma.employee.findUnique({ where: { id: directorId }, include: { user: { select: { email: true } } } })
    : null;
  if (director && !review.employeeId) await prisma.salesReview.update({ where: { id: review.id }, data: { employeeId: director.id } });

  // Build the filed body from the snapshot.
  const perfLines = (snapshot?.perfGroups ?? [])
    .map((g) => `${g.label}: $${g.totalSales.toLocaleString()} this quarter — bonus $${g.bonus.toLocaleString()}`)
    .join("\n");
  const intangibleLines = (snapshot?.intangibles ?? [])
    .filter((m) => m.score || m.note)
    .map((m) => `${m.label}: ${m.score || "—"}${m.note ? ` — ${m.note}` : ""}`)
    .join("\n");
  const noteLines = (snapshot?.notes ?? [])
    .filter((n) => n.answer)
    .map((n) => `${n.label}: ${n.answer}`)
    .join("\n\n");
  const title = `${periodLabel} Sales Director review — bonus ${bonusStr}`;
  const bodyText = [
    snapshot?.rating ? `Overall rating: ${snapshot.rating}` : null,
    `Quarterly bonus: ${bonusStr}`,
    perfLines ? `Branch performance:\n${perfLines}` : null,
    intangibleLines ? `Role & leadership:\n${intangibleLines}` : null,
    noteLines ? noteLines : null,
    review.directorSignName ? `Signed by ${review.directorSignName} on ${review.directorSignedAt?.toLocaleDateString()}.` : null,
    review.reviewerName ? `Reviewer: ${review.reviewerName}.` : null,
  ].filter(Boolean).join("\n\n") || null;
  const details = JSON.stringify({ kind: "sales_director_review", year: review.year, quarter: review.quarter, bonus: review.bonus, reviewId: review.id });

  let personnelRecordId = review.personnelRecordId;
  if (director) {
    if (personnelRecordId) {
      await prisma.personnelRecord.update({ where: { id: personnelRecordId }, data: { title, body: bodyText, details, branch: director.branch ?? null } }).catch(async () => {
        const rec = await prisma.personnelRecord.create({ data: { employeeId: director.id, branch: director.branch ?? null, type: "note", category: "review", title, body: bodyText, details, authorName: review.reviewerName ?? "COO" } });
        personnelRecordId = rec.id;
      });
    } else {
      const rec = await prisma.personnelRecord.create({ data: { employeeId: director.id, branch: director.branch ?? null, type: "note", category: "review", title, body: bodyText, details, authorName: review.reviewerName ?? "COO" } });
      personnelRecordId = rec.id;
    }
    await prisma.salesReview.update({ where: { id: review.id }, data: { personnelRecordId } });
  }

  // Completion notice → HR director + super admins (Chris/Julie/April) + the Director.
  const link = `${appUrl()}/sales/quarterly-review?year=${review.year}&quarter=${review.quarter}`;
  const admins = await superAdminRecipients().catch(() => []);
  const directorEmail = director?.email || director?.user?.email || null;
  const recipients = [...new Set([hrDirectorEmail(), ...admins.map((a) => a.email), directorEmail].filter(Boolean) as string[])];
  await sendEmail({
    to: recipients,
    subject: `Sales Director review signed: ${DIRECTOR_PROFILE.name} ${periodLabel} — bonus ${bonusStr}`,
    kind: "sales_review_signed",
    relatedType: "sales_review",
    relatedId: review.id,
    text: `${DIRECTOR_PROFILE.name}'s ${periodLabel} Sales Director review is complete and signed.\n\nQuarterly bonus: ${bonusStr}\nPlease pay ${bonusStr} on the next payroll cycle.${director ? `\nFiled to ${director.name}'s personnel record.` : ""}\n\n${link}\n\n— CanopyOS`,
    html: `<p><strong>${DIRECTOR_PROFILE.name}</strong>'s <strong>${periodLabel}</strong> Sales Director review is complete and signed.</p><p>Quarterly bonus: <strong>${bonusStr}</strong><br/>Please pay <strong>${bonusStr}</strong> on the next payroll cycle.</p>${director ? `<p>Filed to <strong>${director.name}</strong>'s personnel record.</p>` : ""}<p><a href="${link}">View the review →</a></p><p>— CanopyOS</p>`,
  }).catch(() => null);

  return { ok: true, bonus: review.bonus, personnelRecordId };
}
