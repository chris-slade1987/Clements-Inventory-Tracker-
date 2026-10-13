import type { PrismaClient } from "@prisma/client";

/**
 * Training Center assignment engine — implements the 7 assignment rules from the
 * CanopyOS Training Assignment Build Spec (J. Glanville, 2026-10-13).
 *
 *  1. Modules are premapped + locked (course list + order come from the catalog;
 *     snapshotted onto the assignment so template edits only affect new ones).
 *  2. Automatic credit, tracked per employee per COURSE CODE across everything:
 *     completed-before → Credited (keep original date); in-progress elsewhere →
 *     Linked (not duplicated); not started → Assigned.
 *  3. Service Expansion (SVC-*) carries only that service's courses; if the
 *     employee has no Field Core (FC) complete, SVC-FC courses are prepended with
 *     a notice.
 *  4. Standalone single-course assignment; counts toward credit; exempt from pacing.
 *  5. Advancement programs (PRG-SLS / PRG-MGT) run modules in step order, auto-
 *     assigning the next incomplete step and skipping completed ones.
 *  6. Pacing: at most one module STARTED per calendar month (admin setting,
 *     default ON). Standalone courses are exempt.
 *  7. Courses run in order; a certification is awarded only when every course in
 *     its group is complete AND its field sign-off is approved.
 *
 * Preview functions NEVER write. Confirm functions are transactional.
 */

export const PACING_SETTING_KEY = "training.modules_per_month";
const FIELD_CORE_CODE = "FC";

// ---------------------------------------------------------------------------
// Settings / pacing
// ---------------------------------------------------------------------------

