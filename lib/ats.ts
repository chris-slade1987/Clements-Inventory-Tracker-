import "server-only";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/inspection";
import { sendEmail } from "@/lib/email";
import { createPreHire } from "@/lib/prehire";
import { buildIcs, googleCalendarUrl, locationLine, interviewTitle } from "@/lib/calendar";
import type { SessionUser } from "@/lib/auth";
import {
  STAGE_ORDER,
  validateScorecard,
  normalizeRecommendation,
  type ScorecardResponses,
} from "@/lib/ats-config";

// ---------------------------------------------------------------------------
// In-house ATS (applicant tracking / hiring pipeline).
//
//   Job → Candidates (pipeline stages) → Interviews (assigned to a logged-in
//   team member who completes a REQUIRED scorecard) → Offer → the EXISTING
//   pre-hire onboarding portal (drug test / background / waivers by magic link)
//   → Hired.
//
// HR (admins + hrAccess) manage the whole pipeline. Interviewers are regular
// employees WITH logins who see + complete ONLY their assigned interview on My
// Work. Pure constants/types + the scorecard template live in lib/ats-config
// (client-safe); this module holds the server-only DB / email helpers and
// re-exports the shared config for convenience.
// ---------------------------------------------------------------------------

export * from "@/lib/ats-config";

/** Who may run the ATS: admins + granted HR (Chris + April). */
export function canManageAts(user: SessionUser): boolean {
  return user.role === "admin" || user.hrAccess;
}

export function parseScorecard(s: string | null | undefined): ScorecardResponses {
  return parseJson<ScorecardResponses>(s, {});
}

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

function normalizeRating(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
}

// ---- Jobs ------------------------------------------------------------------

export async function createJob(
  data: { title: string; branch?: string | null; openings?: number | null; description?: string | null; hiringManagerName?: string | null; status?: string | null },
  createdByName: string | null,
) {
  const openings = Number(data.openings);
  return prisma.job.create({
    data: {
      title: (data.title ?? "").trim(),
      branch: str(data.branch),
      openings: Number.isFinite(openings) && openings > 0 ? Math.round(openings) : 1,
      description: str(data.description),
      hiringManagerName: str(data.hiringManagerName),
      status: str(data.status) ?? "open",
      createdByName,
    },
  });
}

export async function updateJob(
  id: string,
  data: { title?: string | null; branch?: string | null; openings?: number | null; description?: string | null; hiringManagerName?: string | null; status?: string | null },
) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) { const t = (str(data.title) ?? "").trim(); if (t) patch.title = t; }
  if (data.branch !== undefined) patch.branch = str(data.branch);
  if (data.openings !== undefined) {
    const n = Number(data.openings);
    patch.openings = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  }
  if (data.description !== undefined) patch.description = str(data.description);
  if (data.hiringManagerName !== undefined) patch.hiringManagerName = str(data.hiringManagerName);
  if (data.status !== undefined && str(data.status)) patch.status = str(data.status);
  return prisma.job.update({ where: { id }, data: patch });
}

/** All jobs, newest first, with candidate counts. */
export async function listJobs() {
  return prisma.job.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: { _count: { select: { candidates: true } } },
  });
}

export async function jobDetail(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: {
      candidates: {
        orderBy: [{ createdAt: "desc" }],
        include: { _count: { select: { interviews: true } } },
      },
    },
  });
}

// ---- Candidates ------------------------------------------------------------

export async function createCandidate(
  data: { jobId?: string | null; name: string; email: string; phone?: string | null; source?: string | null; notes?: string | null; resumePath?: string | null; resumeName?: string | null },
  createdByName: string | null,
) {
  return prisma.candidate.create({
    data: {
      jobId: str(data.jobId),
      name: (data.name ?? "").trim(),
      email: (data.email ?? "").trim().toLowerCase(),
      phone: str(data.phone),
      source: str(data.source),
      notes: str(data.notes),
      resumePath: str(data.resumePath),
      resumeName: str(data.resumeName),
      createdByName,
    },
  });
}

