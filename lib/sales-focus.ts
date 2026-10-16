import { prisma } from "@/lib/prisma";
import { priorPeriodKey } from "@/lib/sales-funnel";

// Strategic Focus Plan — the service advisor's documented monthly plan of
// outreach ACTIONS, each with a target, a follow-up date, an optional day-before
// reminder, a logged OUTCOME, and an inline coaching log (SalesFocusComment).
// Pure data helpers; the nudge job lives in lib/jobs.ts and the HTTP surface in
// app/api/sales/focus/route.ts. One row per planned action; never hard-deleted.

export const FOCUS_TYPES = ["crosssell", "networking", "dropoffs", "other"] as const;
export type FocusType = (typeof FOCUS_TYPES)[number];

/** Human label for a focus type. */
export function focusTypeLabel(type: string): string {
  switch (type) {
    case "crosssell": return "Cross-sell";
    case "networking": return "Networking";
    case "dropoffs": return "Drop-offs";
    default: return "Other";
  }
}

const isFocusType = (t: unknown): t is FocusType => typeof t === "string" && (FOCUS_TYPES as readonly string[]).includes(t);

// Serializable DTOs (dates → ISO strings) so these can cross the server→client
// boundary into the "use client" FocusPlan component without leaking Date/Prisma.
export type FocusCommentDTO = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};
export type FocusItemDTO = {
  id: string;
  advisorEmployeeId: string;
  periodKey: string;
  type: FocusType;
  title: string | null;
  plan: string | null;
  goalText: string | null;
  goalCount: number | null;
  followUpAt: string | null;
  remindAt: string | null;
  status: string;
  outcome: string | null;
  outcomeLeads: number | null;
  outcomeClosed: number | null;
  nudgedAt: string | null;
  comments: FocusCommentDTO[];
};

type FocusItemRow = {
  id: string; advisorEmployeeId: string; periodKey: string; type: string;
  title: string | null; plan: string | null; goalText: string | null; goalCount: number | null;
  followUpAt: Date | null; remindAt: Date | null; status: string;
  outcome: string | null; outcomeLeads: number | null; outcomeClosed: number | null;
  nudgedAt: Date | null;
  comments?: { id: string; authorName: string; body: string; createdAt: Date }[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toFocusDTO(r: FocusItemRow): FocusItemDTO {
  return {
    id: r.id,
    advisorEmployeeId: r.advisorEmployeeId,
    periodKey: r.periodKey,
    type: (isFocusType(r.type) ? r.type : "other"),
    title: r.title,
    plan: r.plan,
    goalText: r.goalText,
    goalCount: r.goalCount,
    followUpAt: iso(r.followUpAt),
    remindAt: iso(r.remindAt),
    status: r.status,
    outcome: r.outcome,
    outcomeLeads: r.outcomeLeads,
    outcomeClosed: r.outcomeClosed,
    nudgedAt: iso(r.nudgedAt),
    comments: (r.comments ?? []).map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() })),
  };
}

