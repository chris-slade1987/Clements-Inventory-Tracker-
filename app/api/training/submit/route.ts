import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseQuestions, gradeQuiz } from "@/lib/training";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

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

    // Completion receipt — lesson recap + the correct answers.
    let emailStatus: string | null = null;
    if (passed) {
      const emp = assignment.employee;
      const answerLines = questions
        .map((q, i) => `${i + 1}. ${q.prompt}\n   Correct answer: ${q.options[q.correctIndex]}${answers[String(i)] === q.correctIndex ? " ✓" : ` (you chose: ${q.options[answers[String(i)]] ?? "—"})`}`)
        .join("\n\n");
      const answerHtml = questions
        .map((q, i) => `<li><strong>${q.prompt}</strong><br/>Correct: <span style="color:#047857">${q.options[q.correctIndex]}</span>${answers[String(i)] === q.correctIndex ? " ✓" : ` — you chose: ${q.options[answers[String(i)]] ?? "—"}`}</li>`)
        .join("");
      const res = await sendEmail({
        to: emp.email,
        subject: `Completed: ${assignment.course.title} — ${pct}%`,
        kind: "training_completed",
        relatedType: "training_assignment",
        relatedId: id,
        text: `Hi ${emp.name.split(" ")[0]},\n\nYou completed "${assignment.course.title}" with a score of ${pct}% (${correct}/${total}).\n\nAnswer key:\n\n${answerLines}\n\nThis is filed to your personnel record.\n\n— CanopyOS`,
        html: `<p>Hi ${emp.name.split(" ")[0]},</p><p>You completed <strong>${assignment.course.title}</strong> with a score of <strong>${pct}%</strong> (${correct}/${total}).</p><p><strong>Answer key:</strong></p><ol>${answerHtml}</ol><p>This is filed to your personnel record.</p><p>— CanopyOS</p>`,
      });
      emailStatus = res.status;
    }

    return NextResponse.json({ ok: true, score: pct, correct, total, passed, passingScore: assignment.course.passingScore, status: saved.status, emailStatus });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
