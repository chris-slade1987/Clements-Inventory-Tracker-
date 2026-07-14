import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { employeeAssignments, STATUS_LABEL } from "@/lib/training";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requireUser();
  if (!user.employeeId) {
    return (
      <>
        <PageHeader title="Lesson Library" subtitle="Review your training anytime" />
        <EmptyState title="No profile linked" hint="This login isn't linked to an employee profile." />
      </>
    );
  }
  const assignments = await employeeAssignments(user.employeeId);

  return (
    <>
      <PageHeader title="Lesson Library" subtitle="Every lesson assigned to you — review anytime" />
      {assignments.length === 0 ? (
        <EmptyState title="No lessons yet" hint="Assigned courses will appear here." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-line">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link href={`/me/training/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{a.course.title}</span>
                    <span className="block text-xs text-muted capitalize">{a.course.category} · {STATUS_LABEL[a.status]}{a.status === "completed" && a.score != null ? ` · ${a.score}%` : ""}</span>
                  </span>
                  <span className="text-xs font-medium text-brand-700">{a.status === "completed" ? "Review" : a.status === "in_progress" ? "Resume" : "Start"} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
