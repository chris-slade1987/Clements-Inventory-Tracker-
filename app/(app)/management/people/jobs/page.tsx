import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState, btn } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts, listJobs, getScreeningBookingUrl, excludedCandidates, JOB_STATUS_LABELS } from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import NewJob from "./NewJob";
import ScreeningLink from "./ScreeningLink";

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
  const active = jobs.filter((j) => j.status === "open" || j.status === "on_hold");
  const archive = jobs.filter((j) => j.status === "filled" || j.status === "closed");
  const openCount = jobs.filter((j) => j.status === "open").length;
  const bookingUrl = await getScreeningBookingUrl();
  const excludedCount = (await excludedCandidates()).length;

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-700 hover:underline">← People / HR</Link>
      </div>
      <PageHeader
        title="Hiring / Jobs"
        subtitle="Post jobs, track candidates through the pipeline, and interview to offer"
        actions={
          <div className="flex gap-2">
            <Link href="/management/people/hiring-templates" className={btn.secondary}>Template Library</Link>
            <NewJob />
          </div>
        }
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <ScreeningLink initialUrl={bookingUrl} />
        <Link href="/management/people/excluded" className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-red-50 text-red-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M5 8h14l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8zM9 8V5a2 2 0 012-2h2a2 2 0 012 2v3" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">Excluded archive</span>
            <span className="block text-xs text-muted">Every excluded candidate — reason, stage cut at, keep-warm — retained and reactivatable</span>
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{excludedCount}</span>
          <span className="text-muted text-sm">→</span>
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState title="No jobs yet" hint="Create a job posting to start collecting and tracking candidates." />
      ) : (
        <>
          {openCount > 0 ? (
            <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
              {openCount} open {openCount === 1 ? "position" : "positions"}.
            </div>
          ) : null}

          <h2 className="text-sm font-semibold text-ink mb-2">Active</h2>
          {active.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted mb-6">No active jobs. Create one to start hiring.</Card>
          ) : (
            <div className="mb-6"><JobTable jobs={active} /></div>
          )}

          {archive.length > 0 ? (
            <>
              <h2 className="text-sm font-semibold text-ink mb-2">Filled / closed (archive)</h2>
              <p className="text-xs text-muted mb-2">Completed hiring, saved down for HR.</p>
              <JobTable jobs={archive} showHired />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

function JobTable({ jobs, showHired = false }: { jobs: JobRow[]; showHired?: boolean }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="px-4 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Branch</th>
              {showHired ? <th className="px-3 py-2 font-medium">Hired</th> : null}
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
                {showHired ? <td className="px-3 py-2 text-ink">{j.hiredName ?? <span className="text-muted">No hire</span>}</td> : null}
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
  );
}
