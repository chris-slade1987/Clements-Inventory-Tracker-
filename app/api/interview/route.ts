import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getHrEmail } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";
import {
  canManageAts,
  saveInterviewScorecard,
  completeInterview,
  RECOMMENDATION_LABELS,
  type ScorecardResponses,
  type RecommendationKey,
} from "@/lib/ats";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

// Interviewer-side scorecard workflow.
//   save   — partial draft save (assigned interviewer or HR)
//   submit — complete the interview; validated (all ratings + recommendation +
//            summary). On submit, HR is emailed that the scorecard is in.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  const interviewId = str(body?.interviewId);
  if (!action || !interviewId) return NextResponse.json({ error: "Missing action or interview." }, { status: 400 });

  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { candidate: { include: { job: { select: { title: true } } } } },
  });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });

  const isInterviewer = !!interview.interviewerId && interview.interviewerId === user.id;
  const hr = canManageAts(user);
  if (!isInterviewer && !hr) return NextResponse.json({ error: "Only the assigned interviewer or HR can edit this scorecard." }, { status: 403 });
  if (interview.status === "completed" && action !== "reopen")
    return NextResponse.json({ error: "This interview is already completed." }, { status: 400 });

  const responses = (body?.responses && typeof body.responses === "object" ? body.responses : {}) as ScorecardResponses;
  const overallRating = body?.overallRating ?? null;
  const recommendation = str(body?.recommendation);
  const summary = str(body?.summary);

  try {
    if (action === "save") {
      await saveInterviewScorecard(interviewId, { responses, overallRating, recommendation, summary });
      return NextResponse.json({ ok: true });
    }

    if (action === "submit") {
      await completeInterview(interviewId, { responses, overallRating, recommendation, summary });

      // Notify HR the scorecard is in and a decision may be needed.
      const rec = recommendation ? RECOMMENDATION_LABELS[recommendation as RecommendationKey] ?? recommendation : "—";
      const link = `${base()}/management/people/candidates/${interview.candidateId}`;
      await sendEmail({
        to: await getHrEmail(),
        subject: `Interview scorecard in: ${interview.candidate.name}`,
        kind: "interview_completed",
        relatedType: "interview",
        relatedId: interview.id,
        text: `${interview.interviewerName ?? user.name} completed the interview scorecard for ${interview.candidate.name}${interview.candidate.job?.title ? ` (${interview.candidate.job.title})` : ""}.\n\nRecommendation: ${rec}${overallRating ? ` · Overall ${overallRating}/5` : ""}\n\nReview and decide next steps:\n${link}\n\n— CanopyOS`,
        html: `<p><strong>${interview.interviewerName ?? user.name}</strong> completed the interview scorecard for <strong>${interview.candidate.name}</strong>${interview.candidate.job?.title ? ` (${interview.candidate.job.title})` : ""}.</p><p><strong>Recommendation:</strong> ${rec}${overallRating ? ` · Overall ${overallRating}/5` : ""}</p><p><a href="${link}">Review &amp; decide next steps →</a></p><p>— CanopyOS</p>`,
      });

      return NextResponse.json({ ok: true });
    }

    // HR-only: reopen a completed scorecard for correction.
    if (action === "reopen") {
      if (!hr) return NextResponse.json({ error: "Only HR can reopen a completed scorecard." }, { status: 403 });
      await prisma.interview.update({ where: { id: interviewId }, data: { status: "scheduled", completedAt: null } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
