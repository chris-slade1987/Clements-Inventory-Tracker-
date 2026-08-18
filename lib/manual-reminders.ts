import { prisma } from "@/lib/prisma";

// Manual reminders managers / HR create and tag to an employee or vehicle.
// Stored (unlike the computed managerReminders), they surface on dashboards
// and the tagged profile, and email recipients starting `leadDays` before due.

export const REMINDER_SEVERITY = [
  { key: "info", label: "Info" },
  { key: "warning", label: "Important" },
  { key: "critical", label: "Critical" },
] as const;

export const REMINDER_NOTIFY = [
  { key: "hr", label: "HR" },
  { key: "creator", label: "Me" },
  { key: "both", label: "HR & me" },
] as const;

export function reminderStatusOpen(r: { status: string }) {
  return r.status === "open";
}

// ---- Bulk clear of past-due items ------------------------------------------
// "Past due" = a due date strictly before the start of today (UTC). Anything due
// today, this week, this month, or later is kept. Clearing is a reversible status
// change (never a delete): manual reminders → "dismissed", audit follow-ups →
// "done". Admin-only (enforced at the route).

/** Start of today in UTC — the past-due cutoff. */
function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** How many open items are past-due and would be cleared. */
export async function pastDueClearableCounts(now: Date = new Date()): Promise<{ reminders: number; auditFollowUps: number; total: number }> {
  const cutoff = startOfTodayUtc(now);
  const [reminders, auditFollowUps] = await Promise.all([
    prisma.reminder.count({ where: { status: "open", dueDate: { lt: cutoff } } }),
    // A null due date is never "past due", and `lt` already excludes nulls.
    prisma.auditFollowUp.count({ where: { status: "open", dueDate: { lt: cutoff } } }),
  ]);
  return { reminders, auditFollowUps, total: reminders + auditFollowUps };
}

/** Clear past-due items (reversible status change). Returns how many of each changed. */
export async function clearPastDue(now: Date = new Date()): Promise<{ reminders: number; auditFollowUps: number }> {
  const cutoff = startOfTodayUtc(now);
  const [r, a] = await Promise.all([
    prisma.reminder.updateMany({ where: { status: "open", dueDate: { lt: cutoff } }, data: { status: "dismissed" } }),
    prisma.auditFollowUp.updateMany({ where: { status: "open", dueDate: { lt: cutoff } }, data: { status: "done", resolvedAt: now } }),
  ]);
  return { reminders: r.count, auditFollowUps: a.count };
}

/** Open reminders whose lead window has started (or overdue), for dashboards. */
export async function activeManualReminders(branch?: string | null) {
  const now = Date.now();
  const rows = await prisma.reminder.findMany({
    where: { status: "open", ...(branch ? { branch } : {}) },
    orderBy: { dueDate: "asc" },
    include: { employee: { select: { name: true } }, vehicle: { select: { unitNumber: true, name: true } } },
  });
  return rows.filter((r) => r.dueDate.getTime() - r.leadDays * 864e5 <= now);
}

export async function remindersForEmployee(employeeId: string) {
  return prisma.reminder.findMany({ where: { employeeId, status: { not: "dismissed" } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] });
}
export async function remindersForVehicle(vehicleId: string) {
  return prisma.reminder.findMany({ where: { vehicleId, status: { not: "dismissed" } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] });
}
