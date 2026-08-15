import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { saveUpload, deleteUpload } from "@/lib/storage";
import {
  canManageAts,
  createJob,
  updateJob,
  createCandidate,
  setStage,
  assignInterview,
  moveToOnboarding,
  rejectCandidate,
  cancelInterview,
  closeOutHiring,
  reopenJob,
} from "@/lib/ats";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

// HR-side ATS actions. Gated to admins + granted HR (canManageAts).
//   job.create / job.update
//   candidate.create (JSON or multipart with an optional resume upload)
//   candidate.setStage / candidate.reject / candidate.moveToOnboarding
//   candidate.delete / interview.assign / interview.cancel
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !canManageAts(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const contentType = req.headers.get("content-type") ?? "";

  try {
    // ---- multipart: candidate.create with a resume file --------------------
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const action = str(fd.get("action"));
      if (action !== "candidate.create") return NextResponse.json({ error: "Unsupported multipart action." }, { status: 400 });

      const name = str(fd.get("name"));
      const email = str(fd.get("email"));
      if (!name || !email) return NextResponse.json({ error: "Candidate name and email are required." }, { status: 400 });

      let resumePath: string | null = null;
      let resumeName: string | null = null;
      const file = fd.get("resume");
      if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
        const f = file as File;
        const buf = Buffer.from(await f.arrayBuffer());
        resumePath = await saveUpload(buf, f.name, f.type || "application/octet-stream", "resumes");
        resumeName = f.name;
      }

      const candidate = await createCandidate(
        {
          jobId: str(fd.get("jobId")),
          name,
          email,
          phone: str(fd.get("phone")),
          source: str(fd.get("source")),
          notes: str(fd.get("notes")),
          resumePath,
          resumeName,
        },
        user.name,
      );
      return NextResponse.json({ ok: true, id: candidate.id });
    }

    // ---- JSON actions -------------------------------------------------------
    const body = await req.json().catch(() => null);
    const action = str(body?.action);

    if (action === "job.create") {
      const title = str(body?.title);
      if (!title) return NextResponse.json({ error: "A job title is required." }, { status: 400 });
      const job = await createJob(
        { title, branch: body?.branch, openings: body?.openings, description: body?.description, hiringManagerName: body?.hiringManagerName, status: body?.status },
        user.name,
      );
      return NextResponse.json({ ok: true, id: job.id });
    }

    if (action === "job.update") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
      await updateJob(id, {
        title: body?.title,
        branch: body?.branch,
        openings: body?.openings,
        description: body?.description,
        hiringManagerName: body?.hiringManagerName,
        status: body?.status,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "job.closeOut") {
      const jobId = str(body?.jobId);
      if (!jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
      const result = await closeOutHiring(jobId, str(body?.hiredCandidateId), user.name);
      return NextResponse.json({ ok: true, status: result.status, hiredName: result.hiredName });
    }

    if (action === "job.reopen") {
      const jobId = str(body?.jobId);
      if (!jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
      const { restored } = await reopenJob(jobId);
      return NextResponse.json({ ok: true, restored });
    }

    if (action === "candidate.create") {
      const name = str(body?.name);
      const email = str(body?.email);
      if (!name || !email) return NextResponse.json({ error: "Candidate name and email are required." }, { status: 400 });
      const candidate = await createCandidate(
        { jobId: body?.jobId, name, email, phone: body?.phone, source: body?.source, notes: body?.notes },
        user.name,
      );
      return NextResponse.json({ ok: true, id: candidate.id });
    }

    if (action === "candidate.setStage") {
      const id = str(body?.id);
      const stage = str(body?.stage);
      if (!id || !stage) return NextResponse.json({ error: "Missing candidate or stage." }, { status: 400 });
      // Onboarding is a handoff, not a plain stage flip — route it correctly.
      if (stage === "onboarding") {
        await moveToOnboarding(id, user.name);
        return NextResponse.json({ ok: true });
      }
      await setStage(id, stage);
      return NextResponse.json({ ok: true });
    }

    if (action === "candidate.moveToOnboarding") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const pre = await moveToOnboarding(id, user.name);
      return NextResponse.json({ ok: true, preHireId: pre.id });
    }

    if (action === "candidate.reject") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      await rejectCandidate(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "candidate.delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const c = await prisma.candidate.findUnique({ where: { id }, select: { resumePath: true } });
      if (c?.resumePath) await deleteUpload(c.resumePath);
      await prisma.candidate.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    if (action === "interview.assign") {
      const candidateId = str(body?.candidateId);
      if (!candidateId) return NextResponse.json({ error: "Missing candidate id." }, { status: 400 });
      const interview = await assignInterview(
        {
          candidateId,
          interviewerId: body?.interviewerId,
          scheduledAt: body?.scheduledAt,
          durationMins: body?.durationMins,
          type: body?.type,
          location: body?.location,
          meetingLink: body?.meetingLink,
        },
        user.name,
      );
      return NextResponse.json({ ok: true, id: interview.id });
    }

    if (action === "interview.cancel") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing interview id." }, { status: 400 });
      await cancelInterview(id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