/** One advisor's non-voided Focus Plan actions for a month, with their coaching log. */
export async function listFocusItems(advisorEmployeeId: string, periodKey: string): Promise<FocusItemDTO[]> {
  const rows = await prisma.salesFocusItem.findMany({
    where: { advisorEmployeeId, periodKey, voided: false },
    include: { comments: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ followUpAt: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toFocusDTO);
}

/** Parse a date-ish input ("YYYY-MM-DD" from a date input, or ISO) → Date | null. */
export function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00.000Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type FocusItemInput = {
  id?: string | null;
  type: string;
  title?: string | null;
  plan?: string | null;
  goalText?: string | null;
  goalCount?: number | null;
  followUpAt?: unknown; // date string
  remindAt?: unknown; // date string
};

/** Create or update one Focus Plan action. Editing never resets status/outcome. */
export async function upsertFocusItem(
  advisorEmployeeId: string,
  periodKey: string,
  data: FocusItemInput,
  opts: { branch?: string | null; userId?: string | null } = {},
) {
  const type: FocusType = isFocusType(data.type) ? data.type : "other";
  const clean = {
    type,
    title: (data.title ?? "").trim().slice(0, 200) || null,
    plan: (data.plan ?? "").trim().slice(0, 2000) || null,
    goalText: (data.goalText ?? "").trim().slice(0, 300) || null,
    goalCount: data.goalCount != null && Number.isFinite(Number(data.goalCount)) ? Math.max(0, Math.round(Number(data.goalCount))) : null,
    followUpAt: parseDate(data.followUpAt),
    remindAt: parseDate(data.remindAt),
  };
  if (data.id) {
    // Only an edit of the plan fields — status/outcome/nudge stamps are untouched.
    return prisma.salesFocusItem.update({ where: { id: data.id }, data: clean });
  }
  return prisma.salesFocusItem.create({
    data: { advisorEmployeeId, periodKey, branch: opts.branch ?? null, createdByUserId: opts.userId ?? null, status: "planned", ...clean },
  });
}

/** Log the outcome of an action. Flips status → "outcome_logged". */
export async function logFocusOutcome(
  id: string,
  data: { outcome?: string | null; outcomeLeads?: number | null; outcomeClosed?: number | null },
) {
  const clean = {
    outcome: (data.outcome ?? "").trim().slice(0, 2000) || null,
    outcomeLeads: data.outcomeLeads != null && Number.isFinite(Number(data.outcomeLeads)) ? Math.max(0, Math.round(Number(data.outcomeLeads))) : null,
    outcomeClosed: data.outcomeClosed != null && Number.isFinite(Number(data.outcomeClosed)) ? Math.max(0, Number(data.outcomeClosed)) : null,
    status: "outcome_logged",
  };
  return prisma.salesFocusItem.update({ where: { id }, data: clean });
}

/** Add a comment to an action's coaching log. */
export async function addFocusComment(focusItemId: string, authorName: string, body: string, authorUserId?: string | null) {
  const text = body.trim().slice(0, 4000);
  if (!text) return null;
  const comment = await prisma.salesFocusComment.create({
    data: { focusItemId, authorName: authorName.slice(0, 200) || "Someone", body: text, authorUserId: authorUserId ?? null },
  });
  // Touch the item so director rollups surface recently-coached plans.
  await prisma.salesFocusItem.update({ where: { id: focusItemId }, data: { updatedAt: new Date() } }).catch(() => {});
  return comment;
}

/** Reversibly remove an action (soft-delete). Pass voided=false to restore. */
export async function voidFocusItem(id: string, voided = true) {
  return prisma.salesFocusItem.update({ where: { id }, data: { voided } });
}

/** Carry-forward: copy last month's recurring actions into this month as fresh,
 *  un-nudged "planned" rows (outcomes/dates/comments are NOT copied). Returns the
 *  number created. No-op (0) if this month already has actions. */
export async function copyLastMonthPlan(
  advisorEmployeeId: string,
  periodKey: string,
  opts: { branch?: string | null; userId?: string | null } = {},
): Promise<number> {
  const existing = await prisma.salesFocusItem.count({ where: { advisorEmployeeId, periodKey, voided: false } });
  if (existing > 0) return 0;
  const prevKey = priorPeriodKey(periodKey);
  const prev = await prisma.salesFocusItem.findMany({ where: { advisorEmployeeId, periodKey: prevKey, voided: false } });
  if (prev.length === 0) return 0;
  await prisma.salesFocusItem.createMany({
    data: prev.map((p) => ({
      advisorEmployeeId, periodKey, branch: opts.branch ?? p.branch ?? null, createdByUserId: opts.userId ?? null,
      type: p.type, title: p.title, plan: p.plan, goalText: p.goalText, goalCount: p.goalCount, status: "planned",
    })),
  });
  return prev.length;
}

/** Load a focus item (any state) — used for gating in the API. */
export async function getFocusItem(id: string) {
  return prisma.salesFocusItem.findUnique({ where: { id } });
}

// ── Director rollup: upcoming + overdue follow-ups across advisors ─────────────
export type FocusRollupRow = {
  id: string;
  advisorEmployeeId: string;
  advisorName: string;
  branch: string | null;
  type: FocusType;
  label: string; // type or custom title
  plan: string | null;
  goalText: string | null;
  goalCount: number | null;
  followUpAt: string | null;
  status: string;
  outcome: string | null;
  overdue: boolean;
};
export type FocusRollup = {
  upcoming: FocusRollupRow[];
  overdue: FocusRollupRow[];
  logged: FocusRollupRow[];
  counts: { advisorsWithPlan: number; actions: number; overdue: number; logged: number };
};

/** Cross-advisor Focus & follow-ups rollup for the director dashboard. */
export async function focusRollup(periodKey: string, advisorIds: string[], names: Map<string, { name: string; branch: string | null }>): Promise<FocusRollup> {
  if (advisorIds.length === 0) return { upcoming: [], overdue: [], logged: [], counts: { advisorsWithPlan: 0, actions: 0, overdue: 0, logged: 0 } };
  const rows = await prisma.salesFocusItem.findMany({
    where: { advisorEmployeeId: { in: advisorIds }, periodKey, voided: false },
    orderBy: [{ followUpAt: "asc" }, { createdAt: "asc" }],
  });
  const now = Date.now();
  const advisorsWithPlan = new Set(rows.map((r) => r.advisorEmployeeId)).size;
  const toRow = (r: (typeof rows)[number]): FocusRollupRow => {
    const who = names.get(r.advisorEmployeeId);
    const type: FocusType = isFocusType(r.type) ? r.type : "other";
    return {
      id: r.id,
      advisorEmployeeId: r.advisorEmployeeId,
      advisorName: who?.name ?? "Advisor",
      branch: who?.branch ?? r.branch ?? null,
      type,
      label: r.title?.trim() || focusTypeLabel(type),
      plan: r.plan,
      goalText: r.goalText,
      goalCount: r.goalCount,
      followUpAt: iso(r.followUpAt),
      status: r.status,
      outcome: r.outcome,
      overdue: !!(r.followUpAt && r.followUpAt.getTime() <= now && r.status !== "outcome_logged" && r.status !== "closed"),
    };
  };
  const all = rows.map(toRow);
  const open = all.filter((r) => r.status !== "outcome_logged" && r.status !== "closed");
  const overdue = open.filter((r) => r.overdue);
  const upcoming = open.filter((r) => !r.overdue);
  const logged = all.filter((r) => r.status === "outcome_logged" || r.status === "closed");
  return {
    upcoming, overdue, logged,
    counts: { advisorsWithPlan, actions: rows.length, overdue: overdue.length, logged: logged.length },
  };
}

/** Compact focus-plan facts for the AI coach (one advisor). Empty string when none. */
export function focusFactsForAdvisor(items: FocusItemDTO[]): string {
  if (items.length === 0) return "";
  const lines = items.map((i) => {
    const label = i.title?.trim() || focusTypeLabel(i.type);
    const goal = i.goalCount != null ? ` (target ${i.goalCount})` : i.goalText ? ` (goal: ${i.goalText})` : "";
    const outcome = i.status === "outcome_logged"
      ? ` — OUTCOME: ${i.outcome ?? "logged"}${i.outcomeLeads != null ? `, ${i.outcomeLeads} leads` : ""}${i.outcomeClosed != null ? `, $${Math.round(i.outcomeClosed)} closed` : ""}`
      : i.followUpAt ? ` — follow up ${i.followUpAt.slice(0, 10)}` : " — planned";
    return `- ${focusTypeLabel(i.type)}: ${label}${goal}${outcome}`;
  });
  return `Focus plan this month:\n${lines.join("\n")}`;
}
