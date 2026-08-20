import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseQuestions } from "@/lib/training";
import CourseForm from "../../new/CourseForm";

export const dynamic = "force-dynamic";

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) notFound();

  const initial = {
    id: course.id,
    title: course.title,
    category: course.category,
    description: course.description ?? "",
    passingScore: course.passingScore,
    questions: parseQuestions(course.questions),
    materialName: course.materialName,
  };

  return (
    <>
      <div className="mb-2"><Link href={`/management/training/${course.id}`} className="text-xs font-medium text-brand-700 hover:underline">← {course.title}</Link></div>
      <PageHeader title="Edit course" subtitle="Changes save immediately and update the course for everyone it's assigned to. Completed attempts are kept." />
      <CourseForm initial={initial} />
    </>
  );
}
