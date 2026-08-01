import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseQuestions, parseAnswers } from "@/lib/training";
import TakeAssignment from "./TakeAssignment";

export const dynamic = "force-dynamic";

export default async function TakePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const a = await prisma.trainingAssignment.findUnique({ where: { id }, include: { course: true } });
  if (!a) notFound();
  if (user.role !== "admin" && a.employeeId !== user.employeeId) redirect("/me");

  const questions = parseQuestions(a.course.questions);
  const savedAnswers = parseAnswers(a.answers);
  const completed = a.status === "completed";

  return (
    <>
      <div className="mb-2"><Link href="/me" className="text-xs font-medium text-brand-700 hover:underline">← My Work</Link></div>
      <PageHeader title={a.course.title} subtitle={`${a.course.category === "onboarding" ? "Onboarding" : "CEU"}${completed ? ` · completed ${a.score}%` : ` · pass ${a.course.passingScore}%`}`} />
      <TakeAssignment
        id={a.id}
        completed={completed}
        passingScore={a.course.passingScore}
        description={a.course.description}
        materialFile={a.course.materialFile}
        materialName={a.course.materialName}
        questions={questions}
        savedAnswers={savedAnswers}
        savedScore={a.score}
      />
    </>
  );
}
