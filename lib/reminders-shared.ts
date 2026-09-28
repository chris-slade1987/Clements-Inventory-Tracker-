// Shared reminder timing helpers. The lead-window predicate was duplicated in
// lib/reminders.ts, lib/manual-reminders.ts, and lib/jobs.ts; keep it here so the
// three surfaces (dashboard feed, dashboard list, daily email) can never drift.

export const DAY_MS = 86_400_000;

/**
 * True once a reminder's lead window has opened — i.e. `dueDate - leadDays` is
 * at or before `now` (also true when overdue).
 */
export function leadWindowOpen(dueDate: Date, leadDays: number, now: number = Date.now()): boolean {
  return dueDate.getTime() - leadDays * DAY_MS <= now;
}
