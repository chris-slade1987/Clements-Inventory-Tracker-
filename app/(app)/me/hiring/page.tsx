import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { involvedJobsForUser, hiringResultsForUser, INTERVIEW_STATUS_LABELS, JOB_STATUS_LABELS } from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-amber-100 text-amber-700",
  filled: "bg-brand-100 text-brand-700",
  closed: "bg-slate-100 text-slate-600",
};

export default async function MyHiringPage() {
  const user = await requireUser();
  const [involved, results] = await Promise.all([
    involvedJobsForUser(user.id),
    hiringResultsForUser(user.id),
  ]);

  return (
    <>
      <div className="mb-2">
        <Link href="/me" className="text-xs font-medium text-brand-300 hover:underline">← My Work</Link>
      </div>
      <PageHeader title="My Hiring" subtitle="Jobs you're interviewing for and their outcomes" />

      {involved.length === 0 && results.length === 0 ? (
        <EmptyState title="No hiring involvement" hint="When HR assigns you an interview, the job shows up here with access to its candidates and scorecards." />
      ) : null}

      {involved.length > 0 ? (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-ink mb-2">Active jobs</h2>
          <div className="space-y-3">
            {involved.map(({ job, myInterviews }) => (
              <Card key={job.id} className="p-0 overflow-hidden">
                <Link href={`/management/people/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] border-b border-line">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink truncate">{job.title}</span>
                    <span className="block text-xs text-muted">{job.branch ? branchLabel(job.branch) : "All branches"}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[job.status] ?? "bg-slate-100 text-slate-600"}`}>{JOB_STATUS_LABELS[job.status] ?? job.status}</span>
                  <span className="shrink-0 text-xs font-medium text-brand-700">Open →</span>
                </Link>
                <ul className="divide-y divide-line">
                  {myInterviews.map((iv) => (
                    <li key={iv.id}>
                      <Link href={`/me/interviews/${iv.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.02]">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${iv.status === "completed" ? "bg-emerald-500" : iv.status === "cancelled" ? "bg-slate-400" : "bg-amber-500"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink truncate">{iv.candidateName}</span>
                          <span className="block text-xs text-muted">
                            {INTERVIEW_STATUS_LABELS[iv.status] ?? iv.status}
                            {iv.scheduledAt ? ` · ${iv.scheduledAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-brand-700">{iv.status === "completed" ? "View →" : "Score →"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-ink mb-2">Hiring results</h2>
          <p className="text-xs text-muted mb-2">These searches are closed — your access to the job has ended.</p>
          <div className="space-y-2">
            {results.map((r) => (
              <Card key={r.jobId} className="p-4 flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.jobTitle}</div>
                  <div className="text-xs text-muted">
                    {r.hiredName ? `${r.hiredName} was hired` : "Closed without a hire"} · notified {dateShort(r.notifiedAt)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
