import { prisma } from "@/lib/prisma";
import { cell, periodValues, BRANCHES, branchLabel, type Cell } from "@/lib/management";
import { branchQuarterAll, type BranchKpiKey } from "@/lib/branch-kpis";
import { notifyList, hrDirectorEmail } from "@/lib/personnel";
import { sendEmail, type SendResult } from "@/lib/email";
import { quarterInspectionCompliance } from "@/lib/inspection";
import { quarterWarehouseCompliance } from "@/lib/warehouse";
import { quarterTrainingCompliance } from "@/lib/training";
import { quarterQcCompliance } from "@/lib/qc";
import { matchEmployeeByName } from "@/lib/people";

// The quarterly branch-manager bonus scorecard. Binary Met/Not-Met, weighted to
// 100%, per the company template. Most metrics auto-compute from the canonical
// budget model already in the app — production/margin/tech-wages/stops/new-sales
// from the branch model, and cancellations ($) + attrition rate (%) from a book
// value allocated per branch (see `allocatedBranchBook`). The rest are reviewer
// Y/N (compliance) or a manual figure until a data source is wired up.

// "placeholder" = a metric shown on the scorecard but not yet auto-computed (no
// per-branch data source wired up); the reviewer marks it manually for now.
export type MetricType = "auto" | "manual" | "compliance" | "placeholder";
export type Direction = "higher" | "lower";

export type ScorecardMetric = {
  key: string;
  label: string;
  weight: number; // percent
  type: MetricType;
  direction?: Direction; // for auto/manual numeric metrics
  kpi?: string; // KpiValue key for auto metrics
  ratioOf?: string; // if set, metric = kpi / ratioOf (e.g. tech wages / production)
  unit?: "usd" | "pct" | "count";
  // A fixed target that overrides the MBR budget (a company policy figure rather
  // than a per-branch budget line).
  fixedTarget?: number;
  // A per-quarter target that pro-rates against the YTD actual: the effective
  // target is `perQuarterTarget × quarter` (e.g. attrition 2.5%/qtr → Q1 2.5%,
  // Q2 YTD 5.0%, Q3 7.5%, full year 10%). Overrides fixedTarget when set.
  perQuarterTarget?: number;
  // Attrition rate (%): actual = kpi(YTD $) ÷ allocated branch book × 100, i.e.
  // cancellations as a percentage of forward book. Pairs with perQuarterTarget.
  bookRate?: boolean;
  // Quarterly branch KPI (production / new_sales / cancellations): actual + budget
  // are the SUM of the quarter's three monthly figures from the 2026 Branch KPIs
  // workbook (target = budget; actual = live MBR monthly, else workbook). See
  // lib/branch-kpis.ts. Overrides the model YTD read for this metric.
  quarterlyBranchKpi?: BranchKpiKey;
  // Explanatory hint rendered under a placeholder metric.
  placeholderHint?: string;
  // A "verify before you rely on this" flag shown on the row; also suppresses the
  // auto Met/Not suggestion so a reviewer must consciously confirm it.
  todo?: string;
};

