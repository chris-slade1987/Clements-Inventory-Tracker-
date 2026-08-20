import Link from "next/link";
import { Card, PageHeader, EmptyState, btn } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { dateShort } from "@/lib/format";
import { listCourses, branchTrainingStatus } from "@/lib/training";
import SeedGhpButton from "./SeedGhpButton";

export const dynamic = "force-dynamic";

export default async function TrainingAdminPage() {
  await requireAdmin();
  const [courses, status] = await Promise.all([listCourses(), branchTrainingStatus()]);

  return (
    <>
      <PageHeader title="Training" subtitle="Create courses, assign monthly training, and track completion" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Courses" value={String(courses.length)} />
        <Tile label="Assignments" value={String(status.counts.total)} />
        <Tile label="Completed" value={String(status.counts.completed)} tone="good" />
        <Tile label="Outstanding" value={String(status.counts.notStarted + status.counts.inProgress)} tone={status.counts.notStarted + status.counts.inProgress ? "warn" : "good"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/management/training/new" className={btn.primary}>+ New course</Link>
        <SeedGhpButton />
      </div>

      {courses.length === 0 ? (
        <EmptyState title="No courses yet" hint="Create a course, then assign it to employees." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium text-right">Questions</th>
                  <th className="px-3 py-2 font-medium text-right">Pass</th>
                  <th className="px-3 py-2 font-medium text-right">Assigned</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium"><Link href={`/management/training/${c.id}`} className="text-brand-700 hover:underline">{c.title}</Link></td>
                    <td className="px-3 py-2 text-muted capitalize">{c.category}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{c.questionCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{c.passingScore}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c._count.assignments}</td>
                    <td className="px-3 py-2 text-muted">{dateShort(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}
