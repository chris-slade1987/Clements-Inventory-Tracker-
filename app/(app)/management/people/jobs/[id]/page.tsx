import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts, canAccessJob, jobDetail, applyUrl, STAGE_ORDER, STAGE_LABELS, JOB_STATUS_LABELS } from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import NewCandidate from "./NewCandidate";
import JobLifecycle from "./JobLifecycle";
import ApplyLinks from "./ApplyLinks";

export const dynamic = "force-dynamic";

const STAGE_STYLE: Record<string, string> = {
  applied: "bg-slate-100 text-slate-600",
  screening: "bg-sky-100 text-sky-700",
  interviewing: "bg-amber-100 text-amber-700",
  offer: "bg-violet-100 text-violet-700",
  onboarding: "bg-brand-100 text-brand-700",
  hired: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await canAccessJob(user, id))) redirect(homePath(user));
  const canManage = canManageAts(user);

  const job = await jobDetail(id);
  if (!job) notFound();

  const hiredName = job.hiredCandidateId ? job.candidates.find((c) => c.id === job.hiredCandidateId)?.name ?? null : null;

  const byStage = new Map<string, typeof job.candidates>();
  for (const s of STAGE_ORDER) byStage.set(s, []);
  for (const c of job.candidates) {
    const list = byStage.get(c.stage) ?? [];
    list.push(c);
    byStage.set(c.stage, list);
  }

  return (
    <>
      <div className="mb-2">
        <Link href={canManage ? "/management/people/jobs" : "/me/hiring"} className="text-xs font-medium text-brand-300 hover:underline">← {canManage ? "Hiring / Jobs" : "My Hiring"}</Link>
      </div>
      <PageHeader
        title={job.title}
        subtitle={[job.branch ? branchLabel(job.branch) : null, `${job.openings} opening${job.openings === 1 ? "" : "s"}`, job.hiringManagerName ? `Hiring mgr: ${job.hiringManagerName}` : null].filter(Boolean).join(" · ")}
        actions={canManage ? <NewCandidate jobId={job.id} /> : null}
      />

      {canManage ? (
        <div className="mb-5">
          <JobLifecycle
            id={job.id}
            status={job.status}
            candidates={job.candidates.map((c) => ({ id: c.id, name: c.name, stage: c.stage }))}
            hiredName={hiredName}
          />
        </div>
      ) : (
        <Card className="p-4 mb-5 flex items-start gap-3 bg-brand-50 border-brand-100">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-600 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h4M16 11l2 2 4-4" /></svg>
          <div>
            <div className="text-sm font-medium text-brand-800">Interviewer access</div>
            <p className="text-xs text-brand-700">You have read-only access to this job because you&rsquo;re assigned an interview on it. You can view all candidates and scorecards; only HR can make changes.</p>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-5 flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted">Created {dateShort(job.createdAt)}{job.createdByName ? ` by ${job.createdByName}` : ""}</span>
        <span className="text-xs text-muted">{job.candidates.length} candidate{job.candidates.length === 1 ? "" : "s"} · {JOB_STATUS_LABELS[job.status] ?? job.status}</span>
      </Card>

      {canManage && job.status === "open" && job.applyToken ? (
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-300" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
            <span className="text-sm font-medium text-ink">Public application link</span>
          </div>
          <p className="text-xs text-muted mb-3">
            Applicants who apply through these links are auto-added to this job&rsquo;s pipeline (stage “Applied”), with their source tracked per channel.
            {" "}<Link href="/careers" className="font-medium text-brand-300 hover:underline">View the public careers page →</Link>
          </p>
          <ApplyLinks
            indeedUrl={applyUrl(job.applyToken, "indeed")}
            websiteUrl={applyUrl(job.applyToken, "website")}
          />
        </Card>
      ) : null}

      {job.description ? (
        <Card className="p-4 mb-5">
          <div className="text-sm font-medium text-ink mb-1">Description</div>
          <p className="text-sm text-muted whitespace-pre-line">{job.description}</p>
        </Card>
      ) : null}

      {job.candidates.length === 0 ? (
        <EmptyState title="No candidates yet" hint="Add a candidate to start moving them through the pipeline." />
      ) : (
        <div className="space-y-4">
          {STAGE_ORDER.map((stage) => {
            const list = byStage.get(stage) ?? [];
            if (list.length === 0) return null;
            return (
              <Card key={stage} className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_STYLE[stage]}`}>{STAGE_LABELS[stage]}</span>
                  <span className="text-xs text-muted">{list.length}</span>
                </div>
                <ul className="divide-y divide-line">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link href={`/management/people/candidates/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02]">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink truncate">{c.name}</span>
                          <span className="block text-xs text-muted truncate">{c.email}{c.phone ? ` · ${c.phone}` : ""}{c.source ? ` · ${c.source}` : ""}</span>
                        </span>
                        {c._count.interviews > 0 ? <span className="shrink-0 text-xs text-muted">{c._count.interviews} interview{c._count.interviews === 1 ? "" : "s"}</span> : null}
                        <span className="shrink-0 text-xs font-medium text-brand-700">Open →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
