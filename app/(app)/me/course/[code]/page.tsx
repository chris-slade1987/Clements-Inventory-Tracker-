import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CoursePlayer from "./CoursePlayer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Course — CanopyOS" };

// In-app course player: embeds the hosted course page and lets the employee record
// their own completion (which updates progress, auto-completes the module, and
// checks the certification award) with a clear confirmation afterward.
export default async function CoursePlayerPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  const { code } = await params;
  const courseCode = code.toUpperCase();

  const course = await prisma.certCourse.findUnique({
    where: { code: courseCode },
    select: { id: true, code: true, name: true, contentUrl: true, courseType: true, certification: { select: { code: true, name: true } } },
  });
  if (!course) notFound();

  let assigned = false;
  let alreadyComplete = false;
  if (user.employeeId) {
    const progress = await prisma.courseProgress.findUnique({
      where: { employeeId_courseId: { employeeId: user.employeeId, courseId: course.id } },
      select: { status: true },
    });
    assigned = !!progress;
    alreadyComplete = progress?.status === "complete" || progress?.status === "credited";
  }

  return (
    <>
      <div className="mb-2">
        <Link href="/me/training" className="text-xs font-medium text-brand-700 hover:underline">← My Training</Link>
      </div>
      <PageHeader
        title={course.name}
        subtitle={[course.code, `${course.certification.code} · ${course.certification.name}`].join(" · ")}
      />
      <CoursePlayer
        courseCode={course.code}
        courseName={course.name}
        contentUrl={course.contentUrl}
        assigned={assigned}
        alreadyComplete={alreadyComplete}
        isField={course.courseType === "field_signoff"}
      />
    </>
  );
}
