import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { listCourseLibrary, programSummary, canViewCertifications } from "@/lib/certifications";
import { moduleStatsList } from "@/lib/training-center";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";
import ReseedCatalogButton from "./ReseedCatalogButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certifications — CanopyOS" };

function pct(n: number | null) {
  return n == null ? "—" : `${n}%`;
}

// Certifications tab — the MODULES people earn their certifications through, each
// with live completion + pass-rate stats and a drill-in (courses + who's assigned).
// The course launch library sits below for quick opening.
export default async function CertificationsIndexPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  let modules: Awaited<ReturnType<typeof moduleStatsList>> = [];
  let summary: Awaited<ReturnType<typeof programSummary>> = { certifications: 0, programs: 0, modules: 0, courses: 0, exists: 0, partial: 0, none: 0 } as Awaited<ReturnType<typeof programSummary>>;
  let library: Awaited<ReturnType<typeof listCourseLibrary>> = [];
  let loadError = false;
  try {
    [modules, summary, library] = await Promise.all([moduleStatsList(), programSummary(), listCourseLibrary()]);
  } catch (e) {
    loadError = true;
    console.error("certifications page load failed:", e);
  }
  const withContent = library.map((c) => ({ ...c, courses: c.courses.filter((m) => m.contentUrl) })).filter((c) => c.courses.length > 0);
  const totalBuilt = withContent.reduce((s, c) => s + c.courses.length, 0);

  return (
    <>
      <TrainingCenterTabs showCourses={user.role === "admin"} />
      <PageHeader
        title="Certifications"
        subtitle="The modules people complete to earn each certification — with live completion and pass-rate stats. Click a module to see its courses and who's completed them."
        actions={
          <Link
            href="/management/certifications/pathways"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] transition-colors"
          >
            Programs &amp; modules
          </Link>
        }
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.modules}</span>
            <span className="ml-1.5 text-muted">modules</span>
          </div>
          <div>
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.certifications}</span>
            <span className="ml-1.5 text-muted">certifications</span>
          </div>
          <div>
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.courses}</span>
            <span className="ml-1.5 text-muted">courses</span>
          </div>
        </div>
        {(loadError || modules.length === 0) && user.role === "admin" ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-sm text-amber-700">
              {loadError ? "The certification catalog couldn't be read in this environment." : "No certification catalog is loaded in this environment yet."}
            </p>
            <ReseedCatalogButton />
          </div>
        ) : null}
      </Card>

      {/* Modules — the primary structure, with stats + drill-in */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Modules</h2>
      {modules.length > 0 ? (
        <Card className="mb-6 p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Module</th>
                  <th className="px-3 py-2 font-medium">Earns</th>
                  <th className="px-3 py-2 font-medium text-right">Courses</th>
                  <th className="px-3 py-2 font-medium text-right">Assigned</th>
                  <th className="px-3 py-2 font-medium text-right">Completed</th>
                  <th className="px-3 py-2 font-medium text-right">Completion</th>
                  <th className="px-4 py-2 font-medium text-right">Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.code} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="px-4 py-2">
                      <Link href={`/management/certifications/modules/${m.code}`} className="inline-flex items-center gap-2">
                        <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{m.code}</span>
                        <span className="font-medium text-brand-700 hover:underline">{m.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{m.certificationsEarned ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.courseCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.assignedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.completedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{pct(m.completionPct)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-sky-700">{pct(m.passRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="mb-6 p-6 text-center text-sm text-muted">No modules loaded yet.</Card>
      )}

      {/* Course launch library — quick open of any built course */}
      {totalBuilt > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-ink">Course library · {totalBuilt} built course{totalBuilt === 1 ? "" : "s"} ready to open</h2>
          <div className="space-y-4">
            {withContent.map((c) => (
              <Card key={c.code} className="p-0 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{c.code}</span>
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  <span className="ml-auto text-[11px] text-muted">{c.courses.length} course{c.courses.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="divide-y divide-line">
                  {c.courses.map((m) => (
                    <li key={m.code} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-semibold text-ink">{m.code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.name}</span>
                      <a href={m.contentUrl!} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-grad px-3 py-1.5 text-[11px] font-semibold text-white hover:brightness-95">
                        Open
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6" /></svg>
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
