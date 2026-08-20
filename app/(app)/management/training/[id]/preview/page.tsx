import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseQuestions } from "@/lib/training";
import TakeAssignment from "../../../../me/training/[id]/TakeAssignment";

export const dynamic = "force-dynamic";

// Admin preview of a course exactly as an assigned technician sees it — lesson
// + interactive quiz with grading — without needing an assignment and without
// writing anything (TakeAssignment runs in preview mode).
export default async function CoursePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) notFound();
  const questions = parseQuestions(course.questions);

  return (
    <>
      <div className="mb-2"><Link href={`/management/training/${course.id}`} className="text-xs font-medium text-brand-700 hover:underline">← {course.title}</Link></div>
      <PageHeader title={course.title} subtitle={`${course.category === "onboarding" ? "Onboarding" : "CEU"} · pass ${course.passingScore}%`} />
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        <strong>Preview mode.</strong> You're seeing this course exactly as a technician does. You can read the lesson and take the quiz — nothing is saved, emailed, or counted.
      </div>
      <TakeAssignment
        id={course.id}
        completed={false}
        passingScore={course.passingScore}
        description={course.description}
        materialFile={course.materialFile}
        materialName={course.materialName}
        questions={questions}
        savedAnswers={{}}
        savedScore={null}
        preview
        backHref={`/management/training/${course.id}`}
      />
    </>
  );
}