// The quarterly manager scorecard — 8 weighted KPIs mirroring the Q1 2026
// template (e.g. Adam Goetz / Stuart). The three headline dollar categories —
// Total Production, New Sales, Cancellations — are QUARTERLY: actual + budget are
// the sum of that quarter's three monthly figures from the 2026 Branch KPIs
// workbook (see lib/branch-kpis.ts). Margin %, Technician Wages %, and Stops read
// the branch's YTD figure from the budget model (Branch Frcst); Attrition Rate is
// a book-based % ceiling. "Net after Labor (Margin %)" uses the model's
// definition. Scoring = binary Met/Not, weighted to 100.
export const SCORECARD_METRICS: ScorecardMetric[] = [
  { key: "production", label: "Total Production Revenue", weight: 20, type: "auto", direction: "higher", unit: "usd", quarterlyBranchKpi: "production" },
  { key: "net_after_labor_margin", label: "Net after Labor (Margin %)", weight: 15, type: "auto", direction: "higher", kpi: "margin_pct", unit: "pct" },
  { key: "tech_wages_pct", label: "Technician Wages % of Revenue", weight: 10, type: "auto", direction: "lower", kpi: "tech_wages", ratioOf: "production", unit: "pct" },
  { key: "stops", label: "Stops Completed", weight: 10, type: "auto", direction: "higher", kpi: "stops", unit: "count" },
  { key: "new_sales", label: "New Sales", weight: 15, type: "auto", direction: "higher", unit: "usd", quarterlyBranchKpi: "new_sales" },
  { key: "cancellations", label: "Cancellations", weight: 15, type: "auto", direction: "lower", unit: "usd", quarterlyBranchKpi: "cancellations" },
  // Chemical is purchase-based per branch (MMR) but only company-wide in the
  // model — a known gap the Q1 card itself flagged. Placeholder until branch
  // chemical is wired; reviewer marks it manually.
  { key: "chemical_pct", label: "Chemical Cost % of Revenue", weight: 5, type: "placeholder", direction: "lower", unit: "pct", placeholderHint: "Per-branch chemical is purchase-based (MMR); the model carries chemical company-wide only — mark manually until branch chemical is wired." },
  { key: "attrition_rate", label: "Attrition Rate (YTD)", weight: 10, type: "auto", direction: "lower", kpi: "attrition", unit: "pct", perQuarterTarget: 2.5, bookRate: true },
  // Field QC ride-behinds — auto-suggested Met/Not from real completion (goal
  // 20/month → 60/quarter; see lib/qc.ts). Weight 0 for now: it appears on the
  // card and auto-computes, but does not change the bonus total until the owner
  // assigns it a weight and rebalances the other lines to 100%.
  { key: "quality_control", label: "Quality Control (field ride-behinds)", weight: 0, type: "compliance", direction: "higher", unit: "count" },
];

export const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

export type AutoActual = { actual: number | null; budget: number | null; unit: "usd" | "pct" | "count" };

/**
 * Per-branch forward book value. The canonical model carries "Forward 12-Mo Book
 * Value" **company-wide only**, so we ALLOCATE it to a branch by that branch's
 * share of YTD production:
 *
 *   allocated book = company book × (branch production YTD ÷ Σ branch production YTD)
 *
 * This is a derived figure (labeled as such on the scorecard). Swap in a real
 * per-branch book value the moment the model provides one — nothing else changes.
 * Returns null when book or the production shares aren't loaded for the period.
 */
export function allocatedBranchBook(vm: Map<string, Cell>, branch: string): number | null {
  const book = cell(vm, "book_value", "company", "month").actual;
  if (book == null) return null;
  let companyProd = 0;
  let branchProd: number | null = null;
  for (const b of BRANCHES) {
    const p = cell(vm, "production", b.key, "ytd").actual;
    if (p != null) {
      companyProd += p;
      if (b.key === branch) branchProd = p;
    }
  }
  if (!companyProd || branchProd == null) return null;
  return book * (branchProd / companyProd);
}

/**
 * Actual + budget for the auto metrics at a branch scope, read as the **YTD**
 * figure from the quarter-end month's period (e.g. Q2 → the June 2026 period's
 * `ytd` basis). This uses the canonical budget model's verified YTD numbers
 * (Branch Frcst), which reconcile to the MBR — rather than summing individual
 * months, which aren't loaded per branch. Ratio metrics (tech wages %, etc.)
 * are computed as YTD-numerator ÷ YTD-denominator so they aggregate correctly.
 * Percent KPIs already stored as a percentage (e.g. margin_pct) are read directly.
 */
