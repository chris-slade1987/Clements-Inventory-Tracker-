import { PrismaClient } from "@prisma/client";

// Deterministic fixture for the ATS applicant-pipeline smoke. Creates a clean
// E2E job with candidates spread across stages + an assignable supervisor, and
// clears any rows from a prior run so assertions start fresh. Emits env lines
// (KEY=VALUE) the spec reads via process.env.
const p = new PrismaClient();

const TOKEN = "e2e-pipeline-token";
const TITLE = "E2E Pipeline Tech (Smoke)";
const SCREENING_URL_KEY = "hr_screening_booking_url";

const CANDS = [
  { key: "APPLIED_A", first: "Ada", last: "Applied", stage: "applied" },
  { key: "APPLIED_B", first: "Ben", last: "Applied", stage: "applied" },
  { key: "SCREEN_1", first: "Cara", last: "Screen", stage: "screening" },
  { key: "NOSHOW", first: "Nate", last: "Noshow", stage: "interviewing" },
  { key: "INT_1", first: "Iris", last: "Interview", stage: "interviewing" },
  { key: "INT_2", first: "Ivan", last: "Interview", stage: "interviewing" },
  { key: "INT_3", first: "Ida", last: "Interview", stage: "interviewing" },
];

const email = (first: string, last: string) => `${first}.${last}@e2e-pipeline.example`.toLowerCase();

(async () => {
  // Clean slate: drop the job (cascades candidates+interviews) + threads + logs.
  const prior = await p.job.findUnique({ where: { applyToken: TOKEN }, select: { id: true } });
  if (prior) await p.job.delete({ where: { id: prior.id } });
  await p.candidate.deleteMany({ where: { email: { endsWith: "@e2e-pipeline.example" } } });
  await p.thread.deleteMany({ where: { contextLabel: { contains: TITLE } } });
  await p.emailLog.deleteMany({ where: { kind: { in: ["screening_request", "warm_rejection"] }, to: { endsWith: "@e2e-pipeline.example" } } });

  // A screening booking link so "Request screening call" emails a link.
  await p.setting.upsert({
    where: { key: SCREENING_URL_KEY },
    update: { value: "https://calendar.google.com/calendar/appointments/schedules/E2E" },
    create: { key: SCREENING_URL_KEY, value: "https://calendar.google.com/calendar/appointments/schedules/E2E" },
  });

  // A manager to assign as the interviewing supervisor.
  const supervisor = await p.user.findFirst({ where: { active: true, role: "manager" }, select: { id: true, name: true, email: true } });

  const job = await p.job.create({
    data: {
      title: TITLE,
      branch: "vero",
      openings: 1,
      description: "E2E smoke — applicant pipeline.",
      status: "open",
      applyToken: TOKEN,
      createdByName: "E2E Setup",
    },
  });

  const out: string[] = [`E2E_JOB_ID=${job.id}`, `E2E_JOB_TITLE=${TITLE}`, `E2E_SUPERVISOR_NAME=${supervisor?.name ?? ""}`];
  for (const c of CANDS) {
    const rec = await p.candidate.create({
      data: {
        jobId: job.id,
        name: `${c.first} ${c.last}`,
        firstName: c.first,
        lastName: c.last,
        email: email(c.first, c.last),
        phone: "(772) 555-0000",
        source: "E2E",
        stage: c.stage,
        createdByName: "E2E Setup",
      },
    });
    out.push(`E2E_${c.key}_ID=${rec.id}`);
  }

  console.error(`setup-pipeline: job ${job.id}, ${CANDS.length} candidates, supervisor ${supervisor?.name ?? "(none)"}.`);
  console.log(out.join("\n"));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
