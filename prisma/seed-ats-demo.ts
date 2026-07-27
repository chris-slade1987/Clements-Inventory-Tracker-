import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// [DEMO] ATS applicant-pipeline walkthrough data. Idempotent + clearly labeled
// so the CEO can walk shortlist → screening → interview → ranking → selection →
// pre-hire live, and so it's trivially removable. Keyed by a stable applyToken
// marker on the job + obviously-fake @example.com candidate emails. Creates NO
// stock movements and never touches real hiring data.
//
// Spread (per spec): 2 Applied · 1 Screening (booking requested) · 1 Screening
// completed (with notes) · 2 Interview (one with a logged time + partial
// questionnaire) · 1 Excluded (no-show).
// ---------------------------------------------------------------------------

const DEMO_TOKEN = "demo-ats-pipeline";
const DEMO_TITLE = "[DEMO] Service Technician — Vero Beach";
const SCREENING_URL_KEY = "hr_screening_booking_url";
const DEMO_BOOKING_URL =
  "https://calendar.google.com/calendar/appointments/schedules/DEMO_CLEMENTS_SCREENING";

type DemoCand = {
  first: string;
  last: string;
  phone: string;
  source: string;
  stage: string;
  notes?: string;
  screeningRequestedAt?: boolean;
  screeningCompletedAt?: boolean;
  screeningNotes?: string;
  interviewAt?: Date | null;
  excludedReason?: string;
  excludedStage?: string;
  interview?: "none" | "partial"; // create an assigned interview (partial scorecard)
};

