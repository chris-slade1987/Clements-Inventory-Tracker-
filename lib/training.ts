import { prisma } from "@/lib/prisma";

// Training / LMS helpers. Courses carry a quiz (JSON); assignments track each
// employee's progress and grade.

export type Question = { prompt: string; options: string[]; correctIndex: number };

export function parseQuestions(s: string | null | undefined): Question[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((q) => ({
        prompt: String(q?.prompt ?? "").trim(),
        options: Array.isArray(q?.options) ? q.options.map((o: unknown) => String(o)) : [],
        correctIndex: Number.isFinite(Number(q?.correctIndex)) ? Number(q.correctIndex) : 0,
      }))
      .filter((q) => q.prompt && q.options.length >= 2);
  } catch {
    return [];
  }
}

export function parseAnswers(s: string | null | undefined): Record<string, number> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Grade a quiz submission. answers keyed by question index -> chosen option index. */
export function gradeQuiz(questions: Question[], answers: Record<string, number>) {
  const total = questions.length;
  let correct = 0;
  for (let i = 0; i < total; i++) if (answers[String(i)] === questions[i].correctIndex) correct++;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 100;
  return { correct, total, pct };
}

export const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

export async function listCourses(activeOnly = false) {
  const courses = await prisma.course.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { assignments: true } } },
  });
  return courses.map((c) => ({ ...c, questionCount: parseQuestions(c.questions).length }));
}

export async function courseDetail(id: string) {
  return prisma.course.findUnique({ where: { id } });
}

/** All assignments for an employee (their "My Work" training + library). */
export async function employeeAssignments(employeeId: string) {
  return prisma.trainingAssignment.findMany({
    where: { employeeId },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { assignedAt: "desc" }],
    include: { course: { select: { id: true, title: true, category: true, description: true, materialFile: true, materialName: true, questions: true, passingScore: true } } },
  });
}

export async function assignmentDetail(id: string) {
  return prisma.trainingAssignment.findUnique({
    where: { id },
    include: { course: true, employee: true },
  });
}

/** Per-branch training rollup for a period: each employee's status per course. */
export async function branchTrainingStatus(branch?: string) {
  const assignments = await prisma.trainingAssignment.findMany({
    where: branch ? { branch } : undefined,
    include: {
      course: { select: { title: true } },
      employee: { select: { name: true, branch: true } },
    },
    orderBy: [{ assignedAt: "desc" }],
  });
  const counts = {
    total: assignments.length,
    completed: assignments.filter((a) => a.status === "completed").length,
    inProgress: assignments.filter((a) => a.status === "in_progress").length,
    notStarted: assignments.filter((a) => a.status === "not_started").length,
  };
  return { assignments, counts };
}

/** Quarterly training completion for the scorecard's CEU compliance metric. */
export async function quarterTrainingCompliance(year: number, quarter: number, branch: string) {
  const months: Record<number, number[]> = { 1: [0, 1, 2], 2: [3, 4, 5], 3: [6, 7, 8], 4: [9, 10, 11] };
  const qMonths = months[quarter] ?? [];
  const start = new Date(Date.UTC(year, qMonths[0], 1));
  const end = new Date(Date.UTC(year, qMonths[qMonths.length - 1] + 1, 1));
  const assignments = await prisma.trainingAssignment.findMany({
    where: { branch, assignedAt: { gte: start, lt: end } },
    select: { status: true },
  });
  const total = assignments.length;
  const completed = assignments.filter((a) => a.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
  return { total, completed, pct, complete: total > 0 && completed === total };
}
