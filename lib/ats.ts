import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/inspection";
import { sendEmail } from "@/lib/email";
import { notifyThread } from "@/lib/threads";
import { branchLabel } from "@/lib/management";
import { createPreHire } from "@/lib/prehire";
import { buildIcs, googleCalendarUrl, locationLine, interviewTitle } from "@/lib/calendar";
import type { SessionUser } from "@/lib/auth";
import {
  STAGE_ORDER,
  validateScorecard,
  normalizeRecommendation,
  exclusionReasonsForStage,
  isExcludedStage,
  EXCLUDED_STAGES,
  type ScorecardResponses,
} from "@/lib/ats-config";
import { getHrEmail } from "@/lib/personnel";
import { interviewTemplateForCandidate, renderTemplateForResponses } from "@/lib/hiring-templates";

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

// ---- Public application "front door" --------------------------------------

/** A random, URL-safe apply-link slug (~16 chars). Unguessable per job. */
export function newApplyToken(): string {
  return randomBytes(12).toString("base64url");
}

/** Absolute public apply URL for a job token, optionally tagged with a source
 *  channel (?src=indeed|linkedin|website|careers|referral) for source tracking. */
export function applyUrl(token: string, src?: string | null): string {
  const url = `${base()}/apply/${token}`;
  return src ? `${url}?src=${encodeURIComponent(src)}` : url;
}

/** Map an inbound `src` channel to the Candidate.source we record. */
export function sourceFromChannel(src: string | null | undefined): string {
  switch ((src ?? "").trim().toLowerCase()) {
    case "indeed":
      return "Indeed";
    case "linkedin":
      return "LinkedIn";
    case "referral":
      return "Referral";
    case "website":
    case "careers":
      return "Company Website";
    default:
      return "Company Website";
  }
}

/** Look up a job by its public apply token (null if none). */
export async function jobByApplyToken(token: string) {
  if (!token) return null;
  return prisma.job.findUnique({ where: { applyToken: token } });
}

// ---- Demo email routing ----------------------------------------------------
// The [DEMO] walkthrough job's candidates use fake @example.com inboxes, so
// their applicant-facing emails would go nowhere. FOR THE DEMO ONLY, route them
// to the CEO so the screening-request / warm-rejection / confirmation flows can
// be exercised live. Real jobs are never affected. Remove with the demo seed.
const DEMO_APPLY_TOKEN = "demo-ats-pipeline";
const DEMO_REDIRECT_EMAIL = "c.slade@clementspestcontrol.com";

function isDemoJob(applyToken: string | null | undefined): boolean {
  return applyToken === DEMO_APPLY_TOKEN;
}

/** Applicant-facing recipient: the demo job routes to the CEO; everyone else
 *  gets the real address. */
function applicantMailTo(realEmail: string | null | undefined, applyToken: string | null | undefined): string | null | undefined {
  return isDemoJob(applyToken) ? DEMO_REDIRECT_EMAIL : realEmail;
}

/** A subject prefix + inline banner marking a redirected demo email, so the
 *  recipient sees who it would reach in production. Empty for real jobs. */
function demoMail(applyToken: string | null | undefined, realEmail: string | null | undefined) {
  if (!isDemoJob(applyToken)) return { subjectPrefix: "", bannerHtml: "", bannerText: "" };
  const dest = (realEmail || "the applicant").trim();
  return {
    subjectPrefix: "[DEMO] ",
    bannerHtml: `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#9a3412">Demo walkthrough — in production this email would be sent to <strong>${dest}</strong>.</div>`,
    bannerText: `[DEMO walkthrough — in production this would be sent to ${dest}]\n\n`,
  };
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
      applyToken: newApplyToken(),
      createdByName,
    },
  });
}

/** All OPEN jobs for the public careers listing, newest first. */
export async function listOpenJobs() {
  return prisma.job.findMany({
    where: { status: "open" },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, title: true, branch: true, description: true, openings: true, applyToken: true },
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

/**
 * All jobs, newest first, with candidate counts. Each row also carries the
 * resolved hired-candidate NAME (for the archive section) — cheap since we load
 * the candidates' id/name alongside the count.
 */
export async function listJobs() {
  const jobs = await prisma.job.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      _count: { select: { candidates: true } },
      candidates: { select: { id: true, name: true } },
    },
  });
  return jobs.map((j) => ({
    ...j,
    hiredName: j.hiredCandidateId ? j.candidates.find((c) => c.id === j.hiredCandidateId)?.name ?? null : null,
  }));
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
  data: { jobId?: string | null; name?: string | null; firstName?: string | null; lastName?: string | null; email: string; phone?: string | null; source?: string | null; notes?: string | null; resumePath?: string | null; resumeName?: string | null; addressStreet?: string | null; addressCity?: string | null; addressState?: string | null; addressZip?: string | null; about?: string | null },
  createdByName: string | null,
) {
  const firstName = str(data.firstName);
  const lastName = str(data.lastName);
  // Keep `name` populated for all existing ATS code — prefer an explicit name,
  // otherwise compose it from the first/last parts the public form collects.
  const name = (str(data.name) ?? [firstName, lastName].filter(Boolean).join(" ")).trim();
  return prisma.candidate.create({
    data: {
      jobId: str(data.jobId),
      name,
      firstName,
      lastName,
      email: (data.email ?? "").trim().toLowerCase(),
      phone: str(data.phone),
      source: str(data.source),
      notes: str(data.notes),
      resumePath: str(data.resumePath),
      resumeName: str(data.resumeName),
      addressStreet: str(data.addressStreet),
      addressCity: str(data.addressCity),
      addressState: str(data.addressState),
      addressZip: str(data.addressZip),
      about: str(data.about),
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

// ---- Public-application notifications --------------------------------------
// A public applicant creates a Candidate with no logged-in author. Two
// best-effort notifications fire on submit (neither may ever fail the
// application): an internal alert to HR + the job's supervisors (reusing the
// internal-discussions thread system, which auto-emails participants), and a
// warm, branded confirmation email to the applicant.

/**
 * Recipients for a new public application: HR (admins + granted HR) plus the
 * job's supervisors — active branch managers on the job's branch and anyone
 * already assigned an interview on the job. Deduped by user id; only those with
 * an email are kept.
 */
async function applicantNotifyRecipients(job: { id: string; branch: string | null }) {
  const orFilters: Record<string, unknown>[] = [{ hrAccess: true }, { role: "admin" }];
  if (job.branch) orFilters.push({ role: "manager", branch: job.branch });

  const [staff, interviews] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, OR: orFilters },
      select: { id: true, name: true, email: true },
    }),
    prisma.interview.findMany({
      where: { candidate: { jobId: job.id }, interviewerId: { not: null } },
      select: { interviewerId: true, interviewerName: true, interviewerEmail: true },
    }),
  ]);

  const byId = new Map<string, { id: string; name: string; email: string | null }>();
  for (const u of staff) byId.set(u.id, { id: u.id, name: u.name, email: u.email });
  for (const iv of interviews) {
    if (iv.interviewerId && !byId.has(iv.interviewerId)) {
      byId.set(iv.interviewerId, { id: iv.interviewerId, name: iv.interviewerName ?? "Interviewer", email: iv.interviewerEmail });
    }
  }
  return [...byId.values()].filter((u) => u.email);
}

