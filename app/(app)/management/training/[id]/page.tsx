import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import { parseQuestions, STATUS_LABEL } from "@/lib/training";
import { listEmployees } from "@/lib/people";
import AssignClient from "./AssignClient";

export const dynamic = "force-dynamic";

function statusChip(s: string) {
  const c = s === "completed" ? "bg-emerald-100 text-emerald-700" : s === "in_progress" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600";
  return `rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`;
}

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    include: { assignments: { include: { employee: { select: { name: true, branch: true } } }, orderBy: { assignedAt: "desc" } } },
  });
  if (!course) notFound();
  const questions = parseQuestions(course.questions);
  const employees = (await listEmployees()).map((e) => ({ id: e.id, name: e.name, branch: e.branch }));
  const assignedIds = new Set(course.assignments.map((a) => a.employeeId));

  return (
    <>
      <div className="mb-2"><Link href="/management/training" className="text-xs font-medium text-brand-700 hover:underline">← Training</Link></div>
      <PageHeader title={course.title} subtitle={`${course.category === "onboarding" ? "Onboarding" : "CEU"} · ${questions.length} questions · pass ${course.passingScore}%`} />

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-1">Lesson</div>
          {course.description ? <p className="text-sm text-muted whitespace-pre-line">{course.description}</p> : <p className="text-sm text-muted">No summary.</p>}
          {course.materialFile ? <a href={course.materialFile} target="_blank" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">📎 {course.materialName ?? "Lesson material"}</a> : null}
        </Card>
        <AssignClient courseId={course.id} employees={employees} assignedIds={[...assignedIds]} />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Assigned ({course.assignments.length})</div>
        {course.assignments.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Not assigned to anyone yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Assigned</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                  <th className="px-4 py-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {course.assignments.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{a.employee.name}</td>
                    <td className="px-3 py-2 text-muted">{a.employee.branch ? branchLabel(a.employee.branch) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{dateShort(a.assignedAt)}</td>
                    <td className="px-3 py-2 text-muted">{a.dueDate ? dateShort(a.dueDate) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.score != null ? `${a.score}%` : "—"}</td>
                    <td className="px-4 py-2 text-center"><span className={statusChip(a.status)}>{STATUS_LABEL[a.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
