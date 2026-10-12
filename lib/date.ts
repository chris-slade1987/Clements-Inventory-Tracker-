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