/** Alert HR + the job's supervisors that a new candidate applied. Best-effort. */
export async function notifyNewApplicant(
  candidate: { id: string; name: string; firstName: string | null; lastName: string | null; email: string; phone: string | null; source: string | null },
  job: { id: string; title: string; branch: string | null },
) {
  const recipients = await applicantNotifyRecipients(job);
  if (recipients.length === 0) return { notified: 0 };

  const who = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || candidate.name;
  const branchName = job.branch ? branchLabel(job.branch) : null;
  const subject = `New applicant: ${who} — ${job.title}`;
  const href = `/management/people/candidates/${candidate.id}`;
  const body =
    `${who} just applied${branchName ? ` for ${job.title} (${branchName})` : ` for ${job.title}`} via ${candidate.source ?? "the careers page"}.\n\n` +
    `Email: ${candidate.email}\n` +
    (candidate.phone ? `Phone: ${candidate.phone}\n` : "") +
    `\nOpen their profile in the job container: ${base()}${href}`;

  const now = new Date();
  const thread = await prisma.thread.create({
    data: {
      subject,
      branch: job.branch,
      contextType: "general",
      contextId: candidate.id,
      contextLabel: `${who} — ${job.title}`,
      contextHref: href,
      createdByName: "Careers (public application)",
      updatedAt: now,
      messages: { create: { authorName: "Careers (public application)", body } },
      participants: { create: recipients.map((r) => ({ userId: r.id, name: r.name, email: r.email })) },
    },
  });

  await notifyThread({
    threadId: thread.id,
    subject,
    contextLabel: `${who} — ${job.title}`,
    authorName: "Careers (public application)",
    authorUserId: null,
    body,
    isNew: true,
  }).catch(() => {});

  return { notified: recipients.length };
}

/** Send the applicant a warm, branded confirmation email. Best-effort. */
export async function sendApplicantConfirmation(
  candidate: { id: string; firstName: string | null; name: string; email: string },
  job: { title: string; applyToken?: string | null },
) {
  const first = (candidate.firstName || candidate.name || "there").split(/\s+/)[0];
  const dm = demoMail(job.applyToken, candidate.email);
  const subject = `${dm.subjectPrefix}Thanks for applying — ${job.title} at Clements Pest Control`;
  const text = [
    dm.bannerText,
    `Hi ${first},`,
    "",
    `Thank you for applying to the ${job.title} position at Clements Pest Control. We truly appreciate your interest in joining our team.`,
    "",
    `Our hiring team is reviewing applications now. If we decide to move forward to next steps, we'll be in touch at this email address.`,
    "",
    "Warm regards,",
    "The Clements Pest Control Hiring Team",
  ].join("\n");
  const html = [
    `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#0f3d2c">`,
    dm.bannerHtml,
    `<div style="background:linear-gradient(150deg,#14503a,#0f3d2c);border-radius:14px;padding:22px 24px;color:#eef5f0">`,
    `<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9db5a8">Clements Pest Control</div>`,
    `<div style="font-size:20px;font-weight:600;margin-top:4px">Application received</div>`,
    `</div>`,
    `<div style="padding:20px 4px">`,
    `<p>Hi ${first},</p>`,
    `<p>Thank you for applying to the <strong>${job.title}</strong> position at Clements Pest Control. We truly appreciate your interest in joining our team.</p>`,
    `<p>Our hiring team is reviewing applications now. If we decide to move forward to next steps, we&rsquo;ll be in touch at this email address.</p>`,
    `<p style="margin-top:22px">Warm regards,<br/>The Clements Pest Control Hiring Team</p>`,
    `</div></div>`,
  ].join("");

  return sendEmail({
    to: applicantMailTo(candidate.email, job.applyToken),
    subject,
    kind: "applicant_confirmation",
    relatedType: "candidate",
    relatedId: candidate.id,
    text,
    html,
  });
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
    "— Canopy OS",
  ].filter((l) => l !== "");

  const htmlParts = [
    `<p>Hi ${first},</p>`,
    `<p>You've been assigned to interview <strong>${candidate.name}</strong>${candidate.job?.title ? ` for <strong>${candidate.job.title}</strong>` : ""}.</p>`,
    `<p><strong>When:</strong> ${when} (${interview.durationMins} min)<br/>${locationLine(interview)}</p>`,
    `<p><a href="${openLink}">Open your scorecard →</a>${gcal ? ` &nbsp;·&nbsp; <a href="${gcal}">Add to Google Calendar</a>` : ""}</p>`,
    `<p>You must complete the scorecard (rate every competency, pick a recommendation, and write a summary) to finish.</p>`,
    ics ? `<pre style="font-size:11px;color:#667">${ics.replace(/</g, "&lt;")}</pre>` : "",
    `<p>— Canopy OS</p>`,
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
 * Validates against the JOB'S ASSIGNED interview template (or the legacy
 * hardcoded questionnaire when none is configured), so the required competencies
 * match what the fill form rendered.
 */
