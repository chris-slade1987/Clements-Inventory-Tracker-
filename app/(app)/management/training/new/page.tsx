import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import CourseForm from "./CourseForm";

export const dynamic = "force-dynamic";

export default async function NewCoursePage() {
  await requireAdmin();
  return (
    <>
      <div className="mb-2"><Link href="/management/training" className="text-xs font-medium text-brand-700 hover:underline">← Training</Link></div>
      <PageHeader title="New Course" subtitle="Upload the lesson and build a quiz" />
      <CourseForm />
    </>
  );
}
