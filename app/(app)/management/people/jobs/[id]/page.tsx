import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import {
  canManageAts,
  canAccessJob,
  canOperateJob,
  jobDetail,
  applyUrl,
  interviewerCandidates,
  PIPELINE_STAGE_FLOW,
  STAGE_LABELS,
  JOB_STATUS_LABELS,
} from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import { listTemplates, resolveTemplateForJob } from "@/lib/hiring-templates";
import NewCandidate from "./NewCandidate";
import JobLifecycle from "./JobLifecycle";
import ApplyLinks from "./ApplyLinks";
import HiringControls from "./HiringControls";
import ReactivateButton from "./ReactivateButton";
import JobTemplates from "./JobTemplates";
import PipelineBar from "./PipelineBar";

export const dynamic = "force-dynamic";

const STAGE_STYLE: Record<string, string> = {
  applied: "bg-slate-100 text-slate-600",
  screening: "bg-sky-100 text-sky-700",
  interviewing: "bg-amber-100 text-amber-700",
  ranked: "bg-indigo-100 text-indigo-700",
  selected: "bg-emerald-100 text-emerald-700",
  pre_hire: "bg-brand-100 text-brand-700",
  offer: "bg-violet-100 text-violet-700",
  onboarding: "bg-brand-100 text-brand-700",
  hired: "bg-emerald-100 text-emerald-700",
  excluded: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

// Per-stage colored rail + the one concrete action that moves candidates
// forward from that stage. Surfaced on each stage card so HR/supervisors never
// have to guess "what now?". Purely presentational.
const STAGE_META: Record<string, { rail: string; next: string }> = {
  applied: { rail: "border-l-slate-300", next: "Review the résumé, then shortlist to Screening — or exclude with a reason." },
  screening: { rail: "border-l-sky-400", next: "Send the booking link, log the call notes, then advance to Interview." },
  interviewing: { rail: "border-l-amber-400", next: "The assigned supervisor logs the interview time and fills the questionnaire." },
  ranked: { rail: "border-l-indigo-400", next: "Pick your finalist before the 48-hour selection window closes." },
  selected: { rail: "border-l-emerald-400", next: "Reach out personally, then move them to Pre-hire to start paperwork." },
  pre_hire: { rail: "border-l-brand-400", next: "In pre-hire onboarding — track their documents through to completion." },
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await canAccessJob(user, id))) redirect(homePath(user));
  const canManage = canManageAts(user);
  const canOperate = await canOperateJob(user, id);

  const job = await jobDetail(id);
  if (!job) notFound();

  const hiredName = job.hiredCandidateId ? job.candidates.find((c) => c.id === job.hiredCandidateId)?.name ?? null : null;
  const supervisors = canManage ? await interviewerCandidates() : [];

  // Hiring template assignment (HR only): the pickable templates + what the job
  // currently resolves to on Auto (role-matched → default → legacy).
  const allTemplates = canManage ? await listTemplates() : [];
  const interviewTemplates = allTemplates.filter((t) => t.kind === "interview" && t.active).map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault }));
  const screeningTemplates = allTemplates.filter((t) => t.kind === "screening" && t.active).map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault }));
  const resolvedInterview = canManage ? await resolveTemplateForJob(job, "interview") : null;
  const resolvedScreening = canManage ? await resolveTemplateForJob(job, "screening") : null;

  // Group candidates by the canonical pipeline flow; everything excluded
  // (incl. legacy "rejected") lands in the retained Excluded archive section.
  const byStage = new Map<string, typeof job.candidates>();
  for (const s of PIPELINE_STAGE_FLOW) byStage.set(s, []);
  const excluded: typeof job.candidates = [];
  const legacy: typeof job.candidates = []; // offer/onboarding/hired that predate this flow
  for (const c of job.candidates) {
    if (c.stage === "excluded" || c.stage === "rejected") { excluded.push(c); continue; }
    if (byStage.has(c.stage)) { byStage.get(c.stage)!.push(c); continue; }
    legacy.push(c);
  }

  // Eligible-to-rank set (interviewed, not excluded) for the ranking control.
  const rankable = [...(byStage.get("interviewing") ?? []), ...(byStage.get("ranked") ?? [])]
    .sort((a, b) => (a.interviewRank ?? 99) - (b.interviewRank ?? 99))
    .map((c) => ({ id: c.id, name: c.name, rank: c.interviewRank ?? null, interviewAt: c.interviewAt ? c.interviewAt.toISOString() : null }));

  const stageCounts: Record<string, number> = {};
  for (const s of PIPELINE_STAGE_FLOW) stageCounts[s] = (byStage.get(s) ?? []).length;

  const now = Date.now();
  const overdue = job.interviewDeadline && job.interviewDeadline.getTime() < now &&
    (byStage.get("interviewing") ?? []).length > 0;
  const selectionOpen = (byStage.get("ranked") ?? []).length > 0 && job.selectionDeadline;

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

      {job.candidates.length > 0 ? <PipelineBar counts={stageCounts} excluded={excluded.length} /> : null}

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
            <div className="text-sm font-medium text-brand-800">Interviewing supervisor</div>
            <p className="text-xs text-brand-700">You&rsquo;re assigned to interview for this job. Log each interview time, complete the standardized questionnaire on each candidate, then submit your rankings below.</p>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-5 flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted">Created {dateShort(job.createdAt)}{job.createdByName ? ` by ${job.createdByName}` : ""}</span>
        <span className="text-xs text-muted">{job.candidates.length} candidate{job.candidates.length === 1 ? "" : "s"} · {JOB_STATUS_LABELS[job.status] ?? job.status}</span>
        {job.interviewSupervisorName ? <span className="text-xs text-muted">Interviewing supervisor: <span className="font-medium text-ink">{job.interviewSupervisorName}</span></span> : null}
        {job.interviewDeadline ? <span className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-muted"}`}>Interview by {dateShort(job.interviewDeadline)}{overdue ? " · OVERDUE" : ""}</span> : null}
        {selectionOpen ? <span className="text-xs font-medium text-indigo-700">Selection window: decide by {job.selectionDeadline!.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span> : null}
      </Card>

      {canManage ? (
        <JobTemplates
          jobId={job.id}
          interviewTemplates={interviewTemplates}
          screeningTemplates={screeningTemplates}
          currentInterviewId={job.interviewTemplateId}
          currentScreeningId={job.screeningTemplateId}
          resolvedInterviewName={resolvedInterview?.name ?? "General interview (default)"}
          resolvedScreeningName={resolvedScreening?.name ?? "None"}
        />
      ) : null}

      {/* Interview handoff + forced ranking controls */}
      <HiringControls
        jobId={job.id}
        canManage={canManage}
        canOperate={canOperate}
        supervisors={supervisors.map((s) => ({ id: s.id, name: s.name }))}
        currentSupervisorId={job.interviewSupervisorId}
        interviewDeadline={job.interviewDeadline ? job.interviewDeadline.toISOString() : null}
        rankable={rankable}
        hasRanked={(byStage.get("ranked") ?? []).length > 0}
      />

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
            linkedinUrl={applyUrl(job.applyToken, "linkedin")}
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
          {[...PIPELINE_STAGE_FLOW, ...(legacy.length ? ["offer", "onboarding", "hired"] : [])].map((stage) => {
            const list = stage === "offer" || stage === "onboarding" || stage === "hired"
              ? legacy.filter((c) => c.stage === stage)
              : (byStage.get(stage) ?? []);
            if (list.length === 0) return null;
            const sorted = stage === "ranked" ? [...list].sort((a, b) => (a.interviewRank ?? 99) - (b.interviewRank ?? 99)) : list;
            return (
              <Card key={stage} className={`p-0 overflow-hidden border-l-4 ${STAGE_META[stage]?.rail ?? "border-l-line"}`}>
                <div className="px-4 py-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_STYLE[stage]}`}>{STAGE_LABELS[stage]}</span>
                    <span className="text-xs text-muted">{list.length} candidate{list.length === 1 ? "" : "s"}</span>
                  </div>
                  {STAGE_META[stage] ? (
                    <p className="mt-1.5 text-xs text-muted"><span className="font-medium text-ink">To advance:</span> {STAGE_META[stage].next}</p>
                  ) : null}
                </div>
                <ul className="divide-y divide-line">
                  {sorted.map((c) => (
                    <li key={c.id}>
                      <Link href={`/management/people/candidates/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02]">
                        {stage === "ranked" && c.interviewRank ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">{c.interviewRank}</span> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink truncate">{c.name}</span>
                          <span className="block text-xs text-muted truncate">{c.email}{c.phone ? ` · ${c.phone}` : ""}{c.source ? ` · ${c.source}` : ""}</span>
                        </span>
                        {c.interviewAt ? <span className="shrink-0 text-xs text-muted">{c.interviewAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</span> : null}
                        {c._count.interviews > 0 ? <span className="shrink-0 text-xs text-muted">{c._count.interviews} interview{c._count.interviews === 1 ? "" : "s"}</span> : null}
                        <span className="shrink-0 text-xs font-medium text-brand-700">Open →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          {/* Retained Excluded archive (never deleted) */}
          {excluded.length > 0 ? (
            <Card className="p-0 overflow-hidden border-red-100 border-l-4 border-l-red-300">
              <div className="px-4 py-3 border-b border-line bg-red-50/40">
                <div className="flex items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-100 text-red-700">Excluded</span>
                  <span className="text-xs text-muted">{excluded.length} · retained archive</span>
                </div>
                <p className="mt-1.5 text-xs text-muted">Retained for the record — reactivate any candidate if a pick falls through.</p>
              </div>
              <ul className="divide-y divide-line">
                {excluded.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <Link href={`/management/people/candidates/${c.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block text-sm font-medium text-ink truncate">{c.name}
                        {c.keepWarm ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 align-middle">Keep warm</span> : null}
                      </span>
                      <span className="block text-xs text-muted truncate">
                        {c.excludedReason ?? "Excluded"}
                        {c.excludedStage ? ` · cut at ${STAGE_LABELS[c.excludedStage] ?? c.excludedStage}` : ""}
                        {c.excludedAt ? ` · ${dateShort(c.excludedAt)}` : ""}
                        {c.excludedByName ? ` · ${c.excludedByName}` : ""}
                      </span>
                    </Link>
                    {canManage ? <ReactivateButton candidateId={c.id} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