export async function completeInterview(
  id: string,
  data: { responses: ScorecardResponses; overallRating?: number | null; recommendation?: string | null; summary?: string | null },
) {
  const iv = await prisma.interview.findUnique({ where: { id }, select: { candidateId: true } });
  const resolved = iv ? await interviewTemplateForCandidate(iv.candidateId) : undefined;
  // Validate against the template whose question ids match the submitted
  // responses — the same render-fallback the fill form used, so a template
  // reassigned mid-interview can't wedge a legacy-keyed draft.
  const template = resolved ? renderTemplateForResponses(resolved, data.responses) : undefined;
  const missing = validateScorecard(data, template);
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
export async function moveToOnboarding(
  candidateId: string,
  createdByName: string | null,
  opts?: { stage?: string },
) {
  const targetStage = opts?.stage ?? "onboarding";
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
    await prisma.candidate.update({ where: { id: candidate.id }, data: { preHireId: preHire.id, stage: targetStage } });
    await sendOnboardingInvite(preHire);
  } else if (candidate.stage !== targetStage) {
    await prisma.candidate.update({ where: { id: candidate.id }, data: { stage: targetStage } });
  }

  return preHire;
}

/**
 * Hand a SELECTED finalist to the pre-hire boundary. Reuses the EXISTING
 * moveToOnboarding / PreHire path (creates the PreHire, emails the magic link),
 * but stamps the candidate "pre_hire" — the boundary of this build. The CEO
 * defines the pre-hire paperwork beyond this point; nothing new is built here.
 */
export async function moveToPreHire(candidateId: string, createdByName: string | null) {
  return moveToOnboarding(candidateId, createdByName, { stage: "pre_hire" });
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

// ---- Interviewer scoped access (Refinement 2) -----------------------------
// Anyone assigned an interview on an ACTIVE job gets read access to that whole
// job container (job + all candidates + all scorecards). Access is COMPUTED —
// no stored flag — so filling/closing the job automatically revokes it.

const ACTIVE_JOB_STATUSES = ["open", "on_hold"];

/**
 * Job ids the user has interviewer access to: they're assigned an interview on
 * a candidate whose job is still active (open/on_hold).
 */
export async function interviewerJobIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.interview.findMany({
    // A cancelled interview (e.g. the supervisor was reassigned off this job)
    // no longer grants container access.
    where: { interviewerId: userId, status: { not: "cancelled" }, candidate: { job: { status: { in: ACTIVE_JOB_STATUSES } } } },
    select: { candidate: { select: { jobId: true } } },
  });
  const ids = new Set<string>();
  for (const r of rows) if (r.candidate.jobId) ids.add(r.candidate.jobId);
  return ids;
}

/** HR always; otherwise only if the user is an interviewer on this active job. */
export async function canAccessJob(user: SessionUser, jobId: string): Promise<boolean> {
  if (canManageAts(user)) return true;
  return (await interviewerJobIds(user.id)).has(jobId);
}

/** HR always (even if the candidate has no job); otherwise via the candidate's job. */
export async function canAccessCandidate(user: SessionUser, candidateId: string): Promise<boolean> {
  if (canManageAts(user)) return true;
  const c = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { jobId: true } });
  if (!c?.jobId) return false;
  return canAccessJob(user, c.jobId);
}

/** True when the user is currently an interviewer on any active job. */
export async function isActiveInterviewer(userId: string): Promise<boolean> {
  return (await interviewerJobIds(userId)).size > 0;
}

/**
 * Active jobs the user is an interviewer on, with that user's own interviews on
 * each (for the "My Hiring" list). Newest job first.
 */
export async function involvedJobsForUser(userId: string) {
  const jobIds = await interviewerJobIds(userId);
  if (jobIds.size === 0) return [];
  const ids = [...jobIds];
  const [jobs, interviews] = await Promise.all([
    prisma.job.findMany({ where: { id: { in: ids } }, orderBy: [{ createdAt: "desc" }] }),
    prisma.interview.findMany({
      where: { interviewerId: userId, candidate: { jobId: { in: ids } } },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      include: { candidate: { select: { id: true, name: true, jobId: true } } },
    }),
  ]);
  return jobs.map((job) => ({
    job,
    myInterviews: interviews
      .filter((iv) => iv.candidate.jobId === job.id)
      .map((iv) => ({ id: iv.id, candidateName: iv.candidate.name, candidateId: iv.candidate.id, status: iv.status, scheduledAt: iv.scheduledAt })),
  }));
}

// ---- Post-hire close-out (Refinement 3) -----------------------------------

/**
 * Complete a job's hiring. If a candidate was hired: mark them hired, set the
 * job to filled and record the hire. Otherwise close the position with no hire.
 * Either way stamp filledAt, notify every DISTINCT interviewer of the result,
 * and idempotently stamp outcomeNotifiedAt (so their computed container access
 * ends and the outcome shows on their "Hiring results"). Returns a summary.
 */
export async function closeOutHiring(jobId: string, hiredCandidateId: string | null, byName: string | null) {
  void byName; // reserved for a future audit field; kept for a stable signature.
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      candidates: {
        include: {
          interviews: { select: { interviewerId: true, interviewerName: true, interviewerEmail: true } },
        },
      },
    },
  });
  if (!job) throw new Error("Job not found.");

  const hired = hiredCandidateId ? job.candidates.find((c) => c.id === hiredCandidateId) ?? null : null;
  if (hiredCandidateId && !hired) throw new Error("Selected candidate is not on this job.");

  const now = new Date();
  if (hired) {
    await prisma.candidate.update({ where: { id: hired.id }, data: { stage: "hired" } });
    await prisma.job.update({ where: { id: job.id }, data: { status: "filled", hiredCandidateId: hired.id, filledAt: now } });
  } else {
    await prisma.job.update({ where: { id: job.id }, data: { status: "closed", hiredCandidateId: null, filledAt: now } });
  }

  const status = hired ? "filled" : "closed";
  const hiredName = hired?.name ?? null;

  // Notify each distinct interviewer across all this job's candidates' interviews.
  const seen = new Set<string>();
  let notified = 0;
  for (const c of job.candidates) {
    for (const iv of c.interviews) {
      if (!iv.interviewerId || seen.has(iv.interviewerId)) continue;
      seen.add(iv.interviewerId);
      if (iv.interviewerEmail) {
        await notifyInterviewerOutcome(iv.interviewerEmail, iv.interviewerName, job.title, hiredName, job.id);
        notified++;
      }
    }
  }
  // Idempotency guard: stamp only where still null, so re-running won't re-notify.
  await prisma.interview.updateMany({
    where: { candidate: { jobId: job.id }, interviewerId: { not: null }, outcomeNotifiedAt: null },
    data: { outcomeNotifiedAt: now },
  });

  return { status, hiredName, notified };
}