export async function listCandidates(stage?: string) {
  return prisma.candidate.findMany({
    where: stage ? { stage } : undefined,
    orderBy: [{ createdAt: "desc" }],
    include: { job: { select: { id: true, title: true } } },
  });
}

/** The candidate hub: job, interviews (newest first), and linked pre-hire. */
export async function candidateDetail(id: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id },
    include: {
      job: true,
      interviews: { orderBy: [{ createdAt: "desc" }] },
    },
  });
  if (!candidate) return null;
  const preHire = candidate.preHireId
    ? await prisma.preHire.findUnique({ where: { id: candidate.preHireId } })
    : null;
  return { candidate, preHire };
}

export async function setStage(id: string, stage: string) {
  if (!(STAGE_ORDER as readonly string[]).includes(stage)) throw new Error("Unknown stage.");
  return prisma.candidate.update({ where: { id }, data: { stage } });
}

export async function rejectCandidate(id: string) {
  return prisma.candidate.update({ where: { id }, data: { stage: "rejected" } });
}

// ---- Interviewer picker ----------------------------------------------------

/**
 * Everyone HR can assign as an interviewer: people with a login (every active
 * employee account plus managers/admins). De-duped by name; the shared admin
 * login is dropped. Mirrors the new-hire review reviewer picker.
 */
export async function interviewerCandidates() {
  const users = await prisma.user.findMany({
    where: { active: true, OR: [{ employeeId: { not: null } }, { role: { in: ["manager", "admin"] } }] },
    select: { id: true, name: true, email: true, role: true, branch: true },
    orderBy: [{ name: "asc" }],
  });
  const seen = new Set<string>();
  return users.filter((u) => {
    const key = u.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- Interviews ------------------------------------------------------------

/**
 * Assign an interview to a logged-in team member. Creates the Interview, then
 * emails the interviewer the details + an "Add to Google Calendar" link and
 * includes the .ics content in the email log. In-person interviews show the
 * location; video interviews show the meeting link (or note a Meet link is TBD).
 */
export async function assignInterview(
  data: {
    candidateId: string;
    interviewerId?: string | null;
    scheduledAt?: string | null;
    durationMins?: number | null;
    type?: string | null;
    location?: string | null;
    meetingLink?: string | null;
  },
  assignedByName: string | null,
) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: data.candidateId },
    include: { job: { select: { title: true } } },
  });
  if (!candidate) throw new Error("Candidate not found.");

  let interviewerName: string | null = null;
  let interviewerEmail: string | null = null;
  if (str(data.interviewerId)) {
    const u = await prisma.user.findUnique({ where: { id: data.interviewerId! }, select: { name: true, email: true } });
    if (!u) throw new Error("Interviewer not found.");
    interviewerName = u.name;
    interviewerEmail = u.email;
  }

  const type = data.type === "video" ? "video" : "in_person";
  const dur = Number(data.durationMins);
  const scheduledAt = str(data.scheduledAt) ? new Date(data.scheduledAt!) : null;

  const interview = await prisma.interview.create({
    data: {
      candidateId: candidate.id,
      interviewerId: str(data.interviewerId),
      interviewerName,
      interviewerEmail,
      scheduledAt,
      durationMins: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 45,
      type,
      location: type === "in_person" ? str(data.location) : null,
      meetingLink: type === "video" ? str(data.meetingLink) : null,
      assignedByName,
    },
  });

  // Nudge the candidate's stage into "interviewing" if still upstream.
  if (candidate.stage === "applied" || candidate.stage === "screening") {
    await prisma.candidate.update({ where: { id: candidate.id }, data: { stage: "interviewing" } });
  }

  await notifyInterviewer(interview, candidate);
  return interview;
}

