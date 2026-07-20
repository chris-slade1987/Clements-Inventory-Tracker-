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
  suggestedTime?: string;
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

export type RollupRow = {
  branch: string;
  branchLabel: string;
  weekly: ChecklistStatus | null;
  monthly: ChecklistStatus | null;
};

/**
 * Leadership rollup — current weekly + monthly status for EVERY branch, with who
 * signed and when. Powers the oversight board ("make sure they're doing it").
 */
export async function rollup(now: Date = new Date()): Promise<{ weeklyLabel: string; monthlyLabel: string; rows: RollupRow[] }> {
  const rows: RollupRow[] = [];
  for (const b of BRANCHES) {
    const statuses = await checklistStatusForBranch(b.key, now);
    rows.push({
      branch: b.key,
      branchLabel: branchLabel(b.key),
      weekly: statuses.find((s) => s.template.cadence === "weekly") ?? null,
      monthly: statuses.find((s) => s.template.cadence === "monthly") ?? null,
    });
  }
  return { weeklyLabel: weekPeriodLabel(now), monthlyLabel: monthPeriodLabel(now), rows };
}

/** The attestation statement a manager signs. Stored verbatim on the completion. */
export function attestationText(signedName: string, periodLabel: string, branch: string): string {
  return `I, ${signedName || "________"}, verify that I personally completed the items above for ${periodLabel} at the ${branchLabel(branch)} branch.`;
}
