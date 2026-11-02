// Business-day helpers anchored to America/New_York.
//
// The portal operates on Eastern Time (all four branches are in Florida) and the
// daily cron runs at 13:00 UTC — morning ET, the same ET calendar day. There was
// no central date helper before, so "is it their day today" was being decided
// inconsistently (UTC vs. local). These helpers make that decision once, in ET,
// so the profile banners, the org/roster markers, and the celebration cron all
// agree on what "today" is.

const ET_ZONE = "America/New_York";

export type EtParts = { month: number; day: number; year: number };

/**
 * The ET calendar month (1-12), day (1-31) and year for an instant (default:
 * now). Uses Intl so DST is handled correctly without pulling in a date library.
 */
export function etParts(d: Date = new Date()): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_ZONE,
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { month: get("month"), day: get("day"), year: get("year") };
}

/**
 * True when the given month (1-12) + day (1-31) match the ET calendar month/day
 * of `ref` (default: today). Used wherever a birthday/anniversary day-of match is
 * decided so the year is irrelevant — only the month and day matter.
 */
export function isSameMonthDay(month: number | null | undefined, day: number | null | undefined, ref: Date = new Date()): boolean {
  if (!month || !day) return false;
  const t = etParts(ref);
  return t.month === month && t.day === day;
}

/** The ET calendar month as a period key, e.g. "2026-11". Mirrors how the routing
 *  layer keys months, but computed in Eastern Time so a month boundary flips on the
 *  ET calendar day (not UTC). */
export function etPeriodKey(d: Date = new Date()): string {
  const t = etParts(d);
  return `${t.year}-${String(t.month).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// October-2026 manager to-do grace window (COO directive, Nov 2026).
//
// October 2026 was the portal's first live month. Because of that and other
// first-month issues, the COO (Chris) extended the deadline for managers'
// OUTSTANDING October to-dos — vehicle inspections, the warehouse safety
// inspection, and the other monthly duties — to end of day Friday 11/6/2026.
// So instead of swapping the manager to-do dashboards straight to November on
// 11/1, we keep the to-do PERIOD pinned to October through the grace window and
// flip cleanly to the live month afterward.
//
// Everything is evaluated in America/New_York (all four branches are in Florida).
// The window is a single cutoff: the ET calendar date is in
// [GRACE_START_YMD, GRACE_END_YMD). That covers "through end of Fri 11/6" plus the
// don't-care weekend and flips AUTOMATICALLY on Monday 11/9 — no manual step.
// To extend/adjust the grace, change the three constants below.
// ─────────────────────────────────────────────────────────────────────────────

/** The to-do period being extended (what managers keep seeing during the window). */
const GRACE_PERIOD = { year: 2026, month: 10 } as const; // October 2026
/** First ET date the live month would otherwise be November (grace opens). */
const GRACE_START_YMD = 2026_11_01;
/** Monday 11/9 — first ET date we show the live (November) to-dos (exclusive). */
const GRACE_END_YMD = 2026_11_09;

export type TodoPeriod = { year: number; month: number; isOctoberGrace: boolean };

/**
 * The month a manager's to-do dashboard should surface.
 *
 * During the October-2026 grace window it returns October 2026 so outstanding
 * October items stay visible instead of being hidden behind November; otherwise it
 * returns the live Eastern-Time month. Pure + date-driven, so the cutover to
 * November happens automatically on Monday 11/9 with no manual step.
 */
export function managerTodoPeriod(now: Date = new Date()): TodoPeriod {
  const t = etParts(now);
  const ymd = t.year * 10000 + t.month * 100 + t.day;
  if (ymd >= GRACE_START_YMD && ymd < GRACE_END_YMD) {
    return { year: GRACE_PERIOD.year, month: GRACE_PERIOD.month, isOctoberGrace: true };
  }
  return { year: t.year, month: t.month, isOctoberGrace: false };
}
