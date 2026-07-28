import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { seedHiringTemplates } from "../prisma/seed-hiring-templates";

// Deterministic fixture for the Hiring Template Library smoke. Ensures the off-
// the-shelf templates + bank exist, then builds a clean E2E job with a
// candidate in the interview stage, an Interview assigned to a NON-HR manager
// (so we can verify the supervisor can FILL but not EDIT templates), and emits
// env lines the spec reads.
const p = new PrismaClient();

const TOKEN = "e2e-templates-token";
const TITLE = "E2E Templates Tech (Smoke)";
const MGR_EMAIL = "e2e-templates-mgr@e2e-templates.example";
const MGR_PASSWORD = "clements123";

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

(async () => {
  const seed = await seedHiringTemplates(p);

  // Clean slate for this fixture's job + manager.
  const prior = await p.job.findUnique({ where: { applyToken: TOKEN }, select: { id: true } });
  if (prior) await p.job.delete({ where: { id: prior.id } });
  await p.candidate.deleteMany({ where: { email: { endsWith: "@e2e-templates.example" } } });

  // A non-HR branch manager login (role manager, hrAccess false) — may fill an
  // assigned questionnaire but must NOT reach the template editor.
  const mgr = await p.user.upsert({
    where: { email: MGR_EMAIL },
    update: { active: true, role: "manager", hrAccess: false, passwordHash: hashPassword(MGR_PASSWORD) },
    create: { name: "E2E Templates Manager", email: MGR_EMAIL, role: "manager", branch: "vero", hrAccess: false, active: true, passwordHash: hashPassword(MGR_PASSWORD) },
  });

  const job = await p.job.create({
    data: { title: TITLE, branch: "vero", openings: 1, description: "E2E smoke — hiring templates.", status: "open", applyToken: TOKEN, createdByName: "E2E Setup" },
  });

  const candidate = await p.candidate.create({
    data: { jobId: job.id, name: "Tess Template", firstName: "Tess", lastName: "Template", email: "tess.template@e2e-templates.example", phone: "(772) 555-0000", source: "E2E", stage: "interviewing", createdByName: "E2E Setup" },
  });

  const interview = await p.interview.create({
    data: { candidateId: candidate.id, interviewerId: mgr.id, interviewerName: mgr.name, interviewerEmail: mgr.email, durationMins: 45, type: "in_person", status: "scheduled", assignedByName: "E2E Setup" },
  });

  const out = [
    `E2E_TT_JOB_ID=${job.id}`,
    `E2E_TT_INTERVIEW_ID=${interview.id}`,
    `E2E_TT_MGR_EMAIL=${MGR_EMAIL}`,
    `E2E_TT_MGR_PASSWORD=${MGR_PASSWORD}`,
    `E2E_TT_TEMPLATE_NAME=Pest Technician (field) interview`,
  ];
  console.error(`setup-hiring-templates: seeded ${seed.templatesCreated} templates (${seed.templatesSkipped} present), ${seed.bankUpserted} bank; job ${job.id}, interview ${interview.id}, mgr ${mgr.id}.`);
  console.log(out.join("\n"));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
