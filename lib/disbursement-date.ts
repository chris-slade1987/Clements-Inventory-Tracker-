// ---------------------------------------------------------------------------
// Check-Out "Date taken" (COO 2026-11-23): "a date of disbursement option. It can
// default to the current date, but if a manager is delayed in entering a product
// disbursement on the exact day it was taken, I would like an option to change
// the date."
//
// Pure + client-safe (used by the Check-Out form and POST /api/inventory/checkout).
// Dates are Eastern-Time calendar days ("YYYY-MM-DD"; all four branches are in
// Florida). Today → the movement is stamped "now", exactly as before. A past day →
// stamped at 17:00 UTC that day (noon EST / 1 pm EDT), so it lands on the right ET
// day in every report. Future days are refused, and so is anything older than
// MAX_BACKDATE_DAYS (an older miss is a Reconcile job, not a late entry).
// ---------------------------------------------------------------------------

export const MAX_BACKDATE_DAYS = 30;

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's Eastern-Time date as "YYYY-MM-DD". */
export function etTodayKey(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "YYYY-MM-DD" shifted by `days` (calendar arithmetic, no time zone involved). */
export function shiftDayKey(key: string, days: number): string {
  const m = KEY_RE.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Earliest day the form allows. */
export function earliestDisbursementKey(now: Date = new Date()): string {
  return shiftDayKey(etTodayKey(now), -MAX_BACKDATE_DAYS);
}

export type DisbursedAt = { at: Date; dayKey: string; backdated: boolean };

/**
 * Turn the form's date into the movement timestamp. Empty / today → `now`.
 * Returns `{ error }` for a malformed, future, or too-old date.
 */
export function resolveDisbursedAt(raw: unknown, now: Date = new Date()): DisbursedAt | { error: string } {
  const today = etTodayKey(now);
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key || key === today) return { at: now, dayKey: today, backdated: false };
  const m = KEY_RE.exec(key);
  if (!m) return { error: "Pick a valid date taken." };
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 17, 0, 0));
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== key) return { error: "Pick a valid date taken." };
  if (key > today) return { error: "The date taken can't be in the future." };
  if (key < earliestDisbursementKey(now)) {
    return { error: `The date taken can be at most ${MAX_BACKDATE_DAYS} days back. For anything older, use Reconcile.` };
  }
  return { at, dayKey: key, backdated: true };
}
