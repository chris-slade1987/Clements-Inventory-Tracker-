import { prisma } from "@/lib/prisma";
import { getHrEmail } from "@/lib/personnel";
import type { SessionUser } from "@/lib/auth";

// Paid time off. Employees request date ranges from their branch supervisor,
// who approves or denies them. Approved days log against the employee's annual
// allotment. On-hand math mirrors the app's ledger philosophy: balances are
// COMPUTED from request rows (never a mutated running total), so cancelling or
// denying a request simply removes it from the sums.

// Allowed request types + statuses (SQLite has no enums).
export const PTO_TYPES = [
  { key: "vacation", label: "Vacation" },
  { key: "sick", label: "Sick" },
  { key: "personal", label: "Personal" },
  { key: "unpaid", label: "Unpaid" },
  { key: "other", label: "Other" },
] as const;

export type PtoType = (typeof PTO_TYPES)[number]["key"];
export type PtoStatus = "pending" | "approved" | "denied" | "cancelled";

/** Fallback annual allotment when HR hasn't set a per-employee value yet. */
export const DEFAULT_PTO_ALLOWANCE = 10;

export function ptoTypeLabel(type: string): string {
  return PTO_TYPES.find((t) => t.key === type)?.label ?? type;
}

/** Company-wide PTO calendar is visible to admins and HR only. */
export function canViewAllPto(user: Pick<SessionUser, "role" | "hrAccess">): boolean {
  return user.role === "admin" || user.hrAccess;
}

// ---- Date helpers ---------------------------------------------------------
// PTO dates are day-granular. We normalize to UTC midnight so business-day
// counting and range comparisons are stable regardless of server timezone.
function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Business days (Mon–Fri), inclusive of both endpoints. */
export function countPtoDays(start: Date, end: Date): number {
  const s = toUtcDay(start);
  const e = toUtcDay(end);
  if (e.getTime() < s.getTime()) return 0;
  let n = 0;
  for (const d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day >= 1 && day <= 5) n++;
  }
  return n;
}

// ---- Balances -------------------------------------------------------------
export type PtoBalance = { allowance: number; used: number; remaining: number; pending: number };

/**
 * A person's PTO balance for a calendar year. `used` = approved days whose
 * start falls in the year; `pending` = days awaiting a decision. Allowance
 * falls back to the company default until HR sets a specific value.
 */
export async function ptoBalance(employeeId: string, year: number = new Date().getUTCFullYear()): Promise<PtoBalance> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { ptoAllowanceDays: true } });
  const allowance = emp?.ptoAllowanceDays ?? DEFAULT_PTO_ALLOWANCE;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  const [approved, pending] = await Promise.all([
    prisma.ptoRequest.aggregate({ _sum: { days: true }, where: { employeeId, status: "approved", startDate: { gte: yearStart, lte: yearEnd } } }),
    prisma.ptoRequest.aggregate({ _sum: { days: true }, where: { employeeId, status: "pending" } }),
  ]);
  const used = approved._sum.days ?? 0;
  const pend = pending._sum.days ?? 0;
  return { allowance, used, remaining: allowance - used, pending: pend };
}

// ---- Queries --------------------------------------------------------------
export type PtoWithEmployee = Awaited<ReturnType<typeof pendingRequestsForBranch>>[number];

/** All of an employee's own requests, newest first. */
export function requestsForEmployee(employeeId: string) {
  return prisma.ptoRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
}

/** Pending requests for a branch (null/undefined = every branch) — the
 *  supervisor review queue and the reminder count both read this. */
export function pendingRequestsForBranch(branch?: string | null) {
  return prisma.ptoRequest.findMany({
    where: { status: "pending", employee: branch ? { branch } : undefined },
    include: { employee: { select: { id: true, name: true, branch: true, role: true } } },
    orderBy: { startDate: "asc" },
  });
}

/** Approved requests overlapping a [from, to] window, for the calendars.
 *  branch null/undefined = company-wide. */
export function approvedPtoInRange(from: Date, to: Date, branch?: string | null) {
  return prisma.ptoRequest.findMany({
    where: {
      status: "approved",
      startDate: { lte: to },
      endDate: { gte: from },
      employee: branch ? { branch } : undefined,
    },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { startDate: "asc" },
  });
}

/** Upcoming/recent approved PTO for one employee (for their profile). */
export function approvedPtoForEmployee(employeeId: string, limit = 20) {
  return prisma.ptoRequest.findMany({
    where: { employeeId, status: "approved" },
    orderBy: { startDate: "desc" },
    take: limit,
  });
}

// ---- Supervisor routing ---------------------------------------------------
/**
 * Who supervises a branch: the manager User(s) whose home branch matches. When
 * a branch has no manager on file, PTO alerts fall back to HR so nothing is
 * dropped.
 */
export async function branchSupervisorEmails(branch: string | null): Promise<string[]> {
  if (branch) {
    const mgrs = await prisma.user.findMany({ where: { role: "manager", branch, active: true }, select: { email: true } });
    const emails = mgrs.map((m) => m.email).filter(Boolean);
    if (emails.length) return [...new Set(emails)];
  }
  return [await getHrEmail()];
}

// ---- Mutations ------------------------------------------------------------
export async function createPtoRequest(input: {
  employeeId: string;
  start: Date;
  end: Date;
  type?: string;
  note?: string | null;
}) {
  const start = toUtcDay(input.start);
  const end = toUtcDay(input.end);
  if (end.getTime() < start.getTime()) throw new Error("The end date can't be before the start date.");
  const days = countPtoDays(start, end);
  if (days < 1) throw new Error("That range has no working (Mon–Fri) days.");
  const type = PTO_TYPES.some((t) => t.key === input.type) ? (input.type as PtoType) : "vacation";

  return prisma.ptoRequest.create({
    data: { employeeId: input.employeeId, startDate: start, endDate: end, days, type, note: input.note?.trim() || null, status: "pending" },
    include: { employee: { select: { id: true, name: true, branch: true, email: true } } },
  });
}

export async function decidePtoRequest(id: string, approve: boolean, reviewer: SessionUser, note?: string | null) {
  return prisma.ptoRequest.update({
    where: { id },
    data: {
      status: approve ? "approved" : "denied",
      reviewedById: reviewer.id,
      reviewedByName: reviewer.name,
      decidedAt: new Date(),
      decisionNote: note?.trim() || null,
    },
    include: { employee: { select: { id: true, name: true, branch: true, email: true } } },
  });
}

/** An employee cancels their own still-pending request. */
export async function cancelPtoRequest(id: string, employeeId: string) {
  const req = await prisma.ptoRequest.findUnique({ where: { id } });
  if (!req || req.employeeId !== employeeId) throw new Error("Request not found.");
  if (req.status !== "pending") throw new Error("Only a pending request can be cancelled.");
  return prisma.ptoRequest.update({ where: { id }, data: { status: "cancelled" } });
}