async function notifyInterviewerOutcome(
  interviewerEmail: string,
  interviewerName: string | null,
  jobTitle: string,
  hiredName: string | null,
  jobId: string,
) {
  const first = (interviewerName || "there").split(/\s+/)[0];
  const body = hiredName
    ? `We've completed the hiring process and ${hiredName} was selected.`
    : `The ${jobTitle} search has been closed without a hire.`;
  const text = [
    `Hi ${first},`,
    "",
    `Thanks for interviewing for ${jobTitle}. ${body} Your access to this job's hiring workspace has now closed.`,
    "",
    "Thank you for helping us make this decision.",
    "",
    "— Canopy OS",
  ].join("\n");
  const html = [
    `<p>Hi ${first},</p>`,
    `<p>Thanks for interviewing for <strong>${jobTitle}</strong>. ${hiredName ? `We've completed the hiring process and <strong>${hiredName}</strong> was selected.` : `The <strong>${jobTitle}</strong> search has been closed without a hire.`} Your access to this job's hiring workspace has now closed.</p>`,
    `<p>Thank you for helping us make this decision.</p>`,
    `<p>— Canopy OS</p>`,
  ].join("");
  await sendEmail({
    to: interviewerEmail,
    subject: `Hiring update: ${jobTitle}`,
    kind: "interview_outcome",
    relatedType: "job",
    relatedId: jobId,
    text,
    html,
  });
}

/**
 * Reopen a filled/closed job — restores computed interviewer access AND brings
 * back the finalists we deliberately kept warm at selection (excluded "Not
 * selected", keepWarm). Those runner-ups return to the "ranked" shortlist with
 * their exclusion cleared, so if the first-choice hire falls through HR can
 * immediately select an alternate. The previously-hired candidate is left as-is
 * (HR decides whether to exclude or re-select them). Returns how many were
 * restored so the UI can confirm it.
 */
export async function reopenJob(jobId: string) {
  const restored = await prisma.candidate.updateMany({
    where: { jobId, stage: "excluded", keepWarm: true, excludedReason: "Not selected" },
    data: {
      stage: "ranked",
      excludedReason: null,
      excludedStage: null,
      excludedAt: null,
      excludedByName: null,
      keepWarm: false,
    },
  });
  await prisma.job.update({ where: { id: jobId }, data: { status: "open", filledAt: null, hiredCandidateId: null } });
  return { restored: restored.count };
}

/**
 * Hiring results a (possibly former) interviewer sees after their container
 * access is gone: their interviews that have been outcome-notified, deduped by
 * job (most recent notification), within the last 30 days, newest first, with
 * the hired candidate's name resolved.
 */
export async function hiringResultsForUser(userId: string) {
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = await prisma.interview.findMany({
    where: { interviewerId: userId, outcomeNotifiedAt: { not: null, gte: since } },
    orderBy: [{ outcomeNotifiedAt: "desc" }],
    include: { candidate: { select: { job: { select: { id: true, title: true, status: true, hiredCandidateId: true } } } } },
  });
  const byJob = new Map<string, { jobId: string; jobTitle: string; status: string; notifiedAt: Date; hiredCandidateId: string | null }>();
  for (const iv of rows) {
    const job = iv.candidate.job;
    if (!job || byJob.has(job.id)) continue; // newest-first — keep the most recent
    byJob.set(job.id, { jobId: job.id, jobTitle: job.title, status: job.status, notifiedAt: iv.outcomeNotifiedAt!, hiredCandidateId: job.hiredCandidateId });
  }
  const results = [...byJob.values()];
  const hiredIds = results.map((r) => r.hiredCandidateId).filter((x): x is string => !!x);
  const names = hiredIds.length
    ? await prisma.candidate.findMany({ where: { id: { in: hiredIds } }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n.name]));
  return results.map((r) => ({
    jobId: r.jobId,
    jobTitle: r.jobTitle,
    hiredName: r.hiredCandidateId ? nameMap.get(r.hiredCandidateId) ?? null : null,
    status: r.status,
    notifiedAt: r.notifiedAt,
  }));
}

/**
 * Active jobs with a candidate that has advanced to hired/onboarding — HR should
 * close them out (notify interviewers, archive, revoke access). For reminders.
 */
export async function jobsAwaitingCloseout() {
  return prisma.job.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      candidates: { some: { stage: { in: ["hired", "onboarding"] } } },
    },
    select: { id: true, title: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

// ===========================================================================
// Applicant pipeline: shortlist → screening → interview → ranking → selection
// → pre-hire boundary, plus the stage-specific, RETAINED exclusion archive.
// Everything here EXTENDS the ATS above; nothing is ever hard-deleted.
// ===========================================================================

const CEO_EMAIL = (process.env.CEO_EMAIL || "c.slade@clementspestcontrol.com").toLowerCase();

/** Setting key holding the HR-set Google Appointment Schedule booking link. */
const SCREENING_URL_KEY = "hr_screening_booking_url";

export async function getScreeningBookingUrl(): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key: SCREENING_URL_KEY } }).catch(() => null);
  return s?.value?.trim() || null;
}

export async function setScreeningBookingUrl(url: string | null): Promise<void> {
  const value = (url ?? "").trim();
  if (!value) {
    await prisma.setting.deleteMany({ where: { key: SCREENING_URL_KEY } });
    return;
  }
  await prisma.setting.upsert({
    where: { key: SCREENING_URL_KEY },
    update: { value },
    create: { key: SCREENING_URL_KEY, value },
  });
}

// ---- Access: the assigned interviewing supervisor ("operate" the container) --

/**
 * True when the user may OPERATE within a job container (log interview times,
 * fill the questionnaire, submit rankings): HR always, otherwise the assigned
 * interviewer/supervisor on this active job. SELECTION + reactivation stay
 * HR-only (canManageAts) and are checked separately.
 */
export async function canOperateJob(user: SessionUser, jobId: string): Promise<boolean> {
  if (canManageAts(user)) return true;
  return (await interviewerJobIds(user.id)).has(jobId);
}

// ---- Stage-specific exclusion (retained, reason-tagged archive) ------------

/**
 * Exclude a candidate — the RETAINED archive action (never a delete). Stamps the
 * reason, the stage they were cut at, when, and by whom. The reason MUST belong
 * to the current stage's reason set; "Other" requires a note. keepWarm marks a
 * re-engageable finalist (set by the selection flow for un-selected runner-ups).
 */
export async function excludeCandidate(
  id: string,
  data: { reason: string; note?: string | null; keepWarm?: boolean; validate?: boolean },
  byName: string | null,
) {
  const candidate = await prisma.candidate.findUnique({ where: { id }, select: { stage: true } });
  if (!candidate) throw new Error("Candidate not found.");
  if (isExcludedStage(candidate.stage)) throw new Error("This candidate is already excluded.");

  const reason = str(data.reason);
  if (!reason) throw new Error("Choose a reason for excluding this candidate.");
  const note = str(data.note);

  // Only offer/accept reasons that belong to the candidate's current stage.
  if (data.validate !== false) {
    const allowed = exclusionReasonsForStage(candidate.stage);
    if (!allowed.includes(reason)) throw new Error("That reason isn't available at this stage.");
    if (reason === "Other" && !note) throw new Error("A note is required when excluding for “Other”.");
  }

  const excludedReason = note ? `${reason} — ${note}` : reason;
  return prisma.candidate.update({
    where: { id },
    data: {
      stage: "excluded",
      excludedReason,
      excludedStage: candidate.stage,
      excludedAt: new Date(),
      excludedByName: byName,
      keepWarm: data.keepWarm ?? false,
    },
  });
}

/**
 * Reactivate an excluded candidate back into a chosen active stage (HR/admin
 * only — the "if our pick falls through" path). Clears the excluded stamps and
 * the keep-warm flag; retains all history (notes, screening, interviews, rank).
 */
export async function reactivateCandidate(id: string, toStage: string, byName: string | null) {
  const candidate = await prisma.candidate.findUnique({ where: { id }, select: { stage: true } });
  if (!candidate) throw new Error("Candidate not found.");
  if (!isExcludedStage(candidate.stage)) throw new Error("Only an excluded candidate can be reactivated.");
  const stage = str(toStage);
  if (!stage || !(STAGE_ORDER as readonly string[]).includes(stage) || isExcludedStage(stage)) {
    throw new Error("Choose a valid active stage to reactivate into.");
  }
  return prisma.candidate.update({
    where: { id },
    data: {
      stage,
      excludedReason: null,
      excludedStage: null,
      excludedAt: null,
      excludedByName: null,
      keepWarm: false,
      // A reactivated finalist who was auto-excluded on selection deserves a fresh
      // shot; clear the stale rank so the supervisor re-ranks cleanly if needed.
      ...(stage === "interviewing" ? { interviewRank: null } : {}),
      updatedAt: new Date(),
    },
  });
}

/** Excluded candidates on a job (the per-job Excluded archive). */
export async function excludedForJob(jobId: string) {
  return prisma.candidate.findMany({
    where: { jobId, stage: { in: [...EXCLUDED_STAGES] } },
    orderBy: [{ excludedAt: "desc" }, { updatedAt: "desc" }],
  });
}

/** Global Excluded archive (People/HR) — every excluded candidate, newest first. */
export async function excludedCandidates() {
  return prisma.candidate.findMany({
    where: { stage: { in: [...EXCLUDED_STAGES] } },
    orderBy: [{ excludedAt: "desc" }, { updatedAt: "desc" }],
    include: { job: { select: { id: true, title: true } } },
  });
}

// ---- Stage 2: shortlist + HR screening -------------------------------------

/** Shortlist an applicant: advance applied → screening. */
export async function shortlistCandidate(id: string) {
  const c = await prisma.candidate.findUnique({ where: { id }, select: { stage: true } });
  if (!c) throw new Error("Candidate not found.");
  return prisma.candidate.update({ where: { id }, data: { stage: "screening" } });
}

/**
 * Request a screening call: email the candidate the HR Google Appointment
 * Schedule booking link, advance to "screening", and stamp screeningRequestedAt.
 * Best-effort email; if HR hasn't set a booking link yet we still advance and
 * report emailed:false so the UI can nudge them to paste the link.
 */
export async function requestScreeningCall(id: string, byName: string | null) {
  const candidate = await prisma.candidate.findUnique({
    where: { id },
    include: { job: { select: { title: true, applyToken: true } } },
  });
  if (!candidate) throw new Error("Candidate not found.");

  const bookingUrl = await getScreeningBookingUrl();
  await prisma.candidate.update({
    where: { id },
    data: { stage: candidate.stage === "applied" ? "screening" : candidate.stage, screeningRequestedAt: new Date() },
  });

  let emailed = false;
  if (bookingUrl) {
    const first = (candidate.firstName || candidate.name || "there").split(/\s+/)[0];
    const role = candidate.job?.title ?? "the role";
    const dm = demoMail(candidate.job?.applyToken, candidate.email);
    const subject = `${dm.subjectPrefix}Let's schedule your screening call — ${candidate.job?.title ?? "Clements Pest Control"}`;
    const text = [
      dm.bannerText,
      `Hi ${first},`,
      "",
      `Thanks for applying for ${role} at Clements Pest Control. We'd like to set up a short phone screening call.`,
      "",
      `Please pick a time that works for you here:`,
      bookingUrl,
      "",
      `Once you book, you'll get a calendar confirmation. We look forward to speaking with you!`,
      "",
      "Warm regards,",
      "The Clements Pest Control Hiring Team",
    ].join("\n");
    const html = [
      `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#0f3d2c">`,
      dm.bannerHtml,
      `<p>Hi ${first},</p>`,
      `<p>Thanks for applying for <strong>${role}</strong> at Clements Pest Control. We'd like to set up a short phone screening call.</p>`,
      `<p><a href="${bookingUrl}" style="background:#146A3A;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Pick a time for your call →</a></p>`,
      `<p style="font-size:12px;color:#667">Or paste this link into your browser: ${bookingUrl}</p>`,
      `<p style="margin-top:18px">Warm regards,<br/>The Clements Pest Control Hiring Team</p>`,
      `</div>`,
    ].join("");
    const res = await sendEmail({
      to: applicantMailTo(candidate.email, candidate.job?.applyToken),
      subject,
      kind: "screening_request",
      relatedType: "candidate",
      relatedId: candidate.id,
      text,
      html,
    }).catch(() => null);
    emailed = res?.status === "sent";
  }
  void byName;
  return { emailed, bookingConfigured: !!bookingUrl };
}