async function notifyInterviewer(
  interview: { id: string; scheduledAt: Date | null; durationMins: number; type: string; location: string | null; meetingLink: string | null; interviewerName: string | null; interviewerEmail: string | null },
  candidate: { name: string; email: string; job: { title: string } | null },
) {
  if (!interview.interviewerEmail) return;
  const cand = { name: candidate.name, email: candidate.email, jobTitle: candidate.job?.title ?? null };
  const title = interviewTitle(cand);
  const when = interview.scheduledAt
    ? interview.scheduledAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })
    : "Time to be scheduled";
  const gcal = googleCalendarUrl(interview, cand);
  const ics = buildIcs(interview, cand);
  const first = (interview.interviewerName || "there").split(/\s+/)[0];
  const openLink = `${base()}/me/interviews/${interview.id}`;

  const textParts = [
    `Hi ${first},`,
    "",
    `You've been assigned to interview ${candidate.name}${candidate.job?.title ? ` for ${candidate.job.title}` : ""}.`,
    "",
    `When: ${when} (${interview.durationMins} min)`,
    locationLine(interview),
    "",
    `Open your scorecard in the portal: ${openLink}`,
    gcal ? `Add to Google Calendar: ${gcal}` : "",
    "",
    "You must complete the interview scorecard (rate every competency, pick a recommendation, and write a summary) to finish.",
    "",
    "— Clements Command & Control",
  ].filter((l) => l !== "");

  const htmlParts = [
    `<p>Hi ${first},</p>`,
    `<p>You've been assigned to interview <strong>${candidate.name}</strong>${candidate.job?.title ? ` for <strong>${candidate.job.title}</strong>` : ""}.</p>`,
    `<p><strong>When:</strong> ${when} (${interview.durationMins} min)<br/>${locationLine(interview)}</p>`,
    `<p><a href="${openLink}">Open your scorecard →</a>${gcal ? ` &nbsp;·&nbsp; <a href="${gcal}">Add to Google Calendar</a>` : ""}</p>`,
    `<p>You must complete the scorecard (rate every competency, pick a recommendation, and write a summary) to finish.</p>`,
    ics ? `<pre style="font-size:11px;color:#667">${ics.replace(/</g, "&lt;")}</pre>` : "",
    `<p>— Clements Command &amp; Control</p>`,
  ].filter(Boolean);

  await sendEmail({
    to: interview.interviewerEmail,
    subject: `Interview assigned: ${title}`,
    kind: "interview_assigned",
    relatedType: "interview",
    relatedId: interview.id,
    text: textParts.join("\n"),
    html: htmlParts.join(""),
  });
}

export async function interviewById(id: string) {
  return prisma.interview.findUnique({
    where: { id },
    include: { candidate: { include: { job: { select: { id: true, title: true } } } } },
  });
}