export async function autoActuals(
  year: number,
  quarter: number,
  branch: string
): Promise<Record<string, AutoActual>> {
  const months = QUARTER_MONTHS[quarter] ?? [];
  const endMonth = months.length ? months[months.length - 1] : 12;
  const period = await prisma.reportPeriod.findFirst({ where: { year, month: endMonth } });
  const vm = period ? await periodValues(period.id) : null;

  // Read a KPI's YTD actual/budget for the branch.
  const read = (kpi: string): { actual: number | null; budget: number | null } => {
    if (!vm) return { actual: null, budget: null };
    const c: Cell = cell(vm, kpi, branch as never, "ytd");
    return { actual: c.actual, budget: c.budget };
  };

  // Forward book value allocated to this branch (production-share) — powers the
  // book-based attrition-rate %.
  const book = vm ? allocatedBranchBook(vm, branch) : null;

  // Quarterly branch KPIs (production / new_sales / cancellations) — actual +
  // budget summed across the quarter's three months from the 2026 Branch KPIs
  // workbook. One pair of loads for all three.
  const bq = await branchQuarterAll(branch, year, quarter);

  const out: Record<string, AutoActual> = {};
  for (const m of SCORECARD_METRICS) {
    if (m.type !== "auto") continue;
    if (m.quarterlyBranchKpi) {
      const c = bq[m.quarterlyBranchKpi];
      out[m.key] = { actual: c.actual, budget: c.target, unit: m.unit ?? "usd" };
      continue;
    }
    if (!m.kpi) continue;
    if (m.bookRate) {
      // Attrition rate = branch cancellations (YTD $) ÷ allocated book × 100.
      const s = read(m.kpi);
      const actual = s.actual != null && book ? (s.actual / book) * 100 : null;
      out[m.key] = { actual, budget: null, unit: "pct" };
      continue;
    }
    if (m.ratioOf) {
      const num = read(m.kpi);
      const den = read(m.ratioOf);
      const pct = (n: number | null, d: number | null) => (n != null && d && d !== 0 ? (n / d) * 100 : null);
      out[m.key] = { actual: pct(num.actual, den.actual), budget: pct(num.budget, den.budget), unit: "pct" };
    } else {
      const s = read(m.kpi);
      out[m.key] = { actual: s.actual, budget: s.budget, unit: m.unit ?? "usd" };
    }
  }
  return out;
}

/** Suggested Met/Not-Met from an auto metric's actual vs budget target. */
export function suggestMet(direction: Direction | undefined, actual: number | null, target: number | null): boolean | null {
  if (actual == null || target == null || !direction) return null;
  return direction === "higher" ? actual >= target : actual <= target;
}

export type SavedResult = { target: string | null; met: boolean | null; note: string | null };

export async function savedResults(year: number, quarter: number, branch: string): Promise<Record<string, SavedResult>> {
  const rows = await prisma.scorecardResult.findMany({ where: { year, quarter, branch } });
  const out: Record<string, SavedResult> = {};
  for (const r of rows) out[r.metricKey] = { target: r.target, met: r.met, note: r.note };
  return out;
}

/** Weighted score: sum of weights of metrics marked Met (out of 100). */
export function weightedScore(metState: Record<string, boolean | null>): number {
  let earned = 0;
  for (const m of SCORECARD_METRICS) if (metState[m.key] === true) earned += m.weight;
  return earned;
}

/**
 * The full quarterly manager bonus a 100% scorecard pays out. The payout scales
 * linearly with the weighted score (a 75% card earns 75% of the pool), so HR can
 * read the exact dollar figure straight off the scorecard and the completion email.
 */
export const MANAGER_BONUS_TARGET = 1500;

/** Dollar bonus earned at a given weighted score, rounded to the dollar. */
export function bonusEarned(score: number, target = MANAGER_BONUS_TARGET): number {
  return Math.round((score / 100) * target);
}

/** Weighted score straight from the saved ScorecardResult rows for a period. */
export async function scoreFromSaved(year: number, quarter: number, branch: string): Promise<number> {
  const saved = await savedResults(year, quarter, branch);
  const metState: Record<string, boolean | null> = {};
  for (const m of SCORECARD_METRICS) metState[m.key] = saved[m.key]?.met ?? null;
  return weightedScore(metState);
}

// ---- Review completion lifecycle -----------------------------------------
// The ScorecardReview wraps the per-metric ScorecardResult rows with a header,
// four narrative reviewer-comment fields, and a three-signer sign-off, then
// archives to the manager's personnel file. See prisma/schema.prisma.

export type SignatureLite = { id: string; role: string; typedName: string; title: string | null; signedAt: Date };
export type ReviewLite = {
  id: string;
  year: number;
  quarter: number;
  branch: string;
  status: string; // "draft" | "signed" | "archived"
  signToken: string | null;
  managerName: string | null;
  reviewerName: string | null;
  reviewDate: Date | null;
  overallNotes: string | null;
  strengths: string | null;
  areas: string | null;
  goals: string | null;
  score: number | null;
  employeeId: string | null;
  personnelRecordId: string | null;
  finalizedAt: Date | null;
  archivedAt: Date | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  signatures: SignatureLite[];
};