/** Record screening notes, structured template responses, and/or mark the
 *  screening call complete. `responses` is the assigned screening template's
 *  answers keyed by question id (stored as JSON in screeningResponses). */
export async function saveScreening(
  id: string,
  data: { notes?: string | null; responses?: Record<string, unknown>; completed?: boolean },
) {
  const patch: Record<string, unknown> = {};
  if (data.notes !== undefined) patch.screeningNotes = str(data.notes);
  if (data.responses !== undefined) patch.screeningResponses = JSON.stringify(data.responses ?? {});
  if (data.completed) patch.screeningCompletedAt = new Date();
  return prisma.candidate.update({ where: { id }, data: patch });
}

// ---- Stage 3: interview handoff --------------------------------------------

/**
 * Hand off to the interviewing supervisor. Records the supervisor + HR-set
 * deadline on the Job, creates an Interview (reusing assignInterview's access +
 * scorecard machinery) for every shortlisted candidate currently in the
 * interview stage that the supervisor isn't already assigned, and posts ONE
 * notification (thread + email) listing the candidates to schedule by the
 * deadline. Returns how many candidates were handed off.
 */
export async function assignInterviewSupervisor(
  data: { jobId: string; supervisorId: string; deadline?: string | null },
  byName: string | null,
) {
  const jobId = str(data.jobId);
  const supervisorId = str(data.supervisorId);
  if (!jobId) throw new Error("Missing job.");
  if (!supervisorId) throw new Error("Choose an interviewing supervisor.");

  const [job, supervisor] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId }, include: { candidates: { include: { interviews: true } } } }),
    prisma.user.findUnique({ where: { id: supervisorId }, select: { id: true, name: true, email: true } }),
  ]);
  if (!job) throw new Error("Job not found.");
  if (!supervisor) throw new Error("Supervisor not found.");

  // Reassignment: if a different supervisor was previously assigned, revoke
  // their still-open (not-yet-completed) interviews so they lose access and the
  // candidate isn't double-assigned. Completed scorecards are preserved for the
  // record. The new supervisor is (re)assigned + notified below.
  const prevSupervisorId = job.interviewSupervisorId;
  const prevSupervisorName = job.interviewSupervisorName;
  const reassigned = !!prevSupervisorId && prevSupervisorId !== supervisor.id;
  let revoked = 0;
  if (reassigned) {
    const res = await prisma.interview.updateMany({
      where: { candidate: { jobId }, interviewerId: prevSupervisorId, status: { not: "completed" } },
      data: { status: "cancelled" },
    });
    revoked = res.count;
  }

  const deadline = str(data.deadline) ? new Date(data.deadline!) : null;
  await prisma.job.update({
    where: { id: jobId },
    data: {
      interviewSupervisorId: supervisor.id,
      interviewSupervisorName: supervisor.name,
      interviewDeadline: deadline,
    },
  });

  // Shortlisted-for-interview candidates: those in the interview stage.
  const shortlisted = job.candidates.filter((c) => c.stage === "interviewing");
  const handed: { id: string; name: string }[] = [];
  for (const c of shortlisted) {
    const alreadyAssigned = c.interviews.some((iv) => iv.interviewerId === supervisor.id && iv.status !== "cancelled");
    if (!alreadyAssigned) {
      await prisma.interview.create({
        data: {
          candidateId: c.id,
          interviewerId: supervisor.id,
          interviewerName: supervisor.name,
          interviewerEmail: supervisor.email,
          durationMins: 45,
          type: "in_person",
          assignedByName: byName,
        },
      });
    }
    handed.push({ id: c.id, name: c.name });
  }

  // One consolidated notification to the supervisor (thread auto-emails them).
  await notifySupervisorAssigned(job, supervisor, handed, deadline).catch(() => {});

  // Courtesy note to the supervisor who was replaced (best-effort).
  if (reassigned && prevSupervisorId) {
    const prev = await prisma.user.findUnique({ where: { id: prevSupervisorId }, select: { email: true, name: true } }).catch(() => null);
    if (prev?.email) {
      const first = (prev.name || "there").split(/\s+/)[0];
      await sendEmail({
        to: prev.email,
        subject: `Interview reassigned: ${job.title}`,
        kind: "interview_reassigned",
        relatedType: "job",
        relatedId: job.id,
        text: `Hi ${first},\n\nYou've been unassigned from interviewing for ${job.title}. ${supervisor.name} is now handling these interviews — no further action is needed on your part. Thank you!\n\n— Canopy OS`,
        html: `<p>Hi ${first},</p><p>You've been unassigned from interviewing for <strong>${job.title}</strong>. <strong>${supervisor.name}</strong> is now handling these interviews — no further action is needed on your part. Thank you!</p><p>— Canopy OS</p>`,
      }).catch(() => {});
    }
  }

  return { handed: handed.length, supervisorName: supervisor.name, reassigned, revoked, previousSupervisorName: prevSupervisorName ?? null };
}

