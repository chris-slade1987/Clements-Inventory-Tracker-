import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import {
  canManageAts,
  canAccessCandidate,
  canOperateJob,
  candidateDetail,
  interviewerCandidates,
  getScreeningBookingUrl,
  exclusionReasonsForStage,
  isExcludedStage,
  PIPELINE_STAGE_FLOW,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_TYPE_LABELS,
  STAGE_LABELS,
  RECOMMENDATION_LABELS,
  RATING_SCALE,
  BASICS_LABELS,
  parseScorecard,
  type RecommendationKey,
} from "@/lib/ats";
import {
  interviewTemplateForCandidate,
  renderTemplateForResponses,
  resolveTemplateForJob,
} from "@/lib/hiring-templates";
import { parseJson } from "@/lib/inspection";
import { statusLabel as preHireStatusLabel } from "@/lib/prehire";
import { googleCalendarUrl, locationLine } from "@/lib/calendar";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import CandidateActions from "./CandidateActions";

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

function ratingLabel(v: number | null | undefined): string {
  const r = RATING_SCALE.find((x) => x.value === v);
  return r ? `${r.value} · ${r.label}` : "—";
}

export default async function CandidateHubPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await canAccessCandidate(user, id))) redirect(homePath(user));
  const canManage = canManageAts(user);

  const detail = await candidateDetail(id);
  if (!detail) notFound();
  const { candidate, preHire } = detail;
  const supervisor = !canManage && candidate.jobId ? await canOperateJob(user, candidate.jobId) : false;
  const interviewers = canManage ? await interviewerCandidates() : [];
  const bookingConfigured = canManage ? !!(await getScreeningBookingUrl()) : false;

  // The interview id this operator would fill a scorecard on: their own assigned
  // interview if they're the supervisor, else the newest non-cancelled one.
  const myInterview =
    (!canManage ? candidate.interviews.find((iv) => iv.interviewerId === user.id && iv.status !== "cancelled") : null) ??
    candidate.interviews.find((iv) => iv.status !== "cancelled") ??
    null;

  const excluded = isExcludedStage(candidate.stage);
  const reactivateStages = PIPELINE_STAGE_FLOW.filter((s) => s !== "pre_hire").map((s) => ({ value: s, label: STAGE_LABELS[s] ?? s }));

  // The job's assigned interview template (role/default fall back to the legacy
  // questionnaire) — used to render completed scorecards with the right labels.
  const resolvedInterviewTemplate = await interviewTemplateForCandidate(candidate.id);
  // The assigned HR-screening template (if any) the screening call renders.
  const screeningTpl = candidate.jobId
    ? await resolveTemplateForJob({ interviewTemplateId: null, screeningTemplateId: candidate.job?.screeningTemplateId ?? null, title: candidate.job?.title ?? null }, "screening")
    : null;
  const screeningTemplate = screeningTpl
    ? { id: screeningTpl.id, name: screeningTpl.name, questions: [...screeningTpl.questions].sort((a, b) => a.order - b.order).map((q) => ({ id: q.id, section: q.section, text: q.text, responseType: q.responseType })) }
    : null;
  const screeningResponses = parseJson<Record<string, string | number | null>>(candidate.screeningResponses, {});
  const actionData = {
    candidateId: candidate.id,
    jobId: candidate.jobId,
    stage: candidate.stage,
    role: (canManage ? "hr" : "supervisor") as "hr" | "supervisor",
    interviewers,
    exclusionReasons: exclusionReasonsForStage(candidate.stage),
    reactivateStages,
    screeningNotes: candidate.screeningNotes,
    screeningRequestedAt: candidate.screeningRequestedAt ? candidate.screeningRequestedAt.toISOString() : null,
    screeningCompletedAt: candidate.screeningCompletedAt ? candidate.screeningCompletedAt.toISOString() : null,
    interviewAt: candidate.interviewAt ? candidate.interviewAt.toISOString() : null,
    bookingConfigured,
    scorecardInterviewId: myInterview?.id ?? null,
    excludedReason: candidate.excludedReason,
    excludedStageLabel: candidate.excludedStage ? STAGE_LABELS[candidate.excludedStage] ?? candidate.excludedStage : null,
    keepWarm: candidate.keepWarm,
    screeningTemplate,
    screeningResponses,
  };

  return (
    <>
      <div className="mb-2">
        <Link href={candidate.job ? `/management/people/jobs/${candidate.job.id}` : "/management/people/jobs"} className="text-xs font-medium text-brand-700 hover:underline">
          ← {candidate.job ? candidate.job.title : "Hiring / Jobs"}
        </Link>
      </div>
      <PageHeader
        title={candidate.name}
        subtitle={[candidate.job?.title, candidate.job?.branch ? branchLabel(candidate.job.branch) : null].filter(Boolean).join(" · ") || "Candidate"}
        actions={<span className={`rounded-full px-3 py-1 text-xs font-medium ${STAGE_STYLE[candidate.stage] ?? "bg-slate-100 text-slate-600"}`}>{STAGE_LABELS[candidate.stage] ?? candidate.stage}</span>}
      />

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Contact</div>
          <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
            <Row label="Email" value={candidate.email} />
            <Row label="Phone" value={candidate.phone ?? "—"} />
            {candidate.addressStreet || candidate.addressCity ? (
              <Row label="Address" value={[candidate.addressStreet, [candidate.addressCity, candidate.addressState].filter(Boolean).join(", "), candidate.addressZip].filter(Boolean).join(" · ")} />
            ) : null}
            <Row label="Source" value={candidate.source ?? "—"} />
            <Row label="Job" value={candidate.job?.title ?? "—"} />
            <Row label="Added" value={`${dateShort(candidate.createdAt)}${candidate.createdByName ? ` by ${candidate.createdByName}` : ""}`} />
          </dl>
          {candidate.about ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="text-xs font-medium text-muted mb-1">About (from application)</div>
              <p className="text-sm text-ink whitespace-pre-line">{candidate.about}</p>
            </div>
          ) : null}
          {candidate.resumePath ? (
            <a href={candidate.resumePath} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5" /></svg>
              {candidate.resumeName ?? "Résumé"}
            </a>
          ) : null}
          {candidate.notes ? <p className="mt-3 text-sm text-muted whitespace-pre-line">{candidate.notes}</p> : null}
        </Card>

        {canManage || supervisor ? (
          <div>
            <CandidateActions {...actionData} />
          </div>
        ) : (
          <Card className="p-4 flex items-start gap-3 bg-brand-50 border-brand-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-600 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h4M16 11l2 2 4-4" /></svg>
            <div>
              <div className="text-sm font-medium text-brand-800">Interviewer view</div>
              <p className="text-xs text-brand-700">Read-only. You can review this candidate and everyone&rsquo;s completed scorecards; only HR advances the pipeline.</p>
            </div>
          </Card>
        )}
      </div>

      {/* Pipeline detail — screening, interview time, ranking, exclusion */}
      {(candidate.screeningNotes || candidate.screeningCompletedAt || candidate.interviewAt || candidate.interviewRank || excluded) ? (
        <Card className="p-4 mb-5 space-y-2">
          <div className="text-sm font-medium text-ink">Pipeline detail</div>
          <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
            {candidate.screeningCompletedAt ? <Row label="Screening" value={`Completed ${dateShort(candidate.screeningCompletedAt)}`} /> : candidate.screeningRequestedAt ? <Row label="Screening" value={`Call requested ${dateShort(candidate.screeningRequestedAt)}`} /> : null}
            {candidate.interviewAt ? <Row label="Interview" value={candidate.interviewAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} /> : null}
            {candidate.interviewRank ? <Row label="Rank" value={`#${candidate.interviewRank}`} /> : null}
            {excluded ? <Row label="Excluded" value={`${candidate.excludedReason ?? "—"}${candidate.excludedStage ? ` · cut at ${STAGE_LABELS[candidate.excludedStage] ?? candidate.excludedStage}` : ""}${candidate.keepWarm ? " · keep warm" : ""}`} /> : null}
          </dl>
          {candidate.screeningNotes ? (
            <div className="rounded-lg bg-black/[0.02] border border-line px-3 py-2">
              <div className="text-xs font-medium text-muted mb-0.5">Screening notes</div>
              <p className="text-sm text-ink whitespace-pre-line">{candidate.screeningNotes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Interviews + scorecards */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Interviews</h2>
        <span className="text-xs text-muted">{candidate.interviews.length} total</span>
      </div>
      {candidate.interviews.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted mb-5">No interviews assigned yet. Use &ldquo;Assign interview&rdquo; above.</Card>
      ) : (
        <div className="space-y-4 mb-5">
          {candidate.interviews.map((iv) => {
            const completed = iv.status === "completed";
            const gcal = googleCalendarUrl(iv, { name: candidate.name, email: candidate.email, jobTitle: candidate.job?.title });
            const sc = parseScorecard(iv.responses);
            const comps = sc.competencies ?? {};
            const basics = sc.basics ?? {};
            // Render with the template whose question ids match the saved
            // responses (assigned template, else legacy fallback).
            const t = renderTemplateForResponses(resolvedInterviewTemplate, sc);
            return (
              <Card key={iv.id} className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${completed ? "bg-emerald-100 text-emerald-700" : iv.status === "cancelled" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                    {INTERVIEW_STATUS_LABELS[iv.status] ?? iv.status}
                  </span>
                  <span className="text-sm font-medium text-ink">{iv.interviewerName ?? "Unassigned"}</span>
                  <span className="text-xs text-muted">· {INTERVIEW_TYPE_LABELS[iv.type] ?? iv.type}</span>
                  {iv.scheduledAt ? <span className="text-xs text-muted">· {iv.scheduledAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span> : <span className="text-xs text-muted">· time TBD</span>}
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="text-xs text-muted">{locationLine(iv)}</div>
                  {gcal ? (
                    <a href={gcal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z" /></svg>
                      Add to Google Calendar
                    </a>
                  ) : null}

                  {completed ? (
                    <div className="mt-2 space-y-3 border-t border-line pt-3">
                      <div className="flex flex-wrap gap-4">
                        <div><div className="text-xs text-muted">Recommendation</div><div className="font-medium text-ink">{iv.recommendation ? RECOMMENDATION_LABELS[iv.recommendation as RecommendationKey] ?? iv.recommendation : "—"}</div></div>
                        <div><div className="text-xs text-muted">Overall</div><div className="font-medium text-ink">{ratingLabel(iv.overallRating)}</div></div>
                        {iv.completedAt ? <div><div className="text-xs text-muted">Submitted</div><div className="text-ink">{dateShort(iv.completedAt)}</div></div> : null}
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {t.competencies.map((c) => (
                          <div key={c.key} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.02] px-3 py-1.5">
                            <span className="text-xs text-ink">{c.label}</span>
                            <span className="text-xs font-medium tabular-nums text-brand-700">{comps[c.key]?.rating ?? "—"}<span className="text-muted">/5</span></span>
                          </div>
                        ))}
                      </div>
                      {t.competencies.some((c) => comps[c.key]?.notes) ? (
                        <div className="space-y-1.5">
                          {t.competencies.filter((c) => comps[c.key]?.notes).map((c) => (
                            <div key={c.key} className="text-xs"><span className="text-muted">{c.label}:</span> <span className="text-ink">{comps[c.key]?.notes}</span></div>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {t.basics.map((b) => (
                          <span key={b.key} className="rounded-full bg-black/[0.03] px-2 py-0.5 text-[11px] text-muted">{b.label}: <span className="text-ink">{BASICS_LABELS[basics[b.key]] ?? "—"}</span></span>
                        ))}
                      </div>
                      {iv.summary ? (
                        <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2">
                          <div className="text-xs font-medium text-brand-800 mb-0.5">Summary</div>
                          <p className="text-sm text-ink whitespace-pre-line">{iv.summary}</p>
                        </div>
                      ) : null}
                      {sc.impressions ? (
                        <div className="rounded-lg bg-black/[0.02] border border-line px-3 py-2">
                          <div className="text-xs font-medium text-muted mb-0.5">Overall impressions &amp; culture fit</div>
                          <p className="text-sm text-ink whitespace-pre-line">{sc.impressions}</p>
                        </div>
                      ) : null}
                      {sc.additional ? (
                        <div className="rounded-lg bg-black/[0.02] border border-line px-3 py-2">
                          <div className="text-xs font-medium text-muted mb-0.5">Additional comments for the hiring decision</div>
                          <p className="text-sm text-ink whitespace-pre-line">{sc.additional}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : iv.status === "scheduled" ? (
                    <p className="text-xs text-muted italic border-t border-line pt-2">Awaiting the interviewer&rsquo;s scorecard.</p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Onboarding handoff */}
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-ink">Onboarding</h2>
      </div>
      <Card className="p-4">
        {preHire ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">{preHireStatusLabel(preHire.status)}</span>
              <span className="text-sm text-ink">Pre-hire onboarding packet created {dateShort(preHire.invitedAt)}.</span>
            </div>
            <p className="text-xs text-muted">The candidate completes drug-test consent, background authorization, and policy acknowledgments via their magic link. HR approves to convert them to an employee — which marks this candidate hired.</p>
            <Link href={`/management/people/prehires/${preHire.id}`} className="inline-block text-sm font-medium text-brand-700 hover:underline">Open onboarding packet →</Link>
          </div>
        ) : (
          <p className="text-sm text-muted">Not in onboarding yet. Use &ldquo;Move to onboarding&rdquo; once you&rsquo;re ready to extend an offer — it creates a pre-hire packet and emails the candidate their magic link.</p>
        )}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="col-span-1 text-xs text-muted self-center">{label}</dt>
      <dd className="col-span-2 text-ink break-words">{value}</dd>
    </>
  );
}
