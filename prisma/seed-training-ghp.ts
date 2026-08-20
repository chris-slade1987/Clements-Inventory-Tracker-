import type { PrismaClient } from "@prisma/client";
import { GHP_COURSE_TITLE, GHP_COURSE_BODY, GHP_QUESTIONS, GHP_PASSING_SCORE } from "../lib/ghp-course";

// Seeds the August 2026 GHP CEU — "Roach Identification — The Clements Way" — a
// fully built-out lesson (rich Markdown body + the packet photos under
// public/training/ghp-august/photos) plus its 20-question assessment.
//
// Content comes from lib/ghp-course.ts (embedded in code, no file read) so this
// runs identically in the build seed and in the runtime admin re-seed endpoint.
//
// Idempotent by title: CREATE when missing; self-heal a stale/placeholder body
// (one without the photo paths) to the photo version even if it was
// content-locked by a portal edit; leave a locked course that already has the
// photos untouched. Assignments go to every active technician who lacks one.

const DUE = new Date(Date.UTC(2026, 7, 31)); // Aug 31 2026
const PHOTO_MARKER = "/training/ghp-august/photos/";

export async function seedTrainingGhp(prisma: PrismaClient) {
  const body = GHP_COURSE_BODY;
  const questions = JSON.stringify(GHP_QUESTIONS);

  const existing = await prisma.course.findFirst({ where: { title: GHP_COURSE_TITLE } });
  const storedHasPhotos = existing?.description?.includes(PHOTO_MARKER) ?? false;
  let contentRefreshed = true;
  const course = existing
    ? existing.contentLocked && storedHasPhotos
      ? ((contentRefreshed = false), existing)
      : await prisma.course.update({
          where: { id: existing.id },
          data: { category: "ceu", description: body, questions, passingScore: GHP_PASSING_SCORE, active: true, contentLocked: false },
        })
    : await prisma.course.create({
        data: { title: GHP_COURSE_TITLE, category: "ceu", description: body, questions, passingScore: GHP_PASSING_SCORE, active: true },
      });

  // Assign to every active technician who doesn't already have this course.
  const techs = await prisma.employee.findMany({
    where: { status: "active", role: { contains: "Technician" } },
    select: { id: true, branch: true },
  });
  let assigned = 0;
  for (const t of techs) {
    const has = await prisma.trainingAssignment.findFirst({ where: { courseId: course.id, employeeId: t.id } });
    if (has) continue;
    await prisma.trainingAssignment.create({
      data: { courseId: course.id, employeeId: t.id, branch: t.branch, dueDate: DUE, notifiedAt: new Date() },
    });
    assigned++;
  }

  return {
    courseId: course.id,
    created: existing ? 0 : 1,
    refreshed: existing && contentRefreshed ? 1 : 0,
    locked: existing ? !contentRefreshed : false,
    questions: GHP_QUESTIONS.length,
    bodyChars: body.length,
    technicians: techs.length,
    assigned,
  };
}

// Standalone sanity run: `tsx prisma/seed-training-ghp.ts`
if (process.argv[1] && process.argv[1].includes("seed-training-ghp")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedTrainingGhp(prisma);
      console.log("seed-training-ghp:", JSON.stringify(r));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
