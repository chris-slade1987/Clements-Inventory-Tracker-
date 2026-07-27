import { PrismaClient } from "@prisma/client";

// Deterministic fixture for the public job-application intake smoke. Ensures an
// OPEN job and a CLOSED job with fixed apply tokens, and clears any candidates /
// notification threads / email logs from a prior run so assertions are clean.
const p = new PrismaClient();

const OPEN_TOKEN = "e2e-open-apply-token";
const CLOSED_TOKEN = "e2e-closed-apply-token";
const OPEN_TITLE = "E2E Field Technician (Apply Test)";
const TEST_EMAILS = [
  "e2e.applicant.indeed@example.com",
  "e2e.applicant.website@example.com",
  "e2e.applicant.honeypot@example.com",
];

(async () => {
  // Clean slate for the test candidates + their notifications/logs.
  await p.candidate.deleteMany({ where: { email: { in: TEST_EMAILS } } });
  await p.emailLog.deleteMany({ where: { kind: "applicant_confirmation", to: { in: TEST_EMAILS } } });
  const staleThreads = await p.thread.findMany({
    where: { subject: { startsWith: "New applicant:" }, contextLabel: { contains: OPEN_TITLE } },
    select: { id: true },
  });
  if (staleThreads.length) await p.thread.deleteMany({ where: { id: { in: staleThreads.map((t) => t.id) } } });

  const open = await p.job.upsert({
    where: { applyToken: OPEN_TOKEN },
    update: { status: "open", title: OPEN_TITLE },
    create: {
      title: OPEN_TITLE,
      branch: "vero",
      openings: 2,
      description: "Service residential and commercial accounts across the Treasure Coast. We provide the truck, the training, and the tools.",
      status: "open",
      applyToken: OPEN_TOKEN,
      createdByName: "E2E Setup",
    },
  });

  await p.job.upsert({
    where: { applyToken: CLOSED_TOKEN },
    update: { status: "closed" },
    create: {
      title: "E2E Closed Role (Apply Test)",
      branch: "stuart",
      openings: 1,
      status: "closed",
      applyToken: CLOSED_TOKEN,
      createdByName: "E2E Setup",
    },
  });

  console.error(`setup-apply: open job ${open.id} (${OPEN_TOKEN}); closed job (${CLOSED_TOKEN}); cleared ${staleThreads.length} threads.`);
  console.log(
    [
      `OPEN_APPLY_TOKEN=${OPEN_TOKEN}`,
      `CLOSED_APPLY_TOKEN=${CLOSED_TOKEN}`,
      `OPEN_JOB_ID=${open.id}`,
      `OPEN_JOB_TITLE=${OPEN_TITLE}`,
    ].join("\n"),
  );
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