/** Load (never create) the review document for a period, with its signatures. */
export async function getScorecardReview(year: number, quarter: number, branch: string): Promise<ReviewLite | null> {
  const r = await prisma.scorecardReview.findUnique({
    where: { year_quarter_branch: { year, quarter, branch } },
    include: { signatures: { orderBy: { signedAt: "asc" } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    year: r.year,
    quarter: r.quarter,
    branch: r.branch,
    status: r.status,
    signToken: r.signToken,
    managerName: r.managerName,
    reviewerName: r.reviewerName,
    reviewDate: r.reviewDate,
    overallNotes: r.overallNotes,
    strengths: r.strengths,
    areas: r.areas,
    goals: r.goals,
    score: r.score,
    employeeId: r.employeeId,
    personnelRecordId: r.personnelRecordId,
    finalizedAt: r.finalizedAt,
    archivedAt: r.archivedAt,
    reopenedAt: r.reopenedAt,
    reopenedBy: r.reopenedBy,
    signatures: r.signatures.map((s) => ({ id: s.id, role: s.role, typedName: s.typedName, title: s.title, signedAt: s.signedAt })),
  };
}

/** Whether a review has the two required signatures: the supervisor + the manager. */
export function hasRequiredSignatures(signatures: { role: string }[]): boolean {
  const reviewers = signatures.filter((s) => s.role === "reviewer").length; // supervisor
  const managers = signatures.filter((s) => s.role === "manager").length;
  return reviewers >= 1 && managers >= 1;
}

/**
 * Match a branch's manager to an Employee profile — by branch + a "Manager"
 * role. If a manager name is supplied (from the review header) it's used to
 * disambiguate when a branch has more than one Manager-role employee.
 */
export async function matchBranchManagerEmployee(branch: string, managerName?: string | null): Promise<{ id: string; name: string } | null> {
  const managers = await prisma.employee.findMany({
    where: { status: "active", branch, role: { contains: "Manager" } },
    select: { id: true, name: true },
  });
  if (managers.length === 0) return null;
  if (managerName && managers.length > 1) {
    const m = matchEmployeeByName(managerName, managers.map((e) => ({ id: e.id, name: e.name, role: null, division: null, branch })));
    if (m) { const hit = managers.find((e) => e.id === m); if (hit) return hit; }
  }
  return managers[0];
}

/**
 * Resolve the branch manager's email — the Employee's own address, else the
 * linked login's. Returns nulls (never throws) when no manager/email is on file,
 * so callers can surface "no address" instead of silently dropping the notice.
 */
export async function branchManagerEmail(branch: string, managerName?: string | null): Promise<{ email: string | null; name: string | null; employeeId: string | null }> {
  const emp = await matchBranchManagerEmployee(branch, managerName ?? null);
  if (!emp) return { email: null, name: null, employeeId: null };
  const row = await prisma.employee.findUnique({ where: { id: emp.id }, select: { email: true, user: { select: { email: true } } } });
  return { email: row?.email || row?.user?.email || null, name: emp.name, employeeId: emp.id };
}

/**
 * Email the branch manager the tokenized link to review + sign their scorecard.
 * Shared by publish and resend so the message is identical, and ALWAYS routed
 * through sendEmail (a null recipient is logged as `skipped_no_address`) so every
 * attempt lands in EmailLog and the caller learns the real outcome. Returns the
 * send status + resolved recipient + the absolute sign URL for the admin to copy.
 */
export async function sendManagerSignEmail(opts: {
  reviewId: string; year: number; quarter: number; branch: string; token: string; managerName?: string | null;
  // Absolute origin (e.g. https://portal.example.com) to build the sign link from
  // when APP_URL isn't configured — callers pass the live request host so the
  // emailed link is never a broken relative path.
  baseUrl?: string;
}): Promise<{ status: SendResult["status"]; managerEmail: string | null; signUrl: string }> {
  const { year, quarter, branch, token, reviewId } = opts;
  const { email } = await branchManagerEmail(branch, opts.managerName);
  const signUrl = `${(opts.baseUrl || APP_BASE()).replace(/\/$/, "")}/scorecard-sign/${token}`;
  const b = branchLabel(branch);
  const r = await sendEmail({
    to: email,
    subject: `Signature needed: your Q${quarter} ${year} ${b} scorecard`,
    kind: "scorecard_sign_request", relatedType: "scorecard_review", relatedId: reviewId,
    text: `Your Q${quarter} ${year} branch scorecard has been reviewed and is ready for your signature. Open the secure link below to review the final scorecard and comments and add your signature:\n\n${signUrl}\n\nYour signature confirms receipt and discussion of the ratings — not necessarily agreement. Once you sign, the scorecard is finalized.\n\n— CanopyOS`,
    html: `<p>Your <strong>Q${quarter} ${year}</strong> ${b} branch scorecard has been reviewed and is ready for your signature.</p><p><a href="${signUrl}">Review &amp; sign your scorecard →</a></p><p style="color:#5b7a70;font-size:13px">Your signature confirms receipt and discussion of the ratings — not necessarily agreement. Once you sign, the scorecard is finalized.</p><p>— CanopyOS</p>`,
  }).catch(() => null);
  return { status: r?.status ?? "error", managerEmail: email, signUrl };
}

/** The latest sign-request email attempt logged for a review (for admin visibility). */
export async function lastSignEmail(reviewId: string): Promise<{ status: string; at: Date; error: string | null } | null> {
  const row = await prisma.emailLog.findFirst({
    where: { kind: "scorecard_sign_request", relatedId: reviewId },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true, error: true },
  });
  return row ? { status: row.status, at: row.createdAt, error: row.error } : null;
}

/** Archived reviews across the given branches, newest first (for the archive list). */
export async function listArchivedReviews(branches: string[]) {
  return prisma.scorecardReview.findMany({
    where: { status: "archived", branch: { in: branches } },
    orderBy: [{ year: "desc" }, { quarter: "desc" }, { branch: "asc" }],
    include: { signatures: { orderBy: { signedAt: "asc" } } },
  });
}

const APP_BASE = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

/** Active-admin login emails (recipients for change notices). */
async function adminEmails(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: "admin", active: true }, select: { email: true } });
  return admins.map((a) => a.email).filter(Boolean);
}

