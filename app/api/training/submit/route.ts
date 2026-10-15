import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseQuestions, gradeQuiz } from "@/lib/training";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  const action = body?.action ?? "submit";
  if (!id) return NextResponse.json({ error: "Missing assignment." }, { status: 400 });

  const assignment = await prisma.trainingAssignment.findUnique({ where: { id }, include: { course: true, employee: true } });
  if (!assignment) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Employees may only act on their own assignments; admins can act on any.
  if (user.role !== "admin" && assignment.employeeId !== user.employeeId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    if (action === "start") {
      if (assignment.status === "not_started")
        await prisma.trainingAssignment.update({ where: { id }, data: { status: "in_progress", startedAt: new Date() } });
      return NextResponse.json({ ok: true });
    }

    // submit
    const questions = parseQuestions(assignment.course.questions);
    const answers: Record<string, number> = (body?.answers ?? {}) as Record<string, number>;
    const { correct, total, pct } = gradeQuiz(questions, answers);
    const passed = pct >= assignment.course.passingScore;

    const saved = await prisma.trainingAssignment.update({
      where: { id },
      data: {
        answers: JSON.stringify(answers),
        score: pct,
        passed,
        attempts: assignment.attempts + 1,
        status: passed ? "completed" : "in_progress",
        startedAt: assignment.startedAt ?? new Date(),
        completedAt: passed ? new Date() : assignment.completedAt,
      },
    });

    // No completion self-receipt email — the employee just saw their score on
    // screen, and the completion is filed to their personnel record either way.
    return NextResponse.json({ ok: true, score: pct, correct, total, passed, passingScore: assignment.course.passingScore, status: saved.status, emailStatus: null });
  } catch (e) {
    return fail(e);
  }
}