async function notifySupervisorAssigned(
  job: { id: string; title: string; branch: string | null },
  supervisor: { id: string; name: string; email: string | null },
  candidates: { id: string; name: string }[],
  deadline: Date | null,
) {
  const by = deadline ? deadline.toLocaleDateString("en-US", { dateStyle: "full" }) : "as soon as possible";
  const list = candidates.map((c) => `• ${c.name}`).join("\n");
  const href = `/management/people/jobs/${job.id}`;
  const subject = `Interviews to schedule: ${job.title}`;
  const body =
    `Here are your shortlisted candidates ready for in-person interviews for ${job.title}` +
    `${job.branch ? ` (${branchLabel(job.branch)})` : ""} — please schedule by ${by}.\n\n` +
    `${list || "(no candidates yet — HR will move shortlisted candidates into the Interview stage)"}\n\n` +
    `Open the job to log each interview time and complete the standardized questionnaire: ${base()}${href}`;

  const now = new Date();
  const thread = await prisma.thread.create({
    data: {
      subject,
      branch: job.branch,
      contextType: "general",
      contextId: job.id,
      contextLabel: job.title,
      contextHref: href,
      createdByName: "Hiring (HR)",
      updatedAt: now,
      messages: { create: { authorName: "Hiring (HR)", body } },
      participants: supervisor.email
        ? { create: [{ userId: supervisor.id, name: supervisor.name, email: supervisor.email }] }
        : undefined,
    },
  });
  await notifyThread({
    threadId: thread.id,
    subject,
    contextLabel: job.title,
    authorName: "Hiring (HR)",
    authorUserId: null,
    body,
    isNew: true,
  }).catch(() => {});
}

