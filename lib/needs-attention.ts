import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { managerReminders, type Reminder } from "@/lib/reminders";
import { BRANCHES, branchLabel, listPeriods } from "@/lib/management";
import { listAudits, openFollowUps } from "@/lib/audit";
import { warehouseStatus } from "@/lib/warehouse";
import { listVehicles, isDueSoon } from "@/lib/fleet";
import { openMisses } from "@/lib/checklists";
import { pendingRequestsForBranch, canViewAllPto } from "@/lib/pto";
import { outstandingMedicalNoteCount } from "@/lib/absence";
import { allReviews } from "@/lib/review";
import {
  canManageAts, listJobs, candidatesAwaitingDecision, overdueInterviews, jobsAwaitingCloseout,
} from "@/lib/ats";
import { canManagePreHire, listPreHires } from "@/lib/prehire";
import { handbookAckRoster } from "@/lib/policy-docs";
import { isHrDirector } from "@/lib/personnel";

// ─────────────────────────────────────────────────────────────────────────────
// Unified "Needs attention" model (CanopyOS Theme 3).
//
// ONE keyed, clearable aggregator that every role command center builds its queue
// from, so the plumbing is identical everywhere: the same normalized item shape,
// the same severity ranking, and the SAME dismissal mechanism (the keyed
// `ReminderDismissal` pattern — see `lib/reminders.ts` and the model comment in
// `prisma/schema.prisma`). Each role pulls from a set of registered SOURCES; new
// sources (e.g. the SOP runner being built in parallel) register themselves via
// `registerAttentionSource` without touching any page — see the EXTENSION POINT
// note below.
// ─────────────────────────────────────────────────────────────────────────────

export type AttentionSeverity = "critical" | "warning" | "info";

/** A quick sub-link rendered under an item (e.g. the branches/advisors affected). */
export type AttentionChip = { label: string; href?: string };

/**
 * One normalized attention item. Serializable (dates are ISO strings) so it can
 * cross the server→client boundary into the shared renderer unchanged.
 */
export type AttentionItem = {
  /** Stable dismissal key. Dismissible items embed the entity + its date/cycle so
   *  a "Clear" hides THIS occurrence and it returns when the cycle moves on. */
  key: string;
  /** Source-defined category, for grouping / filtering by the page. */
  kind: string;
  title: string;
  detail?: string;
  href: string;
  severity: AttentionSeverity;
  /** true → a keyed `ReminderDismissal` Clear affordance applies. */
  dismissible: boolean;
  branch?: string | null;
  /** ISO date (or null) — the item's due date, for horizon bucketing. */
  dueDate?: string | null;
  /** Lead count shown on count-badge layouts (defaults to 1). */
  count?: number;
  /** Optional affected entities as quick-link chips. */
  chips?: AttentionChip[];
};

/** Which command center is asking. Sources declare the audiences they serve. */
export type AttentionAudience =
  | "branch"
  | "inventory"
  | "field_ops"
  | "hr"
  | "sales"
  | "executive"
  | "employee";

export type AttentionContext = {
  user: SessionUser;
  audience: AttentionAudience;
  /** Scoped branch (null / undefined = all branches). */
  branch?: string | null;
  now?: Date;
};

/** A registered attention source. `load` returns already-normalized items. */
export type AttentionSource = {
  id: string;
  audiences: AttentionAudience[];
  load: (ctx: Required<Pick<AttentionContext, "user" | "audience" | "now">> & { branch?: string | null }) => Promise<AttentionItem[]>;
};

const SEV_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

// ── Severity helpers ─────────────────────────────────────────────────────────

/** Map a UI "tone" (used by the command-center cards) to a model severity. */
export function toneToSeverity(tone: "red" | "amber" | "emerald" | "slate"): AttentionSeverity {
  return tone === "red" ? "critical" : tone === "amber" ? "warning" : "info";
}

/** Map a model severity back to a card "tone". */
export function severityToTone(sev: AttentionSeverity): "red" | "amber" | "slate" {
  return sev === "critical" ? "red" : sev === "warning" ? "amber" : "slate";
}