/** Modules allowed to START per calendar month. Default 1 (pacing ON). 0 = off. */
export async function getModulesPerMonth(prisma: PrismaClient): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: PACING_SETTING_KEY } }).catch(() => null);
  if (!s) return 1;
  const n = parseInt(s.value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthStart(month: string): Date {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m, 1); // m is 1-based → new Date(y, m, 1) = first of the NEXT month
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CourseRole = "assigned" | "credited" | "linked";

export type PreviewCourse = {
  code: string;
  name: string;
  group: string;
  courseType: string;
  sequence: number;
  role: CourseRole;
  completedDate: string | null; // ISO date for credited courses
};

export type AssignmentPreview = {
  kind: "module" | "standalone";
  programCode: string | null;
  moduleCode: string | null;
  moduleName: string | null;
  standaloneCourseCode: string | null;
  courses: PreviewCourse[]; // full ordered list with role
  toComplete: PreviewCourse[];
  credited: PreviewCourse[];
  linked: PreviewCourse[];
  prereqAdded: string[]; // course codes auto-added (SVC-FC guard)
  prereqNote: string | null;
  certsEarned: { code: string; name: string }[];
  pacing: { enabled: boolean; limit: number; blockedThisMonth: boolean; earliestStartMonth: string; earliestStartDate: string };
  advancementStep: { programCode: string; step: number; total: number } | null;
};

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

async function moduleCourseList(prisma: PrismaClient, moduleId: string) {
  const links = await prisma.trainingModuleCourse.findMany({
    where: { moduleId },
    orderBy: { sequence: "asc" },
    include: { course: { include: { certification: true } } },
  });
  return links.map((l) => l.course);
}

async function courseListByCodes(prisma: PrismaClient, codes: string[]) {
  const courses = await prisma.certCourse.findMany({
    where: { code: { in: codes } },
    include: { certification: true },
  });
  const byCode = new Map(courses.map((c) => [c.code, c]));
  return codes.map((c) => byCode.get(c)).filter((c): c is NonNullable<typeof c> => !!c);
}

/** True if the employee holds Field Core (FC cert awarded, or all FC courses complete). */
async function hasFieldCore(prisma: PrismaClient, employeeId: string): Promise<boolean> {
  const fc = await prisma.certification.findUnique({ where: { code: FIELD_CORE_CODE } });
  if (!fc) return false;
  const award = await prisma.certAward.findFirst({ where: { employeeId, certificationId: fc.id } });
  if (award) return true;
  const fcCourses = await prisma.certCourse.findMany({ where: { certificationId: fc.id }, select: { id: true } });
  if (fcCourses.length === 0) return false;
  const done = await prisma.courseProgress.count({
    where: { employeeId, courseId: { in: fcCourses.map((c) => c.id) }, status: "complete" },
  });
  return done >= fcCourses.length;
}

// ---------------------------------------------------------------------------
// Preview (no writes)
// ---------------------------------------------------------------------------

type ModuleWithCourses = { id: string; code: string; name: string; certificationsEarned: string | null };

type CourseLite = {
  id: string;
  code: string;
  name: string;
  courseType: string;
  certification: { code: string; name: string };
};

async function classifyCourses(
  prisma: PrismaClient,
  employeeId: string,
  orderedCourses: CourseLite[],
): Promise<PreviewCourse[]> {
  const progress = await prisma.courseProgress.findMany({
    where: { employeeId, courseId: { in: orderedCourses.map((c) => c.id) } },
  });
  const byCourse = new Map(progress.map((p) => [p.courseId, p]));
  return orderedCourses.map((c, i) => {
    const p = byCourse.get(c.id);
    let role: CourseRole = "assigned";
    let completedDate: string | null = null;
    if (p) {
      if (p.status === "complete" || p.status === "credited") {
        role = "credited";
        completedDate = p.completedDate ? p.completedDate.toISOString().slice(0, 10) : null;
      } else if (p.status === "in_progress" || p.status === "assigned") {
        role = "linked"; // already on another assignment
      }
    }
    return {
      code: c.code,
      name: c.name,
      group: c.certification.code,
      courseType: c.courseType,
      sequence: i + 1,
      role,
      completedDate,
    };
  });
}

/** Resolve the module a program+situation points at, for the "choose one" programs. */
export async function resolveProgramModule(prisma: PrismaClient, programCode: string, moduleCode: string) {
  const program = await prisma.trainingProgram.findUnique({ where: { code: programCode } });
  const mod = await prisma.trainingModule.findUnique({ where: { code: moduleCode } });
  return { program, module: mod };
}

/**
 * Preview a MODULE assignment (with the SVC-FC prereq guard) or a STANDALONE
 * course assignment. No DB writes.
 */
export async function previewAssignment(
  prisma: PrismaClient,
  args: {
    employeeId: string;
    moduleCode?: string;
    programCode?: string;
    standaloneCourseCode?: string;
    now?: Date;
  },
): Promise<AssignmentPreview> {
  const now = args.now ?? new Date();
  const thisMonth = monthKey(now);

  // ---- Standalone single course ----
  if (args.standaloneCourseCode) {
    const [course] = await courseListByCodes(prisma, [args.standaloneCourseCode]);
    if (!course) throw new Error(`unknown course ${args.standaloneCourseCode}`);
    const classified = await classifyCourses(prisma, args.employeeId, [course]);
    return {
      kind: "standalone",
      programCode: null,
      moduleCode: null,
      moduleName: null,
      standaloneCourseCode: course.code,
      courses: classified,
      toComplete: classified.filter((c) => c.role === "assigned"),
      credited: classified.filter((c) => c.role === "credited"),
      linked: classified.filter((c) => c.role === "linked"),
      prereqAdded: [],
      prereqNote: null,
      certsEarned: [],
      // Standalone courses are exempt from pacing — always startable now.
      pacing: {
        enabled: false,
        limit: 0,
        blockedThisMonth: false,
        earliestStartMonth: thisMonth,
        earliestStartDate: now.toISOString().slice(0, 10),
      },
      advancementStep: null,
    };
  }

  if (!args.moduleCode) throw new Error("previewAssignment requires moduleCode or standaloneCourseCode");
  const mod = await prisma.trainingModule.findUnique({ where: { code: args.moduleCode } });
  if (!mod) throw new Error(`unknown module ${args.moduleCode}`);

  // ---- Module course list (ordered) ----
  const baseCourses = (await moduleCourseList(prisma, mod.id)) as unknown as CourseLite[];

  // ---- Rule 3: SVC-FC prereq guard ----
  const prereqAdded: string[] = [];
  let prereqNote: string | null = null;
  let orderedCourses = baseCourses;
  const isServiceExpansion = mod.code.startsWith("SVC-") && mod.code !== "SVC-FC";
  if (isServiceExpansion) {
    const hasFC = await hasFieldCore(prisma, args.employeeId);
    if (!hasFC) {
      const fcModule = await prisma.trainingModule.findUnique({ where: { code: "SVC-FC" } });
      if (fcModule) {
        const fcCourses = (await moduleCourseList(prisma, fcModule.id)) as unknown as CourseLite[];
        const baseCodes = new Set(baseCourses.map((c) => c.code));
        const prepend = fcCourses.filter((c) => !baseCodes.has(c.code));
        orderedCourses = [...prepend, ...baseCourses];
        prereqAdded.push(...prepend.map((c) => c.code));
        prereqNote = `Field Core (SVC-FC) added ahead of ${mod.code}: no Field Core on record.`;
      }
    }
  }

  const classified = await classifyCourses(prisma, args.employeeId, orderedCourses);

  // ---- Certs this module earns (from the module's declared list) ----
  const certCodes = (mod.certificationsEarned ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const certs = certCodes.length
    ? await prisma.certification.findMany({ where: { code: { in: certCodes } }, select: { code: true, name: true } })
    : [];
  // keep declared order
  const certsEarned = certCodes
    .map((code) => certs.find((c) => c.code === code))
    .filter((c): c is { code: string; name: string } => !!c);

  // ---- Rule 6: pacing ----
  const limit = await getModulesPerMonth(prisma);
  const enabled = limit > 0;
  let blockedThisMonth = false;
  let earliestStartMonth = thisMonth;
  if (enabled) {
    const startedThisMonth = await prisma.moduleAssignment.count({
      where: { employeeId: args.employeeId, moduleId: { not: null }, startMonth: thisMonth },
    });
    if (startedThisMonth >= limit) {
      blockedThisMonth = true;
      earliestStartMonth = monthKey(nextMonthStart(thisMonth));
    }
  }
  const earliestStartDate = blockedThisMonth
    ? nextMonthStart(thisMonth).toISOString().slice(0, 10)
    : now.toISOString().slice(0, 10);

  return {
    kind: "module",
    programCode: args.programCode ?? null,
    moduleCode: mod.code,
    moduleName: mod.name,
    standaloneCourseCode: null,
    courses: classified,
    toComplete: classified.filter((c) => c.role === "assigned"),
    credited: classified.filter((c) => c.role === "credited"),
    linked: classified.filter((c) => c.role === "linked"),
    prereqAdded,
    prereqNote,
    certsEarned,
    pacing: { enabled, limit, blockedThisMonth, earliestStartMonth, earliestStartDate },
    advancementStep: null,
  };
}

// ---------------------------------------------------------------------------
// Confirm (transactional writes)
// ---------------------------------------------------------------------------

export async function confirmAssignment(
  prisma: PrismaClient,
  args: {
    employeeId: string;
    moduleCode?: string;
    programCode?: string;
    standaloneCourseCode?: string;
    assignedById?: string | null;
    assignedByName?: string | null;
    branch?: string | null;
    now?: Date;
    overridePacing?: boolean;
  },
): Promise<{ assignmentId: string; preview: AssignmentPreview }> {
  const now = args.now ?? new Date();
  const preview = await previewAssignment(prisma, {
    employeeId: args.employeeId,
    moduleCode: args.moduleCode,
    programCode: args.programCode,
    standaloneCourseCode: args.standaloneCourseCode,
    now,
  });

  if (preview.kind === "module" && preview.pacing.blockedThisMonth && !args.overridePacing) {
    throw new Error(
      `Pacing: this employee has already started a module this month. Earliest start ${preview.pacing.earliestStartMonth}.`,
    );
  }

  const startMonth = preview.kind === "module" ? (preview.pacing.blockedThisMonth ? preview.pacing.earliestStartMonth : monthKey(now)) : null;

  const program = args.programCode ? await prisma.trainingProgram.findUnique({ where: { code: args.programCode } }) : null;
  const mod = preview.moduleCode ? await prisma.trainingModule.findUnique({ where: { code: preview.moduleCode } }) : null;
  const standalone = preview.standaloneCourseCode
    ? await prisma.certCourse.findUnique({ where: { code: preview.standaloneCourseCode } })
    : null;

  const assignment = await prisma.$transaction(async (tx) => {
    const a = await tx.moduleAssignment.create({
      data: {
        employeeId: args.employeeId,
        programId: program?.id ?? null,
        moduleId: mod?.id ?? null,
        standaloneCourseId: standalone?.id ?? null,
        moduleVersion: mod?.version ?? null,
        branch: args.branch ?? null,
        assignedById: args.assignedById ?? null,
        assignedByName: args.assignedByName ?? null,
        startMonth,
        status: "active",
        courseCodesSnapshot: JSON.stringify(preview.courses.map((c) => c.code)),
        prereqNote: preview.prereqNote,
      },
    });

    // Create/refresh CourseProgress ONLY for newly-assigned courses. Credited and
    // linked courses keep their existing rows untouched.
    for (const pc of preview.courses) {
      if (pc.role !== "assigned") continue;
      const course = await tx.certCourse.findUnique({ where: { code: pc.code } });
      if (!course) continue;
      await tx.courseProgress.upsert({
        where: { employeeId_courseId: { employeeId: args.employeeId, courseId: course.id } },
        update: { sequence: pc.sequence, sourceAssignmentId: a.id, status: "assigned" },
        create: {
          employeeId: args.employeeId,
          courseId: course.id,
          status: "assigned",
          sequence: pc.sequence,
          sourceAssignmentId: a.id,
        },
      });
    }
    return a;
  });

  return { assignmentId: assignment.id, preview };
}

// ---------------------------------------------------------------------------
// Rule 5: advancement programs (PRG-SLS / PRG-MGT) — assign the next step
// ---------------------------------------------------------------------------

/** Ordered step modules for an advancement program. */
async function programSteps(prisma: PrismaClient, programCode: string) {
  const program = await prisma.trainingProgram.findUnique({
    where: { code: programCode },
    include: { modules: { where: { rule: "step" }, orderBy: { step: "asc" }, include: { module: true } } },
  });
  if (!program) throw new Error(`unknown program ${programCode}`);
  return program.modules.map((pm) => ({ step: pm.step ?? 0, module: pm.module }));
}

/** True when every course in the module is complete/credited for this employee. */
async function moduleComplete(prisma: PrismaClient, employeeId: string, moduleId: string): Promise<boolean> {
  const courses = await moduleCourseList(prisma, moduleId);
  if (courses.length === 0) return true;
  const done = await prisma.courseProgress.count({
    where: { employeeId, courseId: { in: courses.map((c) => c.id) }, status: { in: ["complete", "credited"] } },
  });
  return done >= courses.length;
}

/**
 * Assign the NEXT incomplete step of an advancement program, skipping steps the
 * employee has already completed. Returns the module code assigned, or null when
 * every step is already complete. Honors pacing unless overridden.
 */
export async function assignNextAdvancementStep(
  prisma: PrismaClient,
  args: { employeeId: string; programCode: string; assignedById?: string | null; assignedByName?: string | null; branch?: string | null; now?: Date; overridePacing?: boolean },
): Promise<{ assignedModuleCode: string | null; skipped: string[] }> {
  const steps = await programSteps(prisma, args.programCode);
  const skipped: string[] = [];
  for (const { module: mod } of steps) {
    const complete = await moduleComplete(prisma, args.employeeId, mod.id);
    if (complete) {
      skipped.push(mod.code);
      continue;
    }
    // Already has an active assignment for this module? Then it's the current step.
    const existing = await prisma.moduleAssignment.findFirst({
      where: { employeeId: args.employeeId, moduleId: mod.id, status: "active" },
    });
    if (existing) return { assignedModuleCode: mod.code, skipped };

    await confirmAssignment(prisma, {
      employeeId: args.employeeId,
      programCode: args.programCode,
      moduleCode: mod.code,
      assignedById: args.assignedById,
      assignedByName: args.assignedByName,
      branch: args.branch,
      now: args.now,
      overridePacing: args.overridePacing,
    });
    return { assignedModuleCode: mod.code, skipped };
  }
  return { assignedModuleCode: null, skipped };
}

// ---------------------------------------------------------------------------
// Rule 7: completion, cert-award gating, advancement progression
// ---------------------------------------------------------------------------

/**
 * Mark a course complete for an employee, then run the cert-award check. Returns
 * any certifications newly awarded. Advancing an advancement program to its next
 * step is handled by the caller (API) after this resolves.
 */
export async function completeCourse(
  prisma: PrismaClient,
  args: { employeeId: string; courseCode: string; score?: number | null; completedDate?: Date; approvedByName?: string | null; approvedByUserId?: string | null },
): Promise<{ awarded: string[] }> {
  const course = await prisma.certCourse.findUnique({ where: { code: args.courseCode } });
  if (!course) throw new Error(`unknown course ${args.courseCode}`);
  const when = args.completedDate ?? new Date();

  await prisma.courseProgress.upsert({
    where: { employeeId_courseId: { employeeId: args.employeeId, courseId: course.id } },
    update: { status: "complete", completedDate: when, score: args.score ?? undefined },
    create: { employeeId: args.employeeId, courseId: course.id, status: "complete", completedDate: when, score: args.score ?? null },
  });

  const awarded = await checkCertAward(prisma, args.employeeId, course.certificationId, {
    approvedByName: args.approvedByName ?? null,
    approvedByUserId: args.approvedByUserId ?? null,
  });
  await maybeCompleteAssignments(prisma, args.employeeId);
  return { awarded };
}

/**
 * Award a certification when EVERY course in its group is complete AND (if the
 * group has a field-sign-off course) that sign-off is approved. Idempotent.
 */
export async function checkCertAward(
  prisma: PrismaClient,
  employeeId: string,
  certificationId: string,
  by: { approvedByName: string | null; approvedByUserId: string | null },
): Promise<string[]> {
  const cert = await prisma.certification.findUnique({
    where: { id: certificationId },
    include: { courses: true },
  });
  if (!cert || cert.courses.length === 0) return [];

  // already awarded?
  const existing = await prisma.certAward.findFirst({ where: { employeeId, certificationId } });
  if (existing) return [];

  const completeCount = await prisma.courseProgress.count({
    where: { employeeId, courseId: { in: cert.courses.map((c) => c.id) }, status: { in: ["complete", "credited"] } },
  });
  if (completeCount < cert.courses.length) return [];

  // Rule 7: field sign-off must be APPROVED (not just the course marked complete).
  const fieldCourses = cert.courses.filter((c) => c.courseType === "field_signoff");
  for (const fc of fieldCourses) {
    const approved = await prisma.fieldSignoff.findFirst({ where: { employeeId, courseId: fc.id, approved: true } });
    if (!approved) return []; // sign-off not yet approved → do not award
  }

  await prisma.certAward.create({
    data: {
      employeeId,
      certificationId,
      awardedAt: new Date(),
      approvedByName: by.approvedByName,
      approvedByUserId: by.approvedByUserId,
    },
  });
  return [cert.code];
}

/** Approve a field sign-off, then re-check that group's cert award. */
export async function approveFieldSignoff(
  prisma: PrismaClient,
  args: { signoffId: string; approvedByName?: string | null; approvedByUserId?: string | null },
): Promise<{ awarded: string[] }> {
  const so = await prisma.fieldSignoff.update({
    where: { id: args.signoffId },
    data: { approved: true, approvedAt: new Date(), approvedByName: args.approvedByName ?? null, approvedByUserId: args.approvedByUserId ?? null },
  });
  // Completing the field-sign-off course counts as completing it.
  if (so.courseId) {
    const course = await prisma.certCourse.findUnique({ where: { id: so.courseId } });
    if (course) {
      await prisma.courseProgress.upsert({
        where: { employeeId_courseId: { employeeId: so.employeeId, courseId: course.id } },
        update: { status: "complete", completedDate: so.date },
        create: { employeeId: so.employeeId, courseId: course.id, status: "complete", completedDate: so.date },
      });
    }
  }
  const certId = so.certificationId;
  let awarded: string[] = [];
  if (certId) {
    awarded = await checkCertAward(prisma, so.employeeId, certId, {
      approvedByName: args.approvedByName ?? null,
      approvedByUserId: args.approvedByUserId ?? null,
    });
  }
  await maybeCompleteAssignments(prisma, so.employeeId);
  return { awarded };
}

/** Mark any active module assignment complete once all its snapshot courses are done. */
async function maybeCompleteAssignments(prisma: PrismaClient, employeeId: string): Promise<void> {
  const active = await prisma.moduleAssignment.findMany({ where: { employeeId, status: "active", moduleId: { not: null } } });
  for (const a of active) {
    const codes: string[] = a.courseCodesSnapshot ? JSON.parse(a.courseCodesSnapshot) : [];
    if (codes.length === 0) continue;
    const courses = await prisma.certCourse.findMany({ where: { code: { in: codes } }, select: { id: true } });
    const done = await prisma.courseProgress.count({
      where: { employeeId, courseId: { in: courses.map((c) => c.id) }, status: { in: ["complete", "credited"] } },
    });
    if (done >= codes.length) {
      await prisma.moduleAssignment.update({ where: { id: a.id }, data: { status: "complete", completedAt: new Date() } });
    }
  }
}
