import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";

// Manager recurring oversight checklists. Independent of the stock ledger — a
// completion is a signed, append-only attestation that a manager personally
// completed a cadence's items for their branch in a given period. Modeled on
// the vehicle-inspection status helpers (lib/inspection.ts) and the manager
// reminders (lib/reminders.ts): we surface "completed vs not-yet" for the
// CURRENT period, plus a leadership rollup across every branch.

export type ChecklistItem = {
  id: string;
  order: number;
  category: string;
  label: string;
  objective: string;
};

export type ItemResult = { itemId: string; checked: boolean; note: string };

export function parseItems(json: string): ChecklistItem[] {
  try {
    const arr = JSON.parse(json) as ChecklistItem[];
    return Array.isArray(arr) ? [...arr].sort((a, b) => a.order - b.order) : [];
  } catch {
    return [];
  }
}

export function parseItemResults(json: string | null | undefined): ItemResult[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as ItemResult[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Items grouped into their categories, preserving order. */
export function groupByCategory(items: ChecklistItem[]): { category: string; items: ChecklistItem[] }[] {
  const groups: { category: string; items: ChecklistItem[] }[] = [];
  for (const it of items) {
    let g = groups.find((x) => x.category === it.category);
    if (!g) {
      g = { category: it.category, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

// ---- Period keys ------------------------------------------------------------
// All computed in UTC so a key is stable regardless of server locale.

function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** ISO-8601 week + week-year for a date (weeks start Monday; week 1 holds Jan 4). */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = utcDateOnly(date);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // shift to the Thursday of this week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return { year: isoYear, week };
}

/** Weekly period key, e.g. "2026-W29". */
export function weekPeriodKey(date: Date): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monthly period key, e.g. "2026-07". */
export function monthPeriodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The Monday (UTC) of the ISO week containing `date`. */
export function mondayOf(date: Date): Date {
  const d = utcDateOnly(date);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum);
  return d;
}

/** The Friday (UTC, end of day) of the ISO week — weekly checklists are due Friday. */
export function fridayEndOf(date: Date): Date {
  const monday = mondayOf(date);
  const fri = new Date(monday.getTime() + 4 * 864e5);
  return new Date(fri.getTime() + 864e5 - 1); // Friday 23:59:59.999 UTC
}

export function weekPeriodLabel(date: Date): string {
  const monday = mondayOf(date);
  return `Week of ${monday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

/** The last day (UTC) of the month containing `date`. */
export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** Short "Fri Jul 24" — the Friday due date of the current ISO week. */
export function fridayLabel(date: Date = new Date()): string {
  const monday = mondayOf(date);
  const fri = new Date(monday.getTime() + 4 * 864e5);
  return `Fri ${fri.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/** Short "Jul 31" — the last day of the current month (monthly due date). */
export function endOfMonthLabel(date: Date = new Date()): string {
  return endOfMonth(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function monthPeriodLabel(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function periodKeyFor(cadence: string, date: Date): string {
  return cadence === "weekly" ? weekPeriodKey(date) : monthPeriodKey(date);
}

export function periodLabelFor(cadence: string, date: Date): string {
  return cadence === "weekly" ? weekPeriodLabel(date) : monthPeriodLabel(date);
}

// ---- Data access ------------------------------------------------------------

export async function getTemplates() {
  return prisma.checklistTemplate.findMany({ where: { active: true }, orderBy: { cadence: "asc" } });
}

export async function getTemplateByKey(key: string) {
  return prisma.checklistTemplate.findUnique({ where: { key } });
}

export async function completionFor(templateId: string, branch: string, periodKey: string) {
  return prisma.checklistCompletion.findUnique({
    where: { templateId_branch_periodKey: { templateId, branch, periodKey } },
  });
}

export type ChecklistStatus = {
  template: { id: string; key: string; title: string; cadence: string; intro: string | null };
  periodKey: string;
  periodLabel: string;
  completed: boolean;
  completion: { signedName: string; createdAt: Date; userId: string | null } | null;
  overdue: boolean;
  dueLabel: string;
};

/**
 * Current-period status for both cadences at one branch. Weekly is "due" during
 * its ISO week and "overdue" once Friday has passed without a signed completion;
 * monthly is "due" through the end of the month. Kept deliberately simple: we
 * only ever reason about the CURRENT period.
 */
export async function checklistStatusForBranch(branch: string, now: Date = new Date()): Promise<ChecklistStatus[]> {
  const templates = await getTemplates();
  const out: ChecklistStatus[] = [];
  for (const t of templates) {
    const periodKey = periodKeyFor(t.cadence, now);
    const periodLabel = periodLabelFor(t.cadence, now);
    const completion = await completionFor(t.id, branch, periodKey);
    const completed = !!completion;
    let overdue = false;
    let dueLabel: string;
    if (t.cadence === "weekly") {
      overdue = !completed && now.getTime() > fridayEndOf(now).getTime();
      dueLabel = "Due Friday";
    } else {
      dueLabel = "Due this month";
    }
    out.push({
      template: { id: t.id, key: t.key, title: t.title, cadence: t.cadence, intro: t.intro },
      periodKey,
      periodLabel,
      completed,
      completion: completion
        ? { signedName: completion.signedName, createdAt: completion.createdAt, userId: completion.userId }
        : null,
      overdue,
      dueLabel,
    });
  }
  return out;
}

export type RollupColumn = { id: string; key: string; title: string; cadence: string; periodLabel: string };
export type RollupRow = {
  branch: string;
  branchLabel: string;
  statuses: Record<string, ChecklistStatus | null>; // keyed by template id
};

/**
 * Leadership rollup — current status for EVERY active checklist cadence across
 * EVERY branch, with who signed and when. Cadence-generic: it renders one column
 * per active template, so deactivating a template (e.g. the old monthly oversight
 * checklist) simply drops its column, and adding a future cadence adds one.
 */
export async function rollup(now: Date = new Date()): Promise<{ columns: RollupColumn[]; rows: RollupRow[] }> {
  const templates = await getTemplates();
  const columns: RollupColumn[] = templates.map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    cadence: t.cadence,
    periodLabel: periodLabelFor(t.cadence, now),
  }));
  const rows: RollupRow[] = [];
  for (const b of BRANCHES) {
    const statuses = await checklistStatusForBranch(b.key, now);
    const byId: Record<string, ChecklistStatus | null> = {};
    for (const c of columns) byId[c.id] = statuses.find((s) => s.template.id === c.id) ?? null;
    rows.push({ branch: b.key, branchLabel: branchLabel(b.key), statuses: byId });
  }
  return { columns, rows };
}

// ---- Missed-checklist penalty ----------------------------------------------
// When a full period elapses with no signed completion, the branch has MISSED a
// recurring checklist. We detect these lazily (no cron) via an idempotent sweep,
// report them (oversight / alerts / branch banner), and allow ONLY the CEO or HR
// director to clear them — never the branch manager. Cleared misses are retained
// as history (append-only infraction log).

const SWEEP_LOOKBACK_WEEKS = 26; // bound the loop to a sane window

/**
 * Lazy, idempotent detection of missed WEEKLY checklists. For each active weekly
 * template and each branch, enumerate every FULLY-ELAPSED ISO week from the
 * template's go-live week (the ISO week of its createdAt — so we never fabricate
 * misses for weeks before the feature existed) up to, but excluding, the current
 * week. A week counts as elapsed only once `now` is past its end (the following
 * Monday 00:00 UTC), giving the full week incl. weekend before it's "missed".
 * Creates a ChecklistMiss for any (template, branch, week) with no completion and
 * no existing miss. Returns the number created. Safe to call on every page load.
 */
export async function sweepMissedChecklists(now: Date = new Date()): Promise<number> {
  const templates = await prisma.checklistTemplate.findMany({ where: { active: true, cadence: "weekly" } });
  const currentMonday = mondayOf(now).getTime();
  const week = 7 * 864e5;
  let created = 0;

  for (const t of templates) {
    const goLiveMonday = mondayOf(t.createdAt).getTime();
    const earliest = Math.max(goLiveMonday, currentMonday - SWEEP_LOOKBACK_WEEKS * week);

    // Build the set of fully-elapsed weeks in range.
    const weeks: { periodKey: string; periodLabel: string }[] = [];
    for (let m = earliest; m < currentMonday; m += week) {
      const weekEnd = m + week; // following Monday 00:00 UTC
      if (now.getTime() < weekEnd) continue; // not fully elapsed yet
      const midWeek = new Date(m + 3 * 864e5); // Thursday — safe for ISO-week math
      weeks.push({ periodKey: weekPeriodKey(midWeek), periodLabel: weekPeriodLabel(midWeek) });
    }
    if (weeks.length === 0) continue;
    const periodKeys = weeks.map((w) => w.periodKey);

    // Bulk pre-check so we only ever create genuinely new rows.
    const [completions, misses] = await Promise.all([
      prisma.checklistCompletion.findMany({
        where: { templateId: t.id, periodKey: { in: periodKeys } },
        select: { branch: true, periodKey: true },
      }),
      prisma.checklistMiss.findMany({
        where: { templateId: t.id, periodKey: { in: periodKeys } },
        select: { branch: true, periodKey: true },
      }),
    ]);
    const have = new Set<string>();
    for (const c of completions) have.add(`${c.branch}|${c.periodKey}`);
    for (const mrow of misses) have.add(`${mrow.branch}|${mrow.periodKey}`);

    for (const w of weeks) {
      for (const b of BRANCHES) {
        if (have.has(`${b.key}|${w.periodKey}`)) continue;
        try {
          await prisma.checklistMiss.create({
            data: {
              templateId: t.id,
              cadence: t.cadence,
              branch: b.key,
              periodKey: w.periodKey,
              periodLabel: w.periodLabel,
            },
          });
          created++;
        } catch (e) {
          // Unique-constraint race (concurrent sweep) → already recorded, ignore.
          if ((e as { code?: string }).code !== "P2002") throw e;
        }
      }
    }
  }
  return created;
}

export type MissRow = {
  id: string;
  branch: string;
  branchLabel: string;
  cadence: string;
  periodKey: string;
  periodLabel: string;
  status: string;
  createdAt: Date;
  clearedByName: string | null;
  clearedAt: Date | null;
  clearNote: string | null;
};

function toMissRow(m: {
  id: string; branch: string; cadence: string; periodKey: string; periodLabel: string;
  status: string; createdAt: Date; clearedByName: string | null; clearedAt: Date | null; clearNote: string | null;
}): MissRow {
  return { ...m, branchLabel: branchLabel(m.branch) };
}

/** Open (uncleared) misses, optionally scoped to one branch, oldest first. */
export async function openMisses(branch?: string): Promise<MissRow[]> {
  const rows = await prisma.checklistMiss.findMany({
    where: { status: "open", ...(branch ? { branch } : {}) },
    orderBy: [{ branch: "asc" }, { periodKey: "asc" }],
  });
  return rows.map(toMissRow);
}

/** Cleared misses — the retained infraction history, most-recently cleared first. */
export async function clearedMisses(branch?: string): Promise<MissRow[]> {
  const rows = await prisma.checklistMiss.findMany({
    where: { status: "cleared", ...(branch ? { branch } : {}) },
    orderBy: [{ clearedAt: "desc" }],
    take: 100,
  });
  return rows.map(toMissRow);
}

/** Per-branch counts (total + still-open) for the infraction record. */
export async function missCountsByBranch(): Promise<Record<string, { total: number; open: number }>> {
  const grouped = await prisma.checklistMiss.groupBy({
    by: ["branch", "status"],
    _count: { _all: true },
  });
  const out: Record<string, { total: number; open: number }> = {};
  for (const b of BRANCHES) out[b.key] = { total: 0, open: 0 };
  for (const g of grouped) {
    const bucket = (out[g.branch] ??= { total: 0, open: 0 });
    bucket.total += g._count._all;
    if (g.status === "open") bucket.open += g._count._all;
  }
  return out;
}

/** The attestation statement a manager signs. Stored verbatim on the completion. */
export function attestationText(signedName: string, periodLabel: string, branch: string): string {
  return `I, ${signedName || "________"}, verify that I personally completed the items above for ${periodLabel} at the ${branchLabel(branch)} branch.`;
}
