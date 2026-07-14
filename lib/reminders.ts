import { prisma } from "@/lib/prisma";
import { isDueSoon, listVehicles } from "@/lib/fleet";
import { inspectionStatus } from "@/lib/inspection";
import { openFollowUps } from "@/lib/audit";
import { warehouseStatus } from "@/lib/warehouse";
import { BRANCHES, branchLabel } from "@/lib/management";

// Manager reminders engine. Surfaces time-sensitive responsibilities so a
// manager logging in knows what needs attention this month — vehicle
// maintenance due, monthly inspections outstanding, registrations expiring.
// Branch-scoped so each manager sees their own branch.

export type ReminderKind =
  | "inspection_due"
  | "maintenance_due"
  | "registration_expiring"
  | "loan_payoff"
  | "audit_followup"
  | "warehouse_due";

export type Reminder = {
  kind: ReminderKind;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  branch: string | null;
  href: string;
  dueDate: Date | null;
};

const DAY = 864e5;
const REGISTRATION_WINDOW_DAYS = 60;
const PAYOFF_WINDOW_DAYS = 45;

export async function managerReminders(branch?: string): Promise<Reminder[]> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const reminders: Reminder[] = [];

  const [vehicles, insp] = await Promise.all([
    listVehicles(branch),
    inspectionStatus(year, month, branch),
  ]);

  // Monthly inspections outstanding.
  for (const row of insp.rows) {
    if (row.inspection) continue;
    reminders.push({
      kind: "inspection_due",
      severity: "warning",
      title: "Monthly inspection due",
      detail: `${row.unitNumber ? `#${row.unitNumber} · ` : ""}${row.name} has no inspection logged this month.`,
      branch: row.branch,
      href: `/fleet/${row.id}/inspect`,
      dueDate: null,
    });
  }

  // Maintenance due (next-due date/mileage close) or registration expiring.
  for (const v of vehicles) {
    if (v.status !== "active") continue;
    if (isDueSoon(v)) {
      reminders.push({
        kind: "maintenance_due",
        severity: "warning",
        title: "Maintenance due soon",
        detail: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}${v.nextDueDate ? ` — due ${v.nextDueDate.toLocaleDateString()}` : v.nextDueMileage != null ? ` — due at ${v.nextDueMileage.toLocaleString()} mi` : ""}.`,
        branch: v.branch,
        href: `/fleet/${v.id}`,
        dueDate: v.nextDueDate,
      });
    }
  }

  // Registration expiring / loan payoff approaching (need the raw vehicle rows).
  const raw = await prisma.vehicle.findMany({
    where: { status: "active", ...(branch ? { branch } : {}) },
    select: { id: true, unitNumber: true, name: true, branch: true, registrationRenewal: true, payoffDate: true },
  });
  for (const v of raw) {
    if (v.registrationRenewal) {
      const days = Math.round((v.registrationRenewal.getTime() - now.getTime()) / DAY);
      if (days <= REGISTRATION_WINDOW_DAYS) {
        reminders.push({
          kind: "registration_expiring",
          severity: days <= 0 ? "critical" : "info",
          title: days <= 0 ? "Registration expired" : "Registration expiring",
          detail: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name} — ${days <= 0 ? "expired" : `renews in ${days} days`} (${v.registrationRenewal.toLocaleDateString()}).`,
          branch: v.branch,
          href: `/fleet/${v.id}`,
          dueDate: v.registrationRenewal,
        });
      }
    }
    if (v.payoffDate) {
      const days = Math.round((v.payoffDate.getTime() - now.getTime()) / DAY);
      if (days > 0 && days <= PAYOFF_WINDOW_DAYS) {
        reminders.push({
          kind: "loan_payoff",
          severity: "info",
          title: "Loan payoff approaching",
          detail: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name} — loan matures in ${days} days (${v.payoffDate.toLocaleDateString()}).`,
          branch: v.branch,
          href: `/fleet/${v.id}`,
          dueDate: v.payoffDate,
        });
      }
    }
  }

  // Monthly warehouse safety inspection outstanding (per branch).
  const whBranches = branch ? [branch] : BRANCHES.map((b) => b.key);
  for (const bk of whBranches) {
    const wh = await warehouseStatus(year, month, bk);
    if (!wh.done) {
      reminders.push({
        kind: "warehouse_due",
        severity: "warning",
        title: "Warehouse inspection due",
        detail: `${branchLabel(bk)} has no warehouse safety inspection logged this month.`,
        branch: bk,
        href: `/my-branch/warehouse?branch=${bk}`,
        dueDate: null,
      });
    }
  }

  // Open audit action items assigned to the branch manager (deadline-driven).
  const followUps = await openFollowUps(branch);
  for (const fu of followUps) {
    const days = fu.dueDate ? Math.round((fu.dueDate.getTime() - now.getTime()) / DAY) : null;
    const overdue = days != null && days < 0;
    reminders.push({
      kind: "audit_followup",
      severity: overdue ? "critical" : days != null && days <= 7 ? "warning" : "info",
      title: overdue ? "Audit action item overdue" : "Audit action item",
      detail: `${fu.description}${fu.dueDate ? ` — ${overdue ? `overdue ${Math.abs(days!)}d` : days === 0 ? "due today" : `due in ${days}d`} (${fu.dueDate.toLocaleDateString()})` : ""} · from Q${fu.audit.quarter} ${fu.audit.year} audit.`,
      branch: fu.branch,
      href: "/management/audits",
      dueDate: fu.dueDate,
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return reminders.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Compact per-branch counts for the fleet header / dashboard tiles. */
export async function reminderSummary(branch?: string) {
  const rs = await managerReminders(branch);
  return {
    total: rs.length,
    critical: rs.filter((r) => r.severity === "critical").length,
    inspectionDue: rs.filter((r) => r.kind === "inspection_due").length,
    maintenanceDue: rs.filter((r) => r.kind === "maintenance_due").length,
    registration: rs.filter((r) => r.kind === "registration_expiring").length,
  };
}

export function reminderBranchLabel(branch: string | null): string {
  return branch ? branchLabel(branch) : "—";
}
