import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";

// Attendance / call-out tracking. DELIBERATELY separate from PTO (lib/pto.ts):
// there is no allowance/balance here — an Absence is a logged, monitored
// occurrence for HR to spot attendance PATTERNS, plus a compliance-driven
// medical-note rule. Nothing is ever hard-deleted (HR audit record).
//
// COMPLIANCE GUARDRAIL: we track the medical-note STATUS only (none / requested
// / received / waived) — NEVER a diagnosis or medical detail. The "waived" path
// exists for FMLA/ADA situations.

// Canonical reason list (code + label), in display order. "physical_injury"
// drives the workplace-related / accident-link flow; the ILLNESS_REASONS drive
// the medical-note rule; "other" requires a free-text detail.
export const REASONS = [
  { code: "employee_illness", label: "Employee illness" },
  { code: "family_illness", label: "Child / family illness" },
  { code: "family_emergency", label: "Family emergency" },
  { code: "bereavement", label: "Bereavement" },
  { code: "physical_injury", label: "Employee physical injury" },
  { code: "personal", label: "Personal day" },
  { code: "medical_appointment", label: "Medical / dental appointment" },
  { code: "transportation", label: "Transportation / vehicle issue" },
  { code: "no_call_no_show", label: "No call / no show" },
  { code: "other", label: "Other" },
] as const;

export type ReasonCode = (typeof REASONS)[number]["code"];

// Illness reasons — these (and only these) trip the medical-note rule.
export const ILLNESS_REASONS: ReasonCode[] = ["employee_illness", "family_illness"];