/** Supervisor (or HR) logs the confirmed interview date/time for a candidate. */
export async function logInterviewTime(candidateId: string, when: string | null, supervisorId: string | null) {
  const at = str(when) ? new Date(when!) : null;
  if (!at || Number.isNaN(at.getTime())) throw new Error("Enter a valid interview date and time.");
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!candidate) throw new Error("Candidate not found.");
  await prisma.candidate.update({ where: { id: candidateId }, data: { interviewAt: at } });
  // Also set the assigned supervisor's Interview scheduledAt so the scorecard +
  // calendar links reflect the confirmed time.
  const where = supervisorId
    ? { candidateId, interviewerId: supervisorId, status: { not: "completed" } }
    : { candidateId, status: { not: "completed" } };
  await prisma.interview.updateMany({ where, data: { scheduledAt: at } });
  return { interviewAt: at };
}

/** Jobs whose interview deadline has passed with interviews still incomplete. */
export async function overdueInterviewJobs() {
  const now = new Date();
  const jobs = await prisma.job.findMany({
    where: { status: { in: ACTIVE_JOB_STATUSES }, interviewDeadline: { lt: now } },
    include: { candidates: { where: { stage: "interviewing" }, include: { interviews: true } } },
  });
  return jobs
    .filter((j) => j.candidates.some((c) => c.interviews.every((iv) => iv.status !== "completed")))
    .map((j) => ({ id: j.id, title: j.title, interviewDeadline: j.interviewDeadline }));
}

// ---- Stage 4: forced ranking → selection -----------------------------------

/**
 * Forced ranking (interviewing supervisor). `orderedIds` is the candidate ids in
 * rank order (1st, 2nd, 3rd, …). Requires at least the top 3 — or ALL of them
 * when fewer than 3 remain to be ranked. No-shows must be excluded (interview
 * reason) BEFORE ranking, so only non-excluded interviewed candidates are
 * eligible. On success: stamps interviewRank, moves ranked candidates to
 * "ranked", opens a 48h selection window, and emails HR + CEO + the supervisor.
 */
export async function submitRankings(jobId: string, orderedIds: string[], byName: string | null) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { candidates: true },
  });
  if (!job) throw new Error("Job not found.");

  // Eligible = interviewed candidates not excluded (in interviewing/ranked).
  const eligible = job.candidates.filter((c) => c.stage === "interviewing" || c.stage === "ranked");
  const eligibleIds = new Set(eligible.map((c) => c.id));

  const ranked = orderedIds.map(str).filter((x): x is string => !!x);
  const deduped = [...new Set(ranked)];
  if (deduped.length !== ranked.length) throw new Error("A candidate can't be ranked twice.");
  for (const id of ranked) if (!eligibleIds.has(id)) throw new Error("Only interviewed candidates can be ranked.");

  const required = Math.min(3, eligible.length);
  if (ranked.length < required) {
    throw new Error(
      `Rank at least the top ${required} candidate${required === 1 ? "" : "s"} before submitting.` +
        (eligible.length >= 3 ? " No-shows must be excluded first." : ""),
    );
  }

  const now = new Date();
  const selectionDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Reset ranks for this job's eligible set, then stamp the submitted order.
  await prisma.$transaction([
    prisma.candidate.updateMany({ where: { id: { in: [...eligibleIds] } }, data: { interviewRank: null } }),
    ...ranked.map((id, i) =>
      prisma.candidate.update({ where: { id }, data: { interviewRank: i + 1, stage: "ranked" } }),
    ),
    prisma.job.update({ where: { id: jobId }, data: { selectionDeadline } }),
  ]);

  await notifyRankings(job, ranked, selectionDeadline, byName).catch(() => {});
  return { ranked: ranked.length, selectionDeadline };
}

