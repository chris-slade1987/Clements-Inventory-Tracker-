import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader, Card } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import {
  canManageAts,
  interviewById,
  INTERVIEW_TEMPLATE,
  INTERVIEW_TYPE_LABELS,
  parseScorecard,
} from "@/lib/ats";
import { locationLine } from "@/lib/calendar";
import ScorecardForm from "./ScorecardForm";

export const dynamic = "force-dynamic";

export default async function InterviewScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const interview = await interviewById(id);
  if (!interview) notFound();

  const isInterviewer = !!interview.interviewerId && interview.interviewerId === user.id;
  const hr = canManageAts(user);
  if (!isInterviewer && !hr) redirect(homePath(user));

  const completed = interview.status === "completed";
  const sc = parseScorecard(interview.responses);

  return (
    <>
      <div className="mb-2">
        <Link href="/me" className="text-xs font-medium text-brand-300 hover:underline">← My Work</Link>
      </div>
      <PageHeader
        title={`Interview — ${interview.candidate.name}`}
        subtitle={[interview.candidate.job?.title, `${INTERVIEW_TYPE_LABELS[interview.type] ?? interview.type} interview`].filter(Boolean).join(" · ")}
      />

      <Card className="p-4 mb-4 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {completed ? "Completed" : "Awaiting your scorecard"}
          </span>
          {interview.scheduledAt ? <span className="text-xs text-muted">{interview.scheduledAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} · {interview.durationMins} min</span> : <span className="text-xs text-muted">Time to be scheduled</span>}
        </div>
        <div className="text-xs text-muted">{locationLine(interview)}</div>
        <div className="text-xs text-muted">Candidate email: {interview.candidate.email}</div>
      </Card>

      <ScorecardForm
        interviewId={interview.id}
        template={INTERVIEW_TEMPLATE}
        initialResponses={sc}
        initialOverall={interview.overallRating}
        initialRecommendation={interview.recommendation}
        initialSummary={interview.summary}
        readOnly={completed}
        canReopen={hr && completed}
      />
    </>
  );
}