/**
 * Complete a review that now has both signatures: compute the weighted score,
 * file (or, on a post-archive edit, OVERWRITE) the manager's PersonnelRecord,
 * set status=archived, and notify stakeholders:
 *   - HR director → pay the bonus on the next payroll cycle,
 *   - leadership/HR list → the scorecard was filed,
 *   - on an edited-after-archive republish → every admin + the manager that the
 *     published version CHANGED (the profile + branch-hub copies are overwritten).
 * Idempotent-ish: safe to call once both signatures are present. Returns summary.
 */
export async function finalizeScorecard(reviewId: string, actorName: string) {
  const review = await prisma.scorecardReview.findUnique({ where: { id: reviewId }, include: { signatures: true } });
  if (!review) throw new Error("Review not found.");
  if (!hasRequiredSignatures(review.signatures)) throw new Error("Both the supervisor and manager must sign first.");

  const { year, quarter, branch } = review;
  const score = await scoreFromSaved(year, quarter, branch);
  const bonus = bonusEarned(score);
  const wasEdit = review.editedAfterArchive;

  const emp = await matchBranchManagerEmployee(branch, review.managerName);
  const title = `Q${quarter} ${year} manager scorecard — score ${score}%`;
  const bodyText = [
    review.overallNotes ? `Overall performance: ${review.overallNotes}` : null,
    review.strengths ? `Strengths: ${review.strengths}` : null,
    review.areas ? `Areas for improvement: ${review.areas}` : null,
    review.goals ? `Goals for next quarter: ${review.goals}` : null,
  ].filter(Boolean).join("\n\n") || null;
  const details = JSON.stringify({ kind: "manager_scorecard", year, quarter, branch, score, reviewId: review.id });

  let personnelRecordId = review.personnelRecordId;
  if (emp) {
    if (personnelRecordId) {
      // Overwrite the existing filed record (an edited-after-archive republish).
      await prisma.personnelRecord.update({ where: { id: personnelRecordId }, data: { title, body: bodyText, details, branch } }).catch(async () => {
        const rec = await prisma.personnelRecord.create({ data: { employeeId: emp.id, branch, type: "note", category: "scorecard", title, body: bodyText, details, authorName: actorName } });
        personnelRecordId = rec.id;
      });
    } else {
      const rec = await prisma.personnelRecord.create({ data: { employeeId: emp.id, branch, type: "note", category: "scorecard", title, body: bodyText, details, authorName: actorName } });
      personnelRecordId = rec.id;
    }
  }

  await prisma.scorecardReview.update({
    where: { id: review.id },
    data: {
      status: "archived",
      score,
      employeeId: emp?.id ?? null,
      personnelRecordId,
      finalizedAt: review.finalizedAt ?? new Date(),
      archivedAt: new Date(),
      editedAfterArchive: false,
    },
  });

  const b = branchLabel(branch);
  const link = `${APP_BASE()}/management/scorecards?year=${year}&quarter=${quarter}&branch=${branch}`;
  const empEmail = emp ? (await prisma.employee.findUnique({ where: { id: emp.id }, select: { email: true, user: { select: { email: true } } } })) : null;
  const managerEmail = empEmail?.email || empEmail?.user?.email || null;

  // 1) HR director → pay the bonus next cycle (once per archive). The dollar
  // figure is spelled out so payroll can act without re-deriving it.
  const bonusStr = `$${bonus.toLocaleString()}`;
  const poolStr = `$${MANAGER_BONUS_TARGET.toLocaleString()}`;
  await sendEmail({
    to: hrDirectorEmail(),
    subject: `Bonus payout due: ${b} Q${quarter} ${year} manager scorecard — ${score}% = ${bonusStr}`,
    kind: "scorecard_bonus", relatedType: "scorecard_review", relatedId: review.id,
    text: `The Q${quarter} ${year} manager scorecard for ${b} is complete and signed.\n\nScore: ${score}%\nQuarterly bonus earned: ${bonusStr} of ${poolStr} (${score}% of the pool)\n\nPlease pay ${emp?.name ?? "the branch manager"} ${bonusStr} on the next payroll cycle.\n\n${link}\n\n— CanopyOS`,
    html: `<p>The <strong>Q${quarter} ${year}</strong> manager scorecard for <strong>${b}</strong> is complete and signed.</p><p>Score: <strong>${score}%</strong><br/>Quarterly bonus earned: <strong>${bonusStr}</strong> of ${poolStr} (${score}% of the pool)</p><p>Please pay ${emp?.name ?? "the branch manager"} <strong>${bonusStr}</strong> on the next payroll cycle.</p><p><a href="${link}">View scorecard →</a></p><p>— CanopyOS</p>`,
  }).catch(() => null);

  // 2) Leadership/HR list → filed.
  await sendEmail({
    to: await notifyList("note"),
    subject: `Manager scorecard ${wasEdit ? "UPDATED" : "completed"}: ${b} Q${quarter} ${year} — ${score}%`,
    kind: "scorecard_archived", relatedType: "scorecard_review", relatedId: review.id,
    text: `The Q${quarter} ${year} manager scorecard for ${b} was ${wasEdit ? "edited and re-published" : "completed and archived"} by ${actorName}. Score: ${score}%.${emp ? `\n\nFiled to ${emp.name}'s personnel record + the branch hub.` : ""}\n\n${link}\n\n— CanopyOS`,
    html: `<p>The <strong>Q${quarter} ${year}</strong> manager scorecard for <strong>${b}</strong> was ${wasEdit ? "<strong>edited and re-published</strong>" : "completed and archived"} by ${actorName}. Score: <strong>${score}%</strong>.</p>${emp ? `<p>Filed to <strong>${emp.name}</strong>'s personnel record + the branch hub.</p>` : ""}<p><a href="${link}">View scorecard →</a></p><p>— CanopyOS</p>`,
  }).catch(() => null);

  // 3) Edited-after-archive → notify every admin + the manager that it CHANGED.
  if (wasEdit) {
    const recips = [...new Set([...(await adminEmails()), managerEmail].filter(Boolean) as string[])];
    await sendEmail({
      to: recips,
      subject: `Scorecard CHANGED: ${b} Q${quarter} ${year} — now ${score}%`,
      kind: "scorecard_changed", relatedType: "scorecard_review", relatedId: review.id,
      text: `Heads up: the previously-archived Q${quarter} ${year} manager scorecard for ${b} was edited by an admin (${actorName}) and re-published. The updated version (score ${score}%) has replaced the prior copy on ${emp?.name ?? "the manager"}'s profile and in the branch hub.\n\n${link}\n\n— CanopyOS`,
      html: `<p>Heads up: the previously-archived <strong>Q${quarter} ${year}</strong> manager scorecard for <strong>${b}</strong> was edited by an admin (${actorName}) and re-published.</p><p>The updated version (score <strong>${score}%</strong>) has replaced the prior copy on ${emp?.name ?? "the manager"}'s profile and in the branch hub.</p><p><a href="${link}">View scorecard →</a></p><p>— CanopyOS</p>`,
    }).catch(() => null);
  }

  return { score, filed: !!emp, personnelRecordId, changed: wasEdit };
}