async function notifyRankings(
  job: { id: string; title: string; branch: string | null; interviewSupervisorName: string | null },
  rankedIds: string[],
  selectionDeadline: Date,
  byName: string | null,
) {
  const cands = await prisma.candidate.findMany({ where: { id: { in: rankedIds } }, select: { id: true, name: true, interviewRank: true } });
  const byId = new Map(cands.map((c) => [c.id, c]));
  const lines = rankedIds.map((id, i) => `${i + 1}. ${byId.get(id)?.name ?? "—"}`).join("\n");
  const href = `/management/people/jobs/${job.id}`;
  const by = selectionDeadline.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
  const subject = `Interview rankings submitted: ${job.title}`;
  const body =
    `${byName ?? job.interviewSupervisorName ?? "The interviewing supervisor"} submitted the ranked shortlist for ${job.title}:\n\n` +
    `${lines}\n\n` +
    `HR has 48 hours (by ${by}) to select the finalist. Open the job to make the selection:\n${base()}${href}`;

  // Recipients: HR director + CEO + the assigned supervisor.
  const hrEmail = await getHrEmail();
  const supervisor = job.interviewSupervisorName
    ? await prisma.user.findFirst({ where: { name: job.interviewSupervisorName }, select: { id: true, name: true, email: true } })
    : null;

  const now = new Date();
  const participants: { userId: string | null; name: string; email: string | null }[] = [];
  const hrUser = await prisma.user.findFirst({ where: { email: hrEmail }, select: { id: true, name: true } });
  participants.push({ userId: hrUser?.id ?? null, name: hrUser?.name ?? "HR", email: hrEmail });
  const ceoUser = await prisma.user.findFirst({ where: { email: CEO_EMAIL }, select: { id: true, name: true } });
  participants.push({ userId: ceoUser?.id ?? null, name: ceoUser?.name ?? "CEO", email: CEO_EMAIL });
  if (supervisor?.email) participants.push({ userId: supervisor.id, name: supervisor.name, email: supervisor.email });

  // Dedupe participants by email; only keep those with an email.
  const seen = new Set<string>();
  const parts = participants.filter((p) => {
    const key = (p.email ?? "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const thread = await prisma.thread.create({
    data: {
      subject,
      branch: job.branch,
      contextType: "general",
      contextId: job.id,
      contextLabel: job.title,
      contextHref: href,
      createdByName: "Hiring (rankings)",
      updatedAt: now,
      messages: { create: { authorName: "Hiring (rankings)", body } },
      participants: parts.length ? { create: parts.map((p) => ({ userId: p.userId, name: p.name, email: p.email })) } : undefined,
    },
  });
  await notifyThread({
    threadId: thread.id,
    subject,
    contextLabel: job.title,
    authorName: "Hiring (rankings)",
    authorUserId: null,
    body,
    isNew: true,
  }).catch(() => {});
}

/**
 * HR selects the finalist from the ranked shortlist. The chosen candidate moves
 * to "selected"; every OTHER ranked candidate on the job is auto-excluded
 * ("Not selected", keepWarm=true) with a warm rejection email. Returns the
 * chosen candidate + how many runner-ups were warm-rejected.
 */
export async function selectFinalist(candidateId: string, byName: string | null) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { job: { select: { id: true, title: true, applyToken: true } } },
  });
  if (!candidate) throw new Error("Candidate not found.");
  if (candidate.stage !== "ranked") throw new Error("Only a ranked candidate can be selected.");

  const now = new Date();
  await prisma.candidate.update({
    where: { id: candidateId },
    data: { stage: "selected", selectedAt: now, selectedByName: byName },
  });

  // Auto-exclude the other ranked candidates on the same job (warm).
  const runnerUps = candidate.jobId
    ? await prisma.candidate.findMany({ where: { jobId: candidate.jobId, stage: "ranked", id: { not: candidateId } } })
    : [];
  for (const r of runnerUps) {
    await prisma.candidate.update({
      where: { id: r.id },
      data: {
        stage: "excluded",
        excludedReason: "Not selected",
        excludedStage: "interviewing",
        excludedAt: now,
        excludedByName: byName,
        keepWarm: true,
      },
    });
    await sendWarmRejection(r, candidate.job?.title ?? null, candidate.job?.applyToken).catch(() => {});
  }

  return { selectedName: candidate.name, warmRejected: runnerUps.length };
}

async function sendWarmRejection(
  candidate: { id: string; firstName: string | null; name: string; email: string },
  jobTitle: string | null,
  applyToken?: string | null,
) {
  const first = (candidate.firstName || candidate.name || "there").split(/\s+/)[0];
  const role = jobTitle ? ` for the ${jobTitle} position` : "";
  const dm = demoMail(applyToken, candidate.email);
  const subject = `${dm.subjectPrefix}An update on your application${jobTitle ? ` — ${jobTitle}` : ""} at Clements Pest Control`;
  const text = [
    dm.bannerText,
    `Hi ${first},`,
    "",
    `Thank you so much for taking the time to speak with us on your screening call and to meet with our team for your interview${role}. We genuinely enjoyed getting to know you.`,
    "",
    `After careful consideration, we've decided to move forward with another qualified applicant for this particular role. This was a difficult decision — you have a lot to offer.`,
    "",
    `We'd truly welcome the chance to reconnect about future opportunities at Clements, and we hope you'll keep us in mind. Please don't hesitate to reach back out.`,
    "",
    "With appreciation and best wishes,",
    "The Clements Pest Control Hiring Team",
  ].join("\n");
  const html = [
    `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#0f3d2c">`,
    dm.bannerHtml,
    `<p>Hi ${first},</p>`,
    `<p>Thank you so much for taking the time to speak with us on your screening call and to meet with our team for your interview${role}. We genuinely enjoyed getting to know you.</p>`,
    `<p>After careful consideration, we've decided to move forward with another qualified applicant for this particular role. This was a difficult decision &mdash; you have a lot to offer.</p>`,
    `<p>We'd truly welcome the chance to reconnect about future opportunities at Clements, and we hope you'll keep us in mind. Please don't hesitate to reach back out.</p>`,
    `<p style="margin-top:18px">With appreciation and best wishes,<br/>The Clements Pest Control Hiring Team</p>`,
    `</div>`,
  ].join("");
  return sendEmail({
    to: applicantMailTo(candidate.email, applyToken),
    subject,
    kind: "warm_rejection",
    relatedType: "candidate",
    relatedId: candidate.id,
    text,
    html,
  });
}