export const NOTE_STATUSES = ["none", "requested", "received", "waived"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export function reasonLabel(code: string): string {
  return REASONS.find((r) => r.code === code)?.label ?? code;
}

export function isReason(code: string): code is ReasonCode {
  return REASONS.some((r) => r.code === code);
}

// ---- Date helpers ---------------------------------------------------------
// Call-outs are day-granular. Normalize to UTC midnight so calendar-day
// counting and range comparisons are stable regardless of server timezone.
export function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Inclusive calendar-day count of the span (single day = 1). */
export function spanDays(start: Date, end: Date): number {
  const s = toUtcDay(start);
  const e = toUtcDay(end);
  if (e.getTime() < s.getTime()) return 0;
  return Math.round((e.getTime() - s.getTime()) / 864e5) + 1;
}

// ---- The medical-note rule ------------------------------------------------
/**
 * The doctor's-note requirement, applied CONSISTENTLY by rule (not ad hoc):
 * an illness (employee or family) spanning MORE THAN 2 calendar days requires
 * a medical note. Returns true when a note should be required for this record.
 */
export function checklistNoteRule(absence: { reason: string; days: number }): boolean {
  return ILLNESS_REASONS.includes(absence.reason as ReasonCode) && absence.days > 2;
}

// ---- Access ---------------------------------------------------------------
/** Admin + HR director may log/view any branch; a branch manager only their own. */
export function canManageAbsenceBranch(user: SessionUser, branch: string | null): boolean {
  if (user.role === "admin" || user.hrAccess || isHrDirector(user)) return true;
  if (user.role === "manager" && user.branch && user.branch === branch) return true;
  return false;
}

/** Only admin + HR may resolve a medical note (received / waived). Managers may NOT. */
export function canResolveNotes(user: SessionUser): boolean {
  return user.role === "admin" || user.hrAccess || isHrDirector(user);
}

/** True when the actor is an ordinary branch manager (not admin, not HR director). */
export function isBranchManagerActor(user: SessionUser): boolean {
  return !(user.role === "admin" || user.hrAccess || isHrDirector(user)) && user.role === "manager";
}

// ---- Queries --------------------------------------------------------------
/** All of an employee's call-outs, newest first. */
export function absencesForEmployee(employeeId: string) {
  return prisma.absence.findMany({ where: { employeeId }, orderBy: { startDate: "desc" } });
}

/** Call-outs for a branch (null = every branch), newest first, with the person. */
export function absencesForBranch(branch?: string | null, limit = 200) {
  return prisma.absence.findMany({
    where: branch ? { branch } : undefined,
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { startDate: "desc" },
    take: limit,
  });
}

/**
 * Outstanding medical notes — absences where a note is required but not yet
 * received or waived (i.e. still "requested"). Drives the HR alert / count badge.
 * branch null = company-wide.
 */
export function outstandingMedicalNotes(branch?: string | null) {
  return prisma.absence.findMany({
    where: { noteRequired: true, noteStatus: "requested", ...(branch ? { branch } : {}) },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { startDate: "asc" },
  });
}

/** Count of outstanding medical notes (for the People/HR badge). */
export function outstandingMedicalNoteCount(branch?: string | null) {
  return prisma.absence.count({
    where: { noteRequired: true, noteStatus: "requested", ...(branch ? { branch } : {}) },
  });
}

export type AbsencePattern = {
  employeeId: string;
  name: string;
  branch: string | null;
  count: number; // number of call-out occurrences in the window
  totalDays: number; // total absent calendar days in the window
  lastDate: Date;
};

/**
 * Per-employee call-out counts + total absent days over a trailing window
 * (default 90 days), sorted by count desc then days desc, to surface frequent
 * call-outs / patterns. branch null = company-wide.
 */
export async function absencePatterns(branch?: string | null, sinceDays = 90): Promise<AbsencePattern[]> {
  const since = new Date(Date.now() - sinceDays * 864e5);
  const rows = await prisma.absence.findMany({
    where: { startDate: { gte: since }, ...(branch ? { branch } : {}) },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { startDate: "desc" },
  });
  const byEmp = new Map<string, AbsencePattern>();
  for (const a of rows) {
    const prev = byEmp.get(a.employeeId);
    if (prev) {
      prev.count += 1;
      prev.totalDays += a.days;
      if (a.startDate > prev.lastDate) prev.lastDate = a.startDate;
    } else {
      byEmp.set(a.employeeId, {
        employeeId: a.employeeId,
        name: a.employee.name,
        branch: a.employee.branch,
        count: 1,
        totalDays: a.days,
        lastDate: a.startDate,
      });
    }
  }
  return [...byEmp.values()].sort((x, y) => y.count - x.count || y.totalDays - x.totalDays);
}

/**
 * Adjacency helper (secondary to the primary `days > 2` rule): detect illness
 * absences that are contiguous (touching or overlapping calendar days) with the
 * given span for the same employee, so a run split across two records still
 * trips the note rule. Returns the combined inclusive day-count of the connected
 * run INCLUDING this span. Excludes `excludeId` (the record being updated).
 */
export async function consecutiveIllnessRun(
  employeeId: string,
  start: Date,
  end: Date,
  excludeId?: string,
): Promise<number> {
  const others = await prisma.absence.findMany({
    where: {
      employeeId,
      reason: { in: ILLNESS_REASONS },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, startDate: true, endDate: true },
  });
  let lo = toUtcDay(start).getTime();
  let hi = toUtcDay(end).getTime();
  const day = 864e5;
  // Iteratively absorb any illness record whose span touches (adjacent within
  // one day) the growing run, until nothing new connects.
  let grew = true;
  const used = new Set<string>();
  while (grew) {
    grew = false;
    for (const o of others) {
      if (used.has(o.id)) continue;
      const os = toUtcDay(o.startDate).getTime();
      const oe = toUtcDay(o.endDate).getTime();
      const touches = os <= hi + day && oe >= lo - day;
      if (touches) {
        lo = Math.min(lo, os);
        hi = Math.max(hi, oe);
        used.add(o.id);
        grew = true;
      }
    }
  }
  return Math.round((hi - lo) / day) + 1;
}

// ---- Manager-logged notification recipients -------------------------------
/**
 * When a BRANCH MANAGER logs a call-out, the CEO (Chris Slade) and the HR
 * director must be alerted (email + in-app) so they can notify stakeholders.
 * Resolve those people to thread-participant rows (userId/name/email), keeping
 * only ACTIVE users with a login, de-duped, and excluding the logger. Missing
 * people are simply skipped so a log never fails because someone left.
 *
 * The CEO is resolved as: any admin account, plus the account whose email is
 * the CEO address (c.slade@…). The HR director is resolved dynamically: any
 * user flagged hrAccess, plus the HR-director email (awilliford@…).
 */
export async function calloutNotifyParticipants(excludeUserId?: string): Promise<
  { userId: string; name: string; email: string | null }[]
> {
  const CEO_EMAIL = "c.slade@clementspestcontrol.com";
  const HR_EMAIL = (process.env.HR_EMAIL || "awilliford@clementspestcontrol.com").toLowerCase();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: "admin" },
        { hrAccess: true },
        { email: { in: [CEO_EMAIL, HR_EMAIL] } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  return users
    .filter((u) => u.id !== excludeUserId)
    .map((u) => ({ userId: u.id, name: u.name, email: u.email }));
}
