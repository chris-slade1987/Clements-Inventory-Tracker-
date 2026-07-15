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
