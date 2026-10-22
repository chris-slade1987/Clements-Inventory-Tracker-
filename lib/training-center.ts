import "server-only";
import { prisma } from "@/lib/prisma";
import type {
  EmployeePick,
  CoursePick,
  EmployeeCourseRow,
  EmployeeAssignmentView,
  EmployeeRecord,
  InProgressRow,
  StalledRow,
  PendingSignoffRow,
  AwardsByMonthRow,
} from "@/lib/training-center-types";
import { STALLED_DAYS } from "@/lib/training-center-types";

/**
 * Read-only data access for the Training Center UI (the Assign wizard's pickers,
 * the employee record screen, and the four reports). All WRITE / assignment logic
 * lives in lib/training-assign.ts — this file never mutates. Shared types and
 * labels live in lib/training-center-types.ts (client-safe) and are re-exported
 * here for server callers.
 */

// Re-export the client-safe types/constants so existing server imports keep working.
export * from "@/lib/training-center-types";

// ---------------------------------------------------------------------------
// Pickers (Assign wizard)
// ---------------------------------------------------------------------------

/** Active employees, for the Assign wizard's searchable select. */
export async function listActiveEmployees(): Promise<EmployeePick[]> {
  const emps = await prisma.employee.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, branch: true, role: true, division: true },
  });
  return emps;
}

/** The full course catalog, for the single-course (standalone) picker. */
export async function listCourseCatalog(): Promise<CoursePick[]> {
  const courses = await prisma.certCourse.findMany({
    orderBy: { order: "asc" },
    include: { certification: { select: { code: true } } },
  });
  return courses.map((c) => ({
    code: c.code,
    name: c.name,
    group: c.certification.code,
    courseType: c.courseType,
  }));
}

// ---------------------------------------------------------------------------
// Employee record
// ---------------------------------------------------------------------------

/** Count an employee's OUTSTANDING certification work for the Employee Hub tile —
 *  active module assignments that still have at least one incomplete course. Cheap
 *  (no snapshot expansion): an assignment is outstanding while its status is
 *  "active". Lets the Hub tile reflect certification modules, not just the legacy
 *  CEU assignments. */
export async function outstandingCertModuleCount(employeeId: string): Promise<number> {
  return prisma.moduleAssignment.count({ where: { employeeId, status: "active" } });
}

