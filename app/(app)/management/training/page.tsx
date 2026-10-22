import Link from "next/link";
import { Card, PageHeader, EmptyState, btn } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { dateShort } from "@/lib/format";
import { listCourses } from "@/lib/training";
import { listCourseLibrary } from "@/lib/certifications";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";
import SeedGhpButton from "./SeedGhpButton";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  Exists: "bg-emerald-100 text-emerald-700",
  Partial: "bg-amber-100 text-amber-700",
  None: "bg-slate-100 text-slate-600",
};

// Courses tab — the individual certification courses (assignable via modules on the
// Assign tab), each openable when a page is built. The legacy CEU / onboarding quiz
// courses stay below for the admin who manages them.
export default async function TrainingAdminPage() {
  await requireAdmin();
  const [library, courses] = await Promise.all([listCourseLibrary(), listCourses()]);
  const totalCourses = library.reduce((s, c) => s + c.courses.length, 0);
  const built = library.reduce((s, c) => s + c.courses.filter((m) => m.contentUrl).length, 0);

  return (
    <>
      <PageHeader title="Training Center" subtitle="Every individual course in the catalog. Courses are assigned to people as part of a module on the Assign tab." />
      <TrainingCenterTabs showCourses />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Courses" value={String(totalCourses)} />
        <Tile label="Built (openable)" value={String(built)} tone="good" />
        <Tile label="Certifications" value={String(library.length)} />
        <Tile label="CEU courses" value={String(courses.length)} />
      </div>

      {/* Individual certification courses, grouped by the certification they belong to */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Certification courses</h2>
      {totalCourses === 0 ? (
        <Card className="mb-6 p-6 text-center text-sm text-muted">No certification courses loaded yet.</Card>
      ) : (
        <div className="space-y-4 mb-8">
          {library.map((c) => (
            <Card key={c.code} className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{c.code}</span>
                <span className="text-sm font-medium text-ink">{c.name}</span>
                {c.isServiceCert ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">service cert</span> : null}
                <span className="ml-auto text-[11px] text-muted">{c.courses.length} course{c.courses.length === 1 ? "" : "s"}</span>
              </div>
              <ul className="divide-y divide-line">
                {c.courses.map((m) => (
                  <li key={m.code} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-semibold text-ink">{m.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.name}</span>
                    <span className="text-[11px] text-muted">{m.courseType === "field_signoff" ? "field sign-off" : m.courseType}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[m.contentStatus] ?? "bg-slate-100 text-slate-600"}`}>{m.contentStatus === "Exists" ? "built" : m.contentStatus.toLowerCase()}</span>
                    {m.contentUrl ? (
                      <a href={m.contentUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-grad px-3 py-1.5 text-[11px] font-semibold text-white hover:brightness-95">
                        Open
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6" /></svg>
                      </a>
                    ) : <span className="text-[11px] text-muted">not built</span>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* Legacy CEU / onboarding quiz courses (separate older system) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">CEU &amp; onboarding courses</h2>
        <div className="flex items-center gap-3">
          <Link href="/management/training/new" className={btn.secondary}>+ New CEU course</Link>
          <SeedGhpButton />
        </div>
      </div>
      {courses.length === 0 ? (
        <EmptyState title="No CEU courses yet" hint="These are the standalone monthly quiz courses — create one, then assign it." />
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