/** An interviewer's assigned, not-yet-completed interviews (for /me). */
export async function interviewsForUser(userId: string) {
  return prisma.interview.findMany({
    where: { interviewerId: userId, status: { not: "completed" } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    include: { candidate: { include: { job: { select: { title: true } } } } },
  });
}

export async function cancelInterview(id: string) {
  return prisma.interview.update({ where: { id }, data: { status: "cancelled" } });
}

/** Save a partial (draft) scorecard — no validation. */
export async function saveInterviewScorecard(
  id: string,
  data: { responses?: ScorecardResponses; overallRating?: number | null; recommendation?: string | null; summary?: string | null },
) {
  const patch: Record<string, unknown> = {};
  if (data.responses !== undefined) patch.responses = JSON.stringify(data.responses ?? {});
  if (data.overallRating !== undefined) patch.overallRating = normalizeRating(data.overallRating);
  if (data.recommendation !== undefined) patch.recommendation = normalizeRecommendation(data.recommendation);
  if (data.summary !== undefined) patch.summary = str(data.summary);
  return prisma.interview.update({ where: { id }, data: patch });
}

/**
 * Complete (submit) an interview — validates the whole scorecard first, then
 * marks it completed. Throws with the list of missing items if incomplete.
 */
export async function completeInterview(
  id: string,
  data: { responses: ScorecardResponses; overallRating?: number | null; recommendation?: string | null; summary?: string | null },
) {
  const missing = validateScorecard(data);
  if (missing.length) throw new Error(`Please complete: ${missing.join("; ")}`);
  return prisma.interview.update({
    where: { id },
    data: {
      responses: JSON.stringify(data.responses ?? {}),
      overallRating: normalizeRating(data.overallRating),
      recommendation: normalizeRecommendation(data.recommendation),
      summary: str(data.summary),
      status: "completed",
      completedAt: new Date(),
    },
  });
}

// ---- Onboarding handoff ----------------------------------------------------

/**
 * Move a candidate into onboarding: create a PreHire from the candidate
 * (carrying name / email / position / branch), link it via Candidate.preHireId,
 * set the stage to "onboarding", and email the candidate their magic link so the
 * EXISTING onboarding portal takes over. Idempotent — reuses an existing link.
 */
export async function moveToOnboarding(candidateId: string, createdByName: string | null) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { job: { select: { title: true, branch: true } } },
  });
  if (!candidate) throw new Error("Candidate not found.");
  if (!candidate.email) throw new Error("A candidate email is required to start onboarding.");

  let preHire = candidate.preHireId
    ? await prisma.preHire.findUnique({ where: { id: candidate.preHireId } })
    : null;

  if (!preHire) {
    preHire = await createPreHire(
      {
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        position: candidate.job?.title ?? null,
        branch: candidate.job?.branch ?? null,
      },
      createdByName,
    );
    await prisma.candidate.update({ where: { id: candidate.id }, data: { preHireId: preHire.id, stage: "onboarding" } });
    await sendOnboardingInvite(preHire);
  } else if (candidate.stage !== "onboarding") {
    await prisma.candidate.update({ where: { id: candidate.id }, data: { stage: "onboarding" } });
  }

  return preHire;
}

async function sendOnboardingInvite(pre: { name: string; email: string; token: string; position: string | null }) {
  const link = `${base()}/onboarding/${pre.token}`;
  const first = pre.name.split(/\s+/)[0] || "there";
  return sendEmail({
    to: pre.email,
    subject: "Your Clements Pest Control onboarding",
    kind: "prehire_invite",
    relatedType: "prehire",
    relatedId: pre.token,
    text: `Hi ${first},\n\nCongratulations! To move forward${pre.position ? ` as ${pre.position}` : ""}, please complete a short onboarding packet. No account or password is needed — just open your personal link:\n\n${link}\n\nYou can save as you go and finish on any device. If you have questions, reply to this email or contact HR.\n\n— Clements Pest Control`,
    html: `<p>Hi ${first},</p><p>Congratulations! To move forward${pre.position ? ` as <strong>${pre.position}</strong>` : ""}, please complete a short onboarding packet. No account or password is needed — just open your personal link:</p><p><a href="${link}">Start your onboarding →</a></p><p>You can save as you go and finish on any device. If you have questions, reply to this email or contact HR.</p><p>— Clements Pest Control</p>`,
  });
}

// ---- Reminders / decision surfacing (HR) -----------------------------------

/** Interviews assigned but not completed past their scheduled date. */
export async function overdueInterviews() {
  const now = new Date();
  return prisma.interview.findMany({
    where: { status: "scheduled", scheduledAt: { lt: now } },
    orderBy: [{ scheduledAt: "asc" }],
    include: { candidate: { select: { id: true, name: true } } },
  });
}

/**
 * Candidates awaiting an HR decision: they're in the interviewing stage AND
 * every assigned interview is completed (so the scorecards are in).
 */
export async function candidatesAwaitingDecision() {
  const candidates = await prisma.candidate.findMany({
    where: { stage: "interviewing" },
    include: { interviews: { select: { status: true } } },
  });
  return candidates.filter(
    (c) => c.interviews.length > 0 && c.interviews.every((i) => i.status === "completed"),
  );
}
