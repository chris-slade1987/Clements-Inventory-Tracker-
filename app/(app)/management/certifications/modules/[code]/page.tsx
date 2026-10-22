import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { getModuleReport } from "@/lib/training-center";
import { branchLabel } from "@/lib/management";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Module — CanopyOS" };

function pct(n: number | null) {
  return n == null ? "—" : `${n}%`;
}

// Module drill-in (Certifications tab): the module's ordered courses with per-course
// completion + pass rate, and the roster of everyone assigned it with their progress.
export default async function ModuleReportPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  if (!canViewCertifications(user)) redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  const { code } = await params;
  const m = await getModuleReport(code);
  if (!m) notFound();

  return (
    <>
      <TrainingCenterTabs showCourses={user.role === "admin"} />
      <div className="mb-2">
        <Link href="/management/certifications" className="text-xs font-medium text-brand-300 hover:underline">← Certifications</Link>
      </div>
      <PageHeader
        title={m.name}
        subtitle={[m.code, m.certificationsEarned ? `earns ${m.certificationsEarned}` : null, `${m.courseCount} course${m.courseCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
      />

      {/* Stat strip */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <div><div className="text-2xl font-semibold text-ink tabular-nums">{m.assignedCount}</div><div className="text-muted">assigned</div></div>
          <div><div className="text-2xl font-semibold text-ink tabular-nums">{m.completedCount}</div><div className="text-muted">completed</div></div>
          <div><div className="text-2xl font-semibold text-emerald-700 tabular-nums">{pct(m.completionPct)}</div><div className="text-muted">completion rate</div></div>
          <div><div className="text-2xl font-semibold text-sky-700 tabular-nums">{pct(m.passRate)}</div><div className="text-muted">pass rate</div></div>
        </div>
      </Card>

      {/* Courses in this module */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Courses in this module</h2>
      <Card className="mb-6 p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="px-4 py-2 font-medium">Course</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium text-right">Completed</th>
              <th className="px-3 py-2 font-medium text-right">Pass rate</th>
              <th className="px-4 py-2 font-medium text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {m.courses.map((c) => (
              <tr key={c.code} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-semibold text-ink mr-2">{c.code}</span>
                  {c.name}
                </td>
                <td className="px-3 py-2 text-muted">{c.courseType === "field_signoff" ? "field sign-off" : c.courseType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.completedCount}/{m.assignedCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(c.passRate)}</td>
                <td className="px-4 py-2 text-right">
                  {c.contentUrl ? (
                    <a href={c.contentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-emerald-grad px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-95">
                      Open
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6" /></svg>
                    </a>
                  ) : <span className="text-xs text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Who's assigned + their progress */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Who&rsquo;s assigned ({m.roster.length})</h2>
      {m.roster.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">No one is assigned this module yet. Assign it from the <Link href="/management/training-center/assign" className="text-brand-700 hover:underline">Assign</Link> tab.</Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Assigned</th>
                <th className="px-3 py-2 font-medium text-right">Progress</th>
                <th className="px-4 py-2 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {m.roster.map((r) => {
                const done = r.status !== "active";
                return (
                  <tr key={r.employeeId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/management/people/${r.employeeId}`} className="text-brand-700 hover:underline">{r.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{r.branch ? branchLabel(r.branch) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.assignedAt}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.completeCount}/{r.totalCount}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {done ? "Complete" : "In progress"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
