import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  canManageAts,
  canOperateJob,
  shortlistCandidate,
  requestScreeningCall,
  saveScreening,
  excludeCandidate,
  reactivateCandidate,
  assignInterviewSupervisor,
  logInterviewTime,
  submitRankings,
  selectFinalist,
  moveToPreHire,
  setScreeningBookingUrl,
} from "@/lib/ats";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

// Applicant-pipeline actions (shortlist → screening → interview → ranking →
// selection → pre-hire) + the retained exclusion archive. Access is per-action:
//   HR (canManageAts):            shortlist, requestScreening, saveScreening,
//                                 assignSupervisor, setScreeningUrl
//   HR-only:                      selectFinalist, reactivate, moveToPreHire
//   HR OR assigned supervisor:    exclude (within their job), logInterviewTime,
//                                 submitRankings
async function candidateJobId(candidateId: string): Promise<string | null> {
  const c = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { jobId: true } });
  return c?.jobId ?? null;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  if (!action) return NextResponse.json({ error: "Missing action." }, { status: 400 });

  const hr = canManageAts(user);

  try {
    // ---- HR-wide -----------------------------------------------------------
    if (action === "candidate.shortlist") {
      if (!hr) return NextResponse.json({ error: "HR only." }, { status: 403 });
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      await shortlistCandidate(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "candidate.requestScreening") {
      if (!hr) return NextResponse.json({ error: "HR only." }, { status: 403 });
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const res = await requestScreeningCall(id, user.name);
      return NextResponse.json({ ok: true, ...res });
    }

    if (action === "candidate.saveScreening") {
      if (!hr) return NextResponse.json({ error: "HR only." }, { status: 403 });
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const responses = body?.responses && typeof body.responses === "object" ? (body.responses as Record<string, unknown>) : undefined;
      await saveScreening(id, { notes: body?.notes, responses, completed: !!body?.completed });
      return NextResponse.json({ ok: true });
    }

    if (action === "job.assignSupervisor") {
      if (!hr) return NextResponse.json({ error: "HR only." }, { status: 403 });
      const res = await assignInterviewSupervisor(
        { jobId: str(body?.jobId) ?? "", supervisorId: str(body?.supervisorId) ?? "", deadline: body?.deadline },
        user.name,
      );
      return NextResponse.json({ ok: true, ...res });
    }

    if (action === "settings.setScreeningUrl") {
      if (!hr) return NextResponse.json({ error: "HR only." }, { status: 403 });
      await setScreeningBookingUrl(str(body?.url));
      return NextResponse.json({ ok: true });
    }

    // ---- HR-only decision actions -----------------------------------------
    if (action === "candidate.selectFinalist") {
      if (!hr) return NextResponse.json({ error: "Only HR can select the finalist." }, { status: 403 });
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const res = await selectFinalist(id, user.name);
      return NextResponse.json({ ok: true, ...res });
    }

    if (action === "candidate.reactivate") {
      if (!hr) return NextResponse.json({ error: "Only HR can reactivate a candidate." }, { status: 403 });
      const id = str(body?.id);
      const toStage = str(body?.toStage);
      if (!id || !toStage) return NextResponse.json({ error: "Missing candidate or stage." }, { status: 400 });
      await reactivateCandidate(id, toStage, user.name);
      return NextResponse.json({ ok: true });
    }

    if (action === "candidate.moveToPreHire") {
      if (!hr) return NextResponse.json({ error: "Only HR can move a candidate to pre-hire." }, { status: 403 });
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const pre = await moveToPreHire(id, user.name);
      return NextResponse.json({ ok: true, preHireId: pre.id });
    }

    // ---- HR OR the assigned supervisor (within their container) -----------
    if (action === "candidate.exclude") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const jobId = await candidateJobId(id);
      const allowed = hr || (jobId ? await canOperateJob(user, jobId) : false);
      if (!allowed) return NextResponse.json({ error: "Not allowed to exclude this candidate." }, { status: 403 });
      await excludeCandidate(id, { reason: str(body?.reason) ?? "", note: body?.note }, user.name);
      return NextResponse.json({ ok: true });
    }

    if (action === "candidate.logInterviewTime") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const jobId = await candidateJobId(id);
      const allowed = hr || (jobId ? await canOperateJob(user, jobId) : false);
      if (!allowed) return NextResponse.json({ error: "Not allowed on this candidate." }, { status: 403 });
      const res = await logInterviewTime(id, str(body?.interviewAt), hr ? null : user.id);
      return NextResponse.json({ ok: true, ...res });
    }

    if (action === "job.submitRankings") {
      const jobId = str(body?.jobId);
      if (!jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
      const allowed = hr || (await canOperateJob(user, jobId));
      if (!allowed) return NextResponse.json({ error: "Only HR or the assigned supervisor can submit rankings." }, { status: 403 });
      const ordered = Array.isArray(body?.orderedIds) ? (body.orderedIds as unknown[]).map((x) => String(x)) : [];
      const res = await submitRankings(jobId, ordered, user.name);
      return NextResponse.json({ ok: true, ...res });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
