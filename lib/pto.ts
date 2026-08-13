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

/**
 * "Branch manager and above" — a login carrying manager / admin / super_admin
 * access rights. (`role` "admin" covers admin + super_admin; "manager" covers
 * branch managers; `accessLevel` is also checked so elevated logins are caught
 * even if their `role` lags.) Company policy routes these people's PTO requests
 * to the Director of HR for approval instead of a branch supervisor.
 */
export function isManagerOrAbove(u: { role?: string | null; accessLevel?: string | null }): boolean {
  const role = u.role ?? "";
  const lvl = u.accessLevel ?? "";
  return role === "admin" || role === "manager" || lvl === "super_admin" || lvl === "admin" || lvl === "manager";
}

/** Whether an employee's linked login is manager-and-above (drives HR routing at decision time). */
export async function employeeIsManagerOrAbove(employeeId: string | null | undefined): Promise<boolean> {
  if (!employeeId) return false;
  const u = await prisma.user.findUnique({ where: { employeeId }, select: { role: true, accessLevel: true } });
  return u ? isManagerOrAbove(u) : false;
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
 *  supervisor review queue and the reminder count both read this. Pass
 *  `excludeManagerPlus` from branch-supervisor surfaces to hide requests from
 *  manager-and-above staff (those are routed to HR); HR's company-wide view
 *  leaves it off so it still sees every request. */
export function pendingRequestsForBranch(branch?: string | null, opts?: { excludeManagerPlus?: boolean }) {
  const excludeMgr = opts?.excludeManagerPlus === true;
  return prisma.ptoRequest.findMany({
    where: {
      status: "pending",
      employee:
        branch || excludeMgr
          ? {
              ...(branch ? { branch } : {}),
              // Employees with no login, or a login below manager, stay visible;
              // manager/admin/super_admin logins are hidden from the branch queue.
              ...(excludeMgr ? { OR: [{ user: null }, { user: { role: { notIn: ["admin", "manager"] } } }] } : {}),
            }
          : undefined,
    },
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

/** PENDING requests overlapping a [from, to] window, for the decide-in-context
 *  calendar overlay. Mirrors approvedPtoInRange; branch null/undefined = company-wide. */
export function pendingPtoInRange(from: Date, to: Date, branch?: string | null) {
  return prisma.ptoRequest.findMany({
    where: {
      status: "pending",
      startDate: { lte: to },
      endDate: { gte: from },
      employee: branch ? { branch } : undefined,
    },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { startDate: "asc" },
  });
}

/** Decision history — approved + denied requests, newest decision first.
 *  branch null/undefined = company-wide. */
export function decisionLog(branch?: string | null, limit = 100) {
  return prisma.ptoRequest.findMany({
    where: { status: { in: ["approved", "denied"] }, employee: branch ? { branch } : undefined },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { decidedAt: "desc" },
    take: limit,
  });
}

// ---- Decide-in-context overlap -------------------------------------------
export type PtoOverlap = {
  /** Other people (approved + pending) whose time off intersects this request, same branch. */
  others: { name: string; status: "approved" | "pending"; type: string }[];
  /** Distinct people off in this request's range (approved + pending, incl. the requester). */
  offCount: number;
  /** Active headcount in the requester's branch. */
  headcount: number;
};

type OverlapInput = {
  id: string;
  employeeId: string;
  startDate: Date;
  endDate: Date;
  employee: { branch: string | null };
};

/**
 * For each pending request, compute who else on the same branch is off during
 * its range (approved + pending, excluding the request itself) plus a coverage
 * count. Efficient: two window queries (approved + pending) over the whole
 * pending set's min→max range, then intersect in JS — never a query per request.
 */
export async function overlapForRequests(pending: OverlapInput[]): Promise<Map<string, PtoOverlap>> {
  const out = new Map<string, PtoOverlap>();
  if (pending.length === 0) return out;

  const from = new Date(Math.min(...pending.map((p) => p.startDate.getTime())));
  const to = new Date(Math.max(...pending.map((p) => p.endDate.getTime())));

  const [approved, pendingAll, headcounts] = await Promise.all([
    prisma.ptoRequest.findMany({
      where: { status: "approved", startDate: { lte: to }, endDate: { gte: from } },
      include: { employee: { select: { id: true, name: true, branch: true } } },
    }),
    prisma.ptoRequest.findMany({
      where: { status: "pending", startDate: { lte: to }, endDate: { gte: from } },
      include: { employee: { select: { id: true, name: true, branch: true } } },
    }),
    prisma.employee.groupBy({ by: ["branch"], where: { status: "active" }, _count: { _all: true } }),
  ]);

  const headByBranch = new Map<string | null, number>(headcounts.map((h) => [h.branch, h._count._all]));
  const universe = [
    ...approved.map((r) => ({ ...r, _status: "approved" as const })),
    ...pendingAll.map((r) => ({ ...r, _status: "pending" as const })),
  ];

  for (const req of pending) {
    const rs = req.startDate.getTime();
    const re = req.endDate.getTime();
    const branch = req.employee.branch;

    // Dedupe other people; prefer showing an approved conflict over a pending one.
    const byPerson = new Map<string, { name: string; status: "approved" | "pending"; type: string }>();
    const offPeople = new Set<string>([req.employeeId]); // the requester is off too

    for (const r of universe) {
      if (r.employee.branch !== branch) continue;
      const intersects = r.startDate.getTime() <= re && r.endDate.getTime() >= rs;
      if (!intersects) continue;
      offPeople.add(r.employee.id);
      if (r.id === req.id || r.employee.id === req.employeeId) continue;
      const prev = byPerson.get(r.employee.id);
      if (!prev || (prev.status === "pending" && r._status === "approved")) {
        byPerson.set(r.employee.id, { name: r.employee.name, status: r._status, type: r.type });
      }
    }

    out.set(req.id, {
      others: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
      offCount: offPeople.size,
      headcount: headByBranch.get(branch) ?? 0,
    });
  }

  return out;
}

// ---- Balances (batched, all active employees) ----------------------------
export type EmployeeBalance = {
  id: string;
  name: string;
  branch: string | null;
  allowance: number;
  used: number;
  remaining: number;
  pending: number;
};

/**
 * PTO balances for every active employee for a calendar year, one row each.
 * Batched: aggregate approved + pending days grouped by employee, then join to
 * the active roster with each person's allowance (default when unset).
 */
export async function balancesForAll(year: number = new Date().getUTCFullYear(), branch?: string | null): Promise<EmployeeBalance[]> {
  const employees = await prisma.employee.findMany({
    where: { status: "active", ...(branch ? { branch } : {}) },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
    select: { id: true, name: true, branch: true, ptoAllowanceDays: true },
  });
  if (employees.length === 0) return [];
  const ids = employees.map((e) => e.id);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  const [approvedByEmp, pendingByEmp] = await Promise.all([
    prisma.ptoRequest.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, status: "approved", startDate: { gte: yearStart, lte: yearEnd } },
      _sum: { days: true },
    }),
    prisma.ptoRequest.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, status: "pending" },
      _sum: { days: true },
    }),
  ]);
  const usedMap = new Map(approvedByEmp.map((r) => [r.employeeId, r._sum.days ?? 0]));
  const pendMap = new Map(pendingByEmp.map((r) => [r.employeeId, r._sum.days ?? 0]));

  return employees.map((e) => {
    const allowance = e.ptoAllowanceDays ?? DEFAULT_PTO_ALLOWANCE;
    const used = usedMap.get(e.id) ?? 0;
    return { id: e.id, name: e.name, branch: e.branch, allowance, used, remaining: allowance - used, pending: pendMap.get(e.id) ?? 0 };
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