export async function getEmployeeRecord(employeeId: string): Promise<EmployeeRecord | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, branch: true, role: true, division: true },
  });
  if (!employee) return null;

  const [awards, assignments, progress, signoffs] = await Promise.all([
    prisma.certAward.findMany({
      where: { employeeId },
      orderBy: { awardedAt: "desc" },
      include: { certification: { select: { code: true, name: true } } },
    }),
    prisma.moduleAssignment.findMany({
      where: { employeeId },
      orderBy: { assignedAt: "desc" },
      include: {
        module: { select: { code: true, name: true } },
        program: { select: { code: true } },
        standaloneCourse: { select: { code: true, name: true } },
      },
    }),
    prisma.courseProgress.findMany({
      where: { employeeId },
      include: { course: { include: { certification: { select: { code: true } } } } },
    }),
    prisma.fieldSignoff.findMany({
      where: { employeeId },
      orderBy: { date: "desc" },
      include: { course: { select: { code: true, name: true } }, certification: { select: { code: true } } },
    }),
  ]);

  const progressByCode = new Map(progress.map((p) => [p.course.code, p]));

  // Any snapshot code that has no progress row still needs a name/group to render.
  const allSnapshotCodes = new Set<string>();
  for (const a of assignments) {
    const codes: string[] = a.courseCodesSnapshot ? safeParse(a.courseCodesSnapshot) : [];
    codes.forEach((c) => allSnapshotCodes.add(c));
  }
  const missing = [...allSnapshotCodes].filter((c) => !progressByCode.has(c));
  const missingCourses = missing.length
    ? await prisma.certCourse.findMany({
        where: { code: { in: missing } },
        include: { certification: { select: { code: true } } },
      })
    : [];
  const missingByCode = new Map(missingCourses.map((c) => [c.code, c]));

  function rowFor(code: string): EmployeeCourseRow {
    const p = progressByCode.get(code);
    if (p) {
      return {
        code: p.course.code,
        name: p.course.name,
        group: p.course.certification.code,
        courseType: p.course.courseType,
        status: p.status,
        completedDate: p.completedDate ? p.completedDate.toISOString().slice(0, 10) : null,
        score: p.score ?? null,
        contentUrl: p.course.contentUrl ?? null,
      };
    }
    const c = missingByCode.get(code);
    return {
      code,
      name: c?.name ?? code,
      group: c?.certification.code ?? "—",
      courseType: c?.courseType ?? "written",
      status: "not_started",
      completedDate: null,
      score: null,
      contentUrl: c?.contentUrl ?? null,
    };
  }

  function viewFor(a: (typeof assignments)[number]): EmployeeAssignmentView {
    const codes: string[] = a.courseCodesSnapshot ? safeParse(a.courseCodesSnapshot) : [];
    const courses = codes.map(rowFor);
    const completeCount = courses.filter((c) => c.status === "complete" || c.status === "credited").length;
    return {
      id: a.id,
      moduleCode: a.module?.code ?? null,
      moduleName: a.module?.name ?? null,
      programCode: a.program?.code ?? null,
      standaloneCourseCode: a.standaloneCourse?.code ?? null,
      status: a.status,
      startMonth: a.startMonth,
      assignedAt: a.assignedAt.toISOString(),
      assignedByName: a.assignedByName,
      branch: a.branch,
      prereqNote: a.prereqNote,
      courses,
      completeCount,
      totalCount: courses.length,
    };
  }

  const views = assignments.map(viewFor);

  return {
    employee,
    awards: awards.map((a) => ({
      code: a.certification.code,
      name: a.certification.name,
      awardedAt: a.awardedAt.toISOString().slice(0, 10),
      approvedByName: a.approvedByName,
    })),
    activeAssignments: views.filter((v) => v.status === "active"),
    completedAssignments: views.filter((v) => v.status !== "active"),
    signoffs: signoffs.map((s) => ({
      id: s.id,
      courseCode: s.course?.code ?? null,
      courseName: s.course?.name ?? null,
      certCode: s.certification?.code ?? null,
      date: s.date.toISOString().slice(0, 10),
      hours: s.hours ?? null,
      trainerName: s.trainerName,
      approved: s.approved,
      approvedByName: s.approvedByName,
      note: s.note,
    })),
    history: progress
      .map((p) => ({
        code: p.course.code,
        name: p.course.name,
        group: p.course.certification.code,
        courseType: p.course.courseType,
        status: p.status,
        completedDate: p.completedDate ? p.completedDate.toISOString().slice(0, 10) : null,
        score: p.score ?? null,
        contentUrl: p.course.contentUrl ?? null,
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.code.localeCompare(b.code)),
  };
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Report 1: active module assignments grouped by branch & module. */
export async function assignmentsInProgress(): Promise<InProgressRow[]> {
  const active = await prisma.moduleAssignment.findMany({
    where: { status: "active", moduleId: { not: null } },
    include: { module: { select: { code: true, name: true } } },
  });
  const map = new Map<string, InProgressRow>();
  for (const a of active) {
    const branch = a.branch ?? "—";
    const code = a.module?.code ?? "—";
    const key = `${branch}::${code}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { branch, moduleCode: code, moduleName: a.module?.name ?? code, count: 1 });
  }
  return [...map.values()].sort(
    (a, b) => a.branch.localeCompare(b.branch) || a.moduleCode.localeCompare(b.moduleCode),
  );
}

/** Report 2: active assignments with courses not completed, assigned >30 days ago. */
export async function stalledAssignments(now: Date = new Date()): Promise<StalledRow[]> {
  const cutoff = new Date(now.getTime() - STALLED_DAYS * 864e5);
  const active = await prisma.moduleAssignment.findMany({
    where: { status: "active", assignedAt: { lt: cutoff } },
    orderBy: { assignedAt: "asc" },
    include: {
      employee: { select: { id: true, name: true } },
      module: { select: { code: true, name: true } },
    },
  });
  const rows: StalledRow[] = [];
  for (const a of active) {
    const codes: string[] = a.courseCodesSnapshot ? safeParse(a.courseCodesSnapshot) : [];
    if (codes.length === 0) continue;
    const courses = await prisma.certCourse.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, name: true },
    });
    const done = await prisma.courseProgress.findMany({
      where: {
        employeeId: a.employeeId,
        courseId: { in: courses.map((c) => c.id) },
        status: { in: ["complete", "credited"] },
      },
      select: { courseId: true },
    });
    const doneIds = new Set(done.map((d) => d.courseId));
    const outstanding = courses
      .filter((c) => !doneIds.has(c.id))
      .map((c) => ({ code: c.code, name: c.name }));
    if (outstanding.length === 0) continue;
    rows.push({
      assignmentId: a.id,
      employeeId: a.employee.id,
      employeeName: a.employee.name,
      branch: a.branch,
      moduleCode: a.module?.code ?? null,
      moduleName: a.module?.name ?? null,
      assignedAt: a.assignedAt.toISOString().slice(0, 10),
      daysOld: Math.floor((now.getTime() - a.assignedAt.getTime()) / 864e5),
      outstanding,
    });
  }
  return rows;
}

/** Report 3: field sign-offs waiting on a supervisor's approval. */
export async function pendingSignoffs(): Promise<PendingSignoffRow[]> {
  const list = await prisma.fieldSignoff.findMany({
    where: { approved: false },
    orderBy: { date: "asc" },
    include: {
      employee: { select: { id: true, name: true, branch: true } },
      course: { select: { code: true } },
      certification: { select: { code: true } },
    },
  });
  return list.map((s) => ({
    id: s.id,
    employeeId: s.employee.id,
    employeeName: s.employee.name,
    branch: s.employee.branch,
    courseCode: s.course?.code ?? null,
    certCode: s.certification?.code ?? null,
    date: s.date.toISOString().slice(0, 10),
    hours: s.hours ?? null,
    trainerName: s.trainerName,
  }));
}

/** Report 4: certifications awarded, grouped by YYYY-MM (most recent first). */
export async function awardsByMonth(): Promise<AwardsByMonthRow[]> {
  const awards = await prisma.certAward.findMany({
    orderBy: { awardedAt: "desc" },
    include: {
      employee: { select: { name: true } },
      certification: { select: { code: true } },
    },
  });
  const map = new Map<string, AwardsByMonthRow>();
  for (const a of awards) {
    const month = a.awardedAt.toISOString().slice(0, 7);
    const row = map.get(month) ?? { month, count: 0, certs: [] };
    row.count++;
    row.certs.push({ certCode: a.certification.code, employeeName: a.employee.name });
    map.set(month, row);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}
