import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { listCertifications, listCourseLibrary, programSummary, canViewCertifications } from "@/lib/certifications";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certifications — CanopyOS" };

export default async function CertificationsIndexPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  const [certs, summary, library] = await Promise.all([listCertifications(), programSummary(), listCourseLibrary()]);
  const withContent = library.map((c) => ({ ...c, courses: c.courses.filter((m) => m.contentUrl) })).filter((c) => c.courses.length > 0);
  const totalBuilt = withContent.reduce((s, c) => s + c.courses.length, 0);

  return (
    <>
      <TrainingCenterTabs showCourses={user.role === "admin"} />
      <PageHeader
        title="Certifications"
        subtitle="The certification groups and their course catalog. A certification is awarded when every course in its group — including the field sign-off — is complete and approved."
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
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.certifications}</span>
            <span className="ml-1.5 text-muted">certifications</span>
          </div>
          <div>
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.courses}</span>
            <span className="ml-1.5 text-muted">courses</span>
          </div>
          <div className="text-muted">
            <span className="font-medium text-emerald-700 tabular-nums">{summary.exists}</span> exist ·{" "}
            <span className="font-medium text-amber-700 tabular-nums">{summary.partial}</span> partial ·{" "}
            <span className="font-medium text-slate-600 tabular-nums">{summary.none}</span> none
          </div>
        </div>
      </Card>

      {/* Built course library — every course with a hosted page, openable here. */}
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

      <h2 className="mb-2 text-sm font-semibold text-ink">All certification groups</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {certs.map((c) => (
          <Link key={c.code} href={`/management/certifications/${c.code}`} className="block">
            <Card className="p-4 h-full hover:bg-black/[0.02]">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{c.code}</span>
                  <span className="font-medium text-ink">{c.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{c.courseCount} courses</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                {c.isServiceCert ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800">service cert</span>
                ) : null}
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">{c.statusCounts.exists} ready</span>
                {c.statusCounts.partial > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{c.statusCounts.partial} partial</span>
                ) : null}
                {c.statusCounts.none > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{c.statusCounts.none} none</span>
                ) : null}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
