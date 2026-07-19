import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts, listJobs, JOB_STATUS_LABELS } from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import NewJob from "./NewJob";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-amber-100 text-amber-700",
  filled: "bg-brand-100 text-brand-700",
  closed: "bg-slate-100 text-slate-600",
};

export default async function JobsPage() {
  const user = await requireUser();
  if (!canManageAts(user)) redirect(homePath(user));

  const jobs = await listJobs();
  const openCount = jobs.filter((j) => j.status === "open").length;

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-300 hover:underline">← People / HR</Link>
      </div>
      <PageHeader
        title="Hiring / Jobs"
        subtitle="Post jobs, track candidates through the pipeline, and interview to offer"
        actions={<NewJob />}
      />

      {jobs.length === 0 ? (
        <EmptyState title="No jobs yet" hint="Create a job posting to start collecting and tracking candidates." />
      ) : (
        <>
          {openCount > 0 ? (
            <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
              {openCount} open {openCount === 1 ? "position" : "positions"}.
            </div>
          ) : null}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Job</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Openings</th>
                    <th className="px-3 py-2 font-medium text-right">Candidates</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/management/people/jobs/${j.id}`} className="text-brand-700 hover:underline">{j.title}</Link>
                        {j.hiringManagerName ? <div className="text-xs text-muted">Hiring mgr: {j.hiringManagerName}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-muted">{j.branch ? branchLabel(j.branch) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{j.openings}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{j._count.candidates}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{dateShort(j.createdAt)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[j.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {JOB_STATUS_LABELS[j.status] ?? j.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