export async function seedAtsDemo(prisma: PrismaClient) {
  const now = new Date();
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 864e5);

  // Set a demo screening booking link ONLY if HR hasn't set a real one.
  const existingUrl = await prisma.setting.findUnique({ where: { key: SCREENING_URL_KEY } }).catch(() => null);
  if (!existingUrl) {
    await prisma.setting.upsert({
      where: { key: SCREENING_URL_KEY },
      update: { value: DEMO_BOOKING_URL },
      create: { key: SCREENING_URL_KEY, value: DEMO_BOOKING_URL },
    });
  }

  // A Vero manager makes the most realistic interviewing supervisor; fall back
  // to any manager, then an admin, so the demo always has a supervisor.
  const supervisor =
    (await prisma.user.findFirst({ where: { active: true, role: "manager", branch: "vero" }, select: { id: true, name: true, email: true } })) ??
    (await prisma.user.findFirst({ where: { active: true, role: "manager" }, select: { id: true, name: true, email: true } })) ??
    (await prisma.user.findFirst({ where: { active: true, role: "admin" }, select: { id: true, name: true, email: true } }));

  // Upsert the demo job by its stable apply-token marker.
  const job = await prisma.job.upsert({
    where: { applyToken: DEMO_TOKEN },
    update: {
      title: DEMO_TITLE,
      status: "open",
      branch: "vero",
      openings: 1,
      interviewSupervisorId: supervisor?.id ?? null,
      interviewSupervisorName: supervisor?.name ?? null,
      interviewDeadline: daysFromNow(7),
    },
    create: {
      title: DEMO_TITLE,
      branch: "vero",
      openings: 1,
      description:
        "DEMO POSTING — walkthrough of the full applicant pipeline. Service residential and commercial accounts across the Treasure Coast. Safe to delete.",
      status: "open",
      applyToken: DEMO_TOKEN,
      hiringManagerName: "Demo Walkthrough",
      interviewSupervisorId: supervisor?.id ?? null,
      interviewSupervisorName: supervisor?.name ?? null,
      interviewDeadline: daysFromNow(7),
      createdByName: "ATS demo seed",
    },
  });

  const cands: DemoCand[] = [
    { first: "Avery", last: "Nguyen", phone: "(772) 555-0101", source: "Indeed", stage: "applied", notes: "Applied via Indeed. 3 yrs lawn care." },
    { first: "Marcus", last: "Bell", phone: "(772) 555-0102", source: "Company Website", stage: "applied", notes: "Applied via careers page." },
    { first: "Priya", last: "Shah", phone: "(772) 555-0103", source: "Referral", stage: "screening", screeningRequestedAt: true, notes: "Shortlisted; screening call booking link sent." },
    {
      first: "Diego", last: "Ramos", phone: "(772) 555-0104", source: "Indeed", stage: "screening",
      screeningRequestedAt: true, screeningCompletedAt: true,
      screeningNotes: "Great phone screen. Available immediately, has a clean driving record, comfortable with outdoor/physical work. Recommend in-person interview.",
      notes: "Screening completed.",
    },
    {
      first: "Sofia", last: "Martinez", phone: "(772) 555-0105", source: "Referral", stage: "interviewing",
      interviewAt: daysFromNow(2), interview: "partial",
      notes: "Interview scheduled; supervisor started the questionnaire.",
    },
    {
      first: "Jordan", last: "Pike", phone: "(772) 555-0106", source: "Company Website", stage: "interviewing",
      interview: "none",
      notes: "Interview to be scheduled by supervisor.",
    },
    {
      first: "Riley", last: "Coates", phone: "(772) 555-0107", source: "Indeed", stage: "excluded",
      excludedReason: "No-show", excludedStage: "interviewing",
      notes: "Did not show for the scheduled interview.",
    },
  ];

  const { INTERVIEW_TEMPLATE } = await import("../lib/ats-config");
  const partialResponses = JSON.stringify({
    competencies: {
      [INTERVIEW_TEMPLATE.competencies[0].key]: { rating: 4, notes: "Strong, reliable answers." },
      [INTERVIEW_TEMPLATE.competencies[1].key]: { rating: 4 },
    },
    basics: { license: "yes", transportation: "yes" },
  });

  let created = 0;
  let updated = 0;
  for (const c of cands) {
    const email = `${c.first}.${c.last}@example.com`.toLowerCase();
    const name = `${c.first} ${c.last}`;
    const existing = await prisma.candidate.findFirst({ where: { email, jobId: job.id }, select: { id: true } });
    const data = {
      jobId: job.id,
      name,
      firstName: c.first,
      lastName: c.last,
      email,
      phone: c.phone,
      source: c.source,
      notes: c.notes ?? null,
      stage: c.stage,
      screeningRequestedAt: c.screeningRequestedAt ? daysFromNow(-3) : null,
      screeningCompletedAt: c.screeningCompletedAt ? daysFromNow(-1) : null,
      screeningNotes: c.screeningNotes ?? null,
      interviewAt: c.interviewAt ?? null,
      excludedReason: c.excludedReason ?? null,
      excludedStage: c.excludedStage ?? null,
      excludedAt: c.excludedReason ? daysFromNow(-1) : null,
      excludedByName: c.excludedReason ? "ATS demo seed" : null,
      createdByName: "ATS demo seed",
    };

    let candId: string;
    if (existing) {
      await prisma.candidate.update({ where: { id: existing.id }, data });
      candId = existing.id;
      updated++;
    } else {
      const rec = await prisma.candidate.create({ data });
      candId = rec.id;
      created++;
    }

    // Interview + partial questionnaire for the flagged interview-stage candidate.
    if (c.interview && c.interview !== "none" && supervisor) {
      const iv = await prisma.interview.findFirst({ where: { candidateId: candId, interviewerId: supervisor.id }, select: { id: true } });
      const ivData = {
        candidateId: candId,
        interviewerId: supervisor.id,
        interviewerName: supervisor.name,
        interviewerEmail: supervisor.email,
        scheduledAt: c.interviewAt ?? null,
        durationMins: 45,
        type: "in_person",
        status: "scheduled",
        responses: partialResponses,
        assignedByName: "ATS demo seed",
      };
      if (iv) await prisma.interview.update({ where: { id: iv.id }, data: ivData });
      else await prisma.interview.create({ data: ivData });
    }
  }

  return { jobId: job.id, applyToken: DEMO_TOKEN, created, updated, supervisor: supervisor?.name ?? null };
}