export type ScorecardRow = {
  key: string;
  label: string;
  weight: number;
  type: MetricType;
  unit: "usd" | "pct" | "count" | null;
  actual: number | null;
  budgetTarget: number | null;
  target: string | null;
  met: boolean | null;
  note: string | null;
  suggested: boolean | null;
  detail: string | null;
};

/**
 * Build the scorecard rows for a branch/quarter — auto actuals + budget targets,
 * saved Met/Not, and the vehicle-inspection auto-suggestion from real
 * completion. Shared by the admin scorecard and a manager's own scorecard view.
 */
export async function buildScorecardRows(year: number, quarter: number, branch: string): Promise<ScorecardRow[]> {
  const [auto, saved, inspComp, whComp, trComp, qcComp] = await Promise.all([
    autoActuals(year, quarter, branch),
    savedResults(year, quarter, branch),
    quarterInspectionCompliance(year, quarter, branch),
    quarterWarehouseCompliance(year, quarter, branch),
    quarterTrainingCompliance(year, quarter, branch),
    quarterQcCompliance(year, quarter, branch),
  ]);
  return SCORECARD_METRICS.map((m) => {
    const a = auto[m.key];
    const savedRow = saved[m.key] ?? { target: null, met: null, note: null };
    // A per-quarter target pro-rates against the YTD actual (attrition 2.5%/qtr);
    // a fixed policy target overrides the MBR budget; otherwise use the budget.
    const budgetTarget = m.perQuarterTarget != null ? m.perQuarterTarget * quarter : (m.fixedTarget ?? a?.budget ?? null);
    let suggested = m.type === "auto" ? suggestMet(m.direction, a?.actual ?? null, budgetTarget) : null;
    let detail: string | null = m.type === "placeholder" ? (m.placeholderHint ?? "Placeholder — data pending") : null;
    if (m.quarterlyBranchKpi) {
      const qm = QUARTER_MONTHS[quarter] ?? [];
      detail = `Q${quarter} target = sum of the quarter's ${qm.length} monthly budgets (2026 Branch KPIs). Actual = Σ monthly actuals (live MBR where posted).`;
    }
    if (m.perQuarterTarget != null) {
      detail = `Pro-rated YTD ceiling: ${m.perQuarterTarget}%/quarter × Q${quarter} = ${(m.perQuarterTarget * quarter).toFixed(1)}% (lower is better)`;
      if (m.bookRate) detail += " · rate = branch cancellations ÷ forward book (book allocated to branch by production share)";
    }
    // A to-do metric shows a verify flag and never auto-suggests Met/Not — the
    // reviewer must confirm the real numbers first (bonus-critical).
    if (m.todo) { detail = m.todo; suggested = null; }
    if (m.key === "vehicle_inspections" && inspComp.expected > 0) {
      suggested = inspComp.complete;
      detail = `${inspComp.done}/${inspComp.expected} inspections this quarter (${inspComp.pct}%)`;
    }
    if (m.key === "warehouse_inspections") {
      suggested = whComp.complete;
      detail = `${whComp.done}/${whComp.expected} monthly warehouse inspections this quarter`;
    }
    if (m.key === "training_ceu" && trComp.total > 0) {
      suggested = trComp.complete;
      detail = `${trComp.completed}/${trComp.total} training assignments completed this quarter (${trComp.pct}%)`;
    }
    if (m.key === "quality_control") {
      suggested = qcComp.complete;
      detail = `${qcComp.done}/${qcComp.expected} QC inspections this quarter (${qcComp.ghp} GHP + ${qcComp.lo} L&O · ${qcComp.pct}%)`;
    }
    return {
      key: m.key,
      label: m.label,
      weight: m.weight,
      type: m.type,
      unit: a?.unit ?? m.unit ?? null,
      actual: a?.actual ?? null,
      budgetTarget,
      target: savedRow.target,
      met: savedRow.met,
      note: savedRow.note,
      suggested,
      detail,
    };
  });
}