/** Adapter: a `lib/reminders.ts` Reminder → a unified AttentionItem (all keyed,
 *  all dismissible via the ReminderDismissal pattern). */
export function reminderToAttention(r: Reminder): AttentionItem {
  return {
    key: r.key,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    href: r.href,
    severity: r.severity,
    dismissible: true,
    branch: r.branch,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
  };
}

// ── Dismissals (the one keyed, clearable layer) ──────────────────────────────

/** Every computed item a manager/admin has cleared, by stable key. Shared with
 *  `lib/reminders.ts` so a clear on any surface hides the item everywhere. */
export async function dismissedAttentionKeys(): Promise<Set<string>> {
  const rows = await prisma.reminderDismissal.findMany({ select: { key: true } });
  return new Set(rows.map((d) => d.key));
}

/** Drop dismissed (dismissible-only) items, de-dupe by key, and rank by severity
 *  then soonest due date. Used by both `collectAttention` and pages that build
 *  items inline (so everything flows through ONE filter/sort). */
export function finalizeAttention(items: AttentionItem[], dismissed: Set<string>): AttentionItem[] {
  const seen = new Set<string>();
  const out: AttentionItem[] = [];
  for (const it of items) {
    if (it.dismissible && dismissed.has(it.key)) continue;
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out.sort((a, b) => {
    const s = SEV_RANK[a.severity] - SEV_RANK[b.severity];
    if (s !== 0) return s;
    const ad = a.dueDate ? Date.parse(a.dueDate) : Infinity;
    const bd = b.dueDate ? Date.parse(b.dueDate) : Infinity;
    return ad - bd;
  });
}

/** Convenience for pages that build their own items: apply the shared dismissal
 *  filter + sort in one call. */
export async function applyDismissals(items: AttentionItem[]): Promise<AttentionItem[]> {
  const dismissed = await dismissedAttentionKeys();
  return finalizeAttention(items, dismissed);
}

export type AttentionSummary = { total: number; critical: number; warning: number; info: number };

export function attentionSummary(items: AttentionItem[]): AttentionSummary {
  return {
    total: items.length,
    critical: items.filter((i) => i.severity === "critical").length,
    warning: items.filter((i) => i.severity === "warning").length,
    info: items.filter((i) => i.severity === "info").length,
  };
}

// ── Built-in sources ─────────────────────────────────────────────────────────
// Each is a thin wrapper over the aggregates the role pages already used, so the
// items match what each command center has always shown (plus obvious gaps).

/** Branch / inventory manager items — the whole `managerReminders` engine
 *  (fleet, warehouse, inspections, PTO, reorder, licenses, audits, manual …),
 *  already keyed + dismissible. Branch-scoped by the context. */
const branchRemindersSource: AttentionSource = {
  id: "manager-reminders",
  audiences: ["branch", "inventory"],
  load: async (ctx) => {
    const rs = await managerReminders(ctx.branch ?? undefined);
    return rs.map(reminderToAttention);
  },
};

/** HR command-center queues — every actionable HR item in one place. Reuses the
 *  exact aggregates `/hr` always used; each gated by the same guard as its
 *  destination page. These resolve when the underlying work is done, so they are
 *  not individually dismissible. */
const hrQueuesSource: AttentionSource = {
  id: "hr-queues",
  audiences: ["hr"],
  load: async (ctx) => {
    const user = ctx.user;
    const canPto = canViewAllPto(user);
    const canAts = canManageAts(user);
    const canPreHire = canManagePreHire(user);
    const hr = isHrDirector(user);

    const [ptoPending, calloutNotes, candidatesAwaiting, overdueInt, preHires, reviews, ackRoster, closeoutJobs] =
      await Promise.all([
        canPto ? pendingRequestsForBranch(null) : Promise.resolve([]),
        canPto ? outstandingMedicalNoteCount(null) : Promise.resolve(0),
        canAts ? candidatesAwaitingDecision() : Promise.resolve([]),
        canAts ? overdueInterviews() : Promise.resolve([]),
        canPreHire ? listPreHires() : Promise.resolve([]),
        hr ? allReviews() : Promise.resolve([]),
        canPto || hr ? handbookAckRoster() : Promise.resolve({ version: 0, rows: [] }),
        canAts ? jobsAwaitingCloseout() : Promise.resolve([]),
      ]);

    const reviewsNeedAction = reviews.filter((r) => r.status === "due" || r.status === "pending_approval").length;
    const preHiresToApprove = preHires.filter((p) => p.status === "submitted").length;
    const ackOutstanding = ackRoster.rows.filter((r) => !r.acknowledged).length;

    const items: AttentionItem[] = [];
    const push = (
      cond: boolean,
      key: string,
      kind: string,
      count: number,
      title: string,
      href: string,
      severity: AttentionSeverity,
    ) => {
      if (cond && count > 0) items.push({ key, kind, title, href, severity, dismissible: false, count });
    };

    push(canPto, "hr_pto_pending", "pto_request", ptoPending.length, "PTO requests to review", "/management/people/pto", "warning");
    push(hr, "hr_reviews_action", "review_action", reviewsNeedAction, "New-hire reviews need action", "/management/people/reviews", "critical");
    push(canAts, "hr_candidate_decision", "candidate_decision", candidatesAwaiting.length, "Candidates awaiting decision", "/management/people/jobs", "warning");
    push(canAts, "hr_overdue_interviews", "interview_overdue", overdueInt.length, "Overdue interviews", "/management/people/jobs", "critical");
    push(canPreHire, "hr_prehire_approve", "prehire_approval", preHiresToApprove, "Pre-hires awaiting approval", "/management/people/prehires", "warning");
    push(canPto, "hr_callout_notes", "callout_note", calloutNotes, "Call-out notes outstanding", "/management/people/callouts", "warning");
    push(canPto || hr, "hr_handbook_acks", "handbook_ack", ackOutstanding, "Handbook acks outstanding", "/management/people/handbook", "info");
    push(canAts, "hr_closeout", "hiring_closeout", closeoutJobs.length, "Jobs awaiting closeout", "/management/people/jobs", "info");
    return items;
  },
};

/** Field-ops command-center queues — cross-branch oversight. Reuses the exact
 *  aggregates `/field-ops` always used. Not individually dismissible. */
const fieldOpsQueuesSource: AttentionSource = {
  id: "field-ops-queues",
  audiences: ["field_ops"],
  load: async (ctx) => {
    const now = ctx.now;
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

    const [audits, followUps, whStatuses, vehicles] = await Promise.all([
      listAudits(),
      openFollowUps(),
      Promise.all(BRANCHES.map(async (b) => ({ branch: b, ...(await warehouseStatus(year, month, b.key)) }))),
      listVehicles(undefined, "active"),
    ]);

    const auditedThisQuarter = new Set(
      audits.filter((a) => a.year === year && a.quarter === quarter && a.status === "submitted").map((a) => a.branch),
    );
    const auditsMissing = BRANCHES.filter((b) => !auditedThisQuarter.has(b.key));
    const whMissing = whStatuses.filter((s) => !s.done).map((s) => s.branch);
    const dueSoon = vehicles.filter((v) => isDueSoon(v));

    const items: AttentionItem[] = [];
    if (auditsMissing.length > 0)
      items.push({
        key: `fo_audit_missing:${year}-Q${quarter}`, kind: "audit_missing",
        title: `Branches without a Q${quarter} field audit`, href: "/management/audits",
        severity: "critical", dismissible: false, count: auditsMissing.length,
        chips: auditsMissing.map((b) => ({ label: b.label, href: `/management/audits?branch=${b.key}` })),
      });
    if (followUps.length > 0)
      items.push({
        key: "fo_followups", kind: "audit_followup", title: "Open audit follow-ups",
        href: "/management/audits", severity: "warning", dismissible: false, count: followUps.length,
      });
    if (whMissing.length > 0)
      items.push({
        key: `fo_warehouse:${year}-${month}`, kind: "warehouse_due",
        title: `Branches missing the ${monthLabel} warehouse inspection`, href: "/management/compliance",
        severity: "warning", dismissible: false, count: whMissing.length,
        chips: whMissing.map((b) => ({ label: b.label })),
      });
    if (dueSoon.length > 0)
      items.push({
        key: "fo_vehicles_due", kind: "maintenance_due", title: "Vehicles due for service",
        href: "/fleet", severity: "warning", dismissible: false, count: dueSoon.length,
      });
    return items;
  },
};

/** Executive command-center queues — the company leadership "what needs me"
 *  lead (previously MISSING on `/executive`). Grounded in existing engines:
 *  quarterly audits, warehouse cadence, missed checklists, MBR freshness, plus
 *  the renewal/compliance items from the company reminders pass (keyed +
 *  dismissible). */
const executiveQueuesSource: AttentionSource = {
  id: "executive-queues",
  audiences: ["executive"],
  load: async (ctx) => {
    const now = ctx.now;
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

    const [audits, followUps, whStatuses, misses, periods, reminders] = await Promise.all([
      listAudits(),
      openFollowUps(),
      Promise.all(BRANCHES.map(async (b) => ({ branch: b, ...(await warehouseStatus(year, month, b.key)) }))),
      openMisses(),
      listPeriods(),
      managerReminders(undefined),
    ]);

    const auditedThisQuarter = new Set(
      audits.filter((a) => a.year === year && a.quarter === quarter && a.status === "submitted").map((a) => a.branch),
    );
    const auditsMissing = BRANCHES.filter((b) => !auditedThisQuarter.has(b.key));
    const whMissing = whStatuses.filter((s) => !s.done).map((s) => s.branch);
    const overdueFollowUps = followUps.filter((f) => f.dueDate && f.dueDate.getTime() < now.getTime());

    const items: AttentionItem[] = [];

    if (overdueFollowUps.length > 0)
      items.push({
        key: "exec_followups_overdue", kind: "audit_followup", title: "Audit follow-ups overdue",
        href: "/management/audits", severity: "critical", dismissible: false, count: overdueFollowUps.length,
      });
    if (misses.length > 0)
      items.push({
        key: "exec_missed_checklists", kind: "checklist_miss", title: "Missed weekly checklists on record",
        href: "/checklists/oversight", severity: "critical", dismissible: false, count: misses.length,
      });
    if (auditsMissing.length > 0)
      items.push({
        key: `exec_audit_missing:${year}-Q${quarter}`, kind: "audit_missing",
        title: `Branches without a Q${quarter} field audit`, href: "/management/audits",
        severity: "warning", dismissible: false, count: auditsMissing.length,
        chips: auditsMissing.map((b) => ({ label: b.label, href: `/management/audits?branch=${b.key}` })),
      });
    if (whMissing.length > 0)
      items.push({
        key: `exec_warehouse:${year}-${month}`, kind: "warehouse_due",
        title: `Branches missing the ${monthLabel} warehouse inspection`, href: "/management/compliance",
        severity: "warning", dismissible: false, count: whMissing.length,
        chips: whMissing.map((b) => ({ label: b.label })),
      });

    // MBR freshness: nudge if last completed month's report hasn't been uploaded.
    const lastMonthDate = new Date(Date.UTC(year, month - 2, 1));
    const lmY = lastMonthDate.getUTCFullYear();
    const lmM = lastMonthDate.getUTCMonth() + 1;
    const haveLastMonth = periods.some((p) => p.year === lmY && p.month === lmM);
    if (!haveLastMonth)
      items.push({
        key: `exec_mbr_missing:${lmY}-${String(lmM).padStart(2, "0")}`, kind: "mbr_missing",
        title: `Upload the ${lastMonthDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} MBR`,
        detail: "Last month's Monthly Board Report isn't in yet — upload it to refresh the operating dashboards.",
        href: "/management/upload", severity: "warning", dismissible: true,
      });

    // Compliance renewals from the company reminders pass (keyed + dismissible).
    for (const r of reminders) {
      if (r.kind === "policy_renewal" || r.kind === "license_expiring" || r.kind === "lease_expiring") {
        items.push(reminderToAttention(r));
      }
    }
    return items;
  },
};

// ── Source registry + EXTENSION POINT ────────────────────────────────────────

const BUILTIN_SOURCES: AttentionSource[] = [
  branchRemindersSource,
  hrQueuesSource,
  fieldOpsQueuesSource,
  executiveQueuesSource,
];

const EXTRA_SOURCES: AttentionSource[] = [];

/**
 * EXTENSION POINT. Register a new attention source so its items flow into the
 * right role command centers without editing any page. This is how new domains
 * (e.g. the SOP runner being added in parallel — "SOP step overdue", "sign-off
 * due") plug into the unified queue: at module load, call
 *
 *   registerAttentionSource({
 *     id: "sop-runner",
 *     audiences: ["branch", "field_ops", "executive"],
 *     load: async (ctx) => [...normalized AttentionItems...],
 *   });
 *
 * Keyed items (dismissible: true) automatically honor the shared
 * `ReminderDismissal` Clear mechanism; queue-style items use dismissible: false.
 */
export function registerAttentionSource(source: AttentionSource): void {
  if (EXTRA_SOURCES.some((s) => s.id === source.id) || BUILTIN_SOURCES.some((s) => s.id === source.id)) return;
  EXTRA_SOURCES.push(source);
}

/** Every registered source (built-ins + extensions). */
export function attentionSources(): AttentionSource[] {
  return [...BUILTIN_SOURCES, ...EXTRA_SOURCES];
}

/**
 * THE unified entry point every role home calls. Runs all sources registered for
 * the audience in parallel, then applies the one shared dismissal filter + sort.
 */
export async function collectAttention(ctx: AttentionContext): Promise<AttentionItem[]> {
  const now = ctx.now ?? new Date();
  const sources = attentionSources().filter((s) => s.audiences.includes(ctx.audience));
  const [groups, dismissed] = await Promise.all([
    Promise.all(
      sources.map((s) =>
        s.load({ user: ctx.user, audience: ctx.audience, now, branch: ctx.branch }).catch(() => [] as AttentionItem[]),
      ),
    ),
    dismissedAttentionKeys(),
  ]);
  return finalizeAttention(groups.flat(), dismissed);
}

// ── Sales queue builder (page builds items from data it already has) ──────────
// The sales dashboard already computes advisor funnels/pace/focus for the rest of
// the page, so rather than re-query here, it hands the pre-computed states to this
// pure builder — producing the SAME normalized AttentionItems (with per-advisor
// chips) that then flow through `applyDismissals`. Keeps one model, no double work.

export type SalesAttentionInput = {
  periodLabel: string;
  canManage: boolean;
  advisorCount: number;
  notSet: { id: string; name: string; branch: string | null }[];
  pendingApproval: { id: string; name: string; target: number }[];
  proposalPending: { id: string; name: string }[];
  behind: { id: string; name: string; branch: string | null }[];
  setNotAgreed: { id: string; name: string; target: number }[];
  overdueFollowUps: number;
};

const money0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function buildSalesAttention(input: SalesAttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const bl = (b: string | null) => (b ? ` · ${branchLabel(b)}` : "");

  if (input.notSet.length > 0)
    items.push({
      key: "sales_goals_not_set", kind: "goal_not_set",
      title: `${input.notSet.length} of ${input.advisorCount} advisor${input.notSet.length === 1 ? " hasn't" : "s haven't"} set ${input.periodLabel} goals`,
      href: "/sales", severity: "warning", dismissible: false, count: input.notSet.length,
      chips: input.notSet.map((r) => ({ label: `${r.name}${bl(r.branch)}`, href: `/sales/${r.id}` })),
    });
  if (input.canManage && input.pendingApproval.length > 0)
    items.push({
      key: "sales_goals_awaiting_approval", kind: "goal_approval",
      title: `${input.pendingApproval.length} goal${input.pendingApproval.length === 1 ? "" : "s"} awaiting your approval`,
      href: "/sales", severity: "warning", dismissible: false, count: input.pendingApproval.length,
      chips: input.pendingApproval.map((r) => ({ label: `${r.name}${r.target > 0 ? ` · ${money0(r.target)}` : ""} — review & approve`, href: `/sales/${r.id}` })),
    });
  if (input.canManage && input.proposalPending.length > 0)
    items.push({
      key: "sales_proposals_pending", kind: "goal_proposal",
      title: `${input.proposalPending.length} proposal${input.proposalPending.length === 1 ? "" : "s"} awaiting the advisor`,
      href: "/sales", severity: "info", dismissible: false, count: input.proposalPending.length,
      chips: input.proposalPending.map((r) => ({ label: `${r.name} — you proposed, pending their accept`, href: `/sales/${r.id}` })),
    });
  if (input.behind.length > 0)
    items.push({
      key: "sales_behind_pace", kind: "sales_behind",
      title: `${input.behind.length} advisor${input.behind.length === 1 ? " is" : "s are"} behind pace this month`,
      href: "/sales", severity: "warning", dismissible: false, count: input.behind.length,
      chips: input.behind.map((r) => ({ label: `${r.name}${bl(r.branch)} — coach`, href: `/sales/${r.id}` })),
    });
  if (input.overdueFollowUps > 0)
    items.push({
      key: "sales_followups_overdue", kind: "focus_overdue",
      title: `${input.overdueFollowUps} focus follow-up${input.overdueFollowUps === 1 ? " is" : "s are"} overdue`,
      href: "/sales#focus-followups", severity: "warning", dismissible: false, count: input.overdueFollowUps,
    });
  if (input.canManage && input.setNotAgreed.length > 0)
    items.push({
      key: "sales_set_not_agreed", kind: "goal_not_agreed",
      title: `${input.setNotAgreed.length} goal${input.setNotAgreed.length === 1 ? " is" : "s are"} set but not yet agreed`,
      href: "/sales", severity: "info", dismissible: false, count: input.setNotAgreed.length,
      chips: input.setNotAgreed.map((r) => ({ label: `${r.name}${r.target > 0 ? ` · ${money0(r.target)}` : ""} — confirm`, href: `/sales/${r.id}` })),
    });
  return items;
}

// ── Employee personal items builder (page hands in its already-loaded data) ───

export type EmployeeAttentionInput = {
  openTraining: { id: string; title: string; status: string; overdue: boolean }[];
  reviewsToSign: { id: string; label: string }[];
  interviews: { id: string; label: string; overdue: boolean }[];
  reviewsToConduct: { id: string; label: string; overdue: boolean }[];
};

export function buildEmployeeAttention(input: EmployeeAttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const a of input.openTraining)
    items.push({
      key: `emp_training:${a.id}`, kind: "training_open", title: a.title,
      detail: a.overdue ? "Overdue — finish this course" : "Action needed", href: `/me/training/${a.id}`,
      severity: a.overdue ? "critical" : "warning", dismissible: false,
    });
  for (const r of input.reviewsToSign)
    items.push({
      key: `emp_review_sign:${r.id}`, kind: "review_sign", title: r.label,
      detail: "Review with your manager, then sign", href: `/reviews/${r.id}`,
      severity: "warning", dismissible: false,
    });
  for (const iv of input.interviews)
    items.push({
      key: `emp_interview:${iv.id}`, kind: "interview", title: iv.label,
      detail: "Complete the interview scorecard", href: `/me/interviews/${iv.id}`,
      severity: iv.overdue ? "critical" : "warning", dismissible: false,
    });
  for (const r of input.reviewsToConduct)
    items.push({
      key: `emp_review_conduct:${r.id}`, kind: "review_conduct", title: r.label,
      detail: "Complete & sign with the employee", href: `/reviews/${r.id}`,
      severity: r.overdue ? "critical" : "warning", dismissible: false,
    });
  return items;
}
