import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// ATS applicant-pipeline smoke. Drives the demo/E2E job end to end as HR/admin
// (who may operate every step), asserting DB state at each boundary. Runs
// against the production build on :3100. Serial + single big test because the
// walkthrough is inherently stateful.
const prisma = new PrismaClient();

const ADMIN = { email: "manager@clementspest.com", password: "clements123" };
const JOB_ID = process.env.E2E_JOB_ID ?? "";
const SUPERVISOR = process.env.E2E_SUPERVISOR_NAME ?? "";
const ids = {
  appliedA: process.env.E2E_APPLIED_A_ID ?? "",
  appliedB: process.env.E2E_APPLIED_B_ID ?? "",
  screen1: process.env.E2E_SCREEN_1_ID ?? "",
  noshow: process.env.E2E_NOSHOW_ID ?? "",
  int1: process.env.E2E_INT_1_ID ?? "",
};

test.afterAll(async () => { await prisma.$disconnect(); });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(ADMIN.email);
  await page.locator('input[type="password"]').fill(ADMIN.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

test("applicant pipeline: shortlist → screening → interview → ranking → selection → pre-hire", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page);

  const cand = (id: string) => `/management/people/candidates/${id}`;
  const jobUrl = `/management/people/jobs/${JOB_ID}`;

  // --- 1. Stage-specific exclusion reasons (application stage) ---------------
  await page.goto(cand(ids.appliedA));
  await page.getByRole("button", { name: "Exclude candidate" }).click();
  await expect(page.getByTestId("exclude-reason")).toBeVisible();
  const appReasons = await page.getByTestId("exclude-reason").locator("option").allTextContents();
  expect(appReasons).toContain("Position filled");
  expect(appReasons).not.toContain("No-show"); // interview-only reason
  await page.getByRole("button", { name: "Cancel" }).click();

  // --- 2. Shortlist an applied candidate → screening ------------------------
  await page.getByRole("button", { name: "Shortlist → Screening" }).click();
  await expect.poll(async () => (await prisma.candidate.findUnique({ where: { id: ids.appliedA } }))!.stage).toBe("screening");

  // --- 3. Exclude with an application reason → Excluded archive -------------
  await page.goto(cand(ids.appliedB));
  await page.getByRole("button", { name: "Exclude candidate" }).click();
  await page.getByTestId("exclude-reason").selectOption("Position filled");
  await page.getByRole("button", { name: "Confirm exclude" }).click();
  await expect.poll(async () => (await prisma.candidate.findUnique({ where: { id: ids.appliedB } }))!.stage).toBe("excluded");
  const exB = await prisma.candidate.findUnique({ where: { id: ids.appliedB } });
  expect(exB!.excludedReason).toBe("Position filled");
  expect(exB!.excludedStage).toBe("applied");
  await page.goto("/management/people/excluded");
  await expect(page.getByText("Ben Applied")).toBeVisible();

  // --- 4. Screening: request call (email) + notes + complete ----------------
  await page.goto(cand(ids.screen1));
  await page.getByRole("button", { name: "Request screening call" }).click();
  await expect.poll(async () => prisma.emailLog.count({ where: { kind: "screening_request" } })).toBeGreaterThan(0);
  await page.locator("textarea").first().fill("Solid phone screen — available immediately, clean record.");
  await page.getByRole("button", { name: "Save & mark call complete" }).click();
  await expect.poll(async () => !!(await prisma.candidate.findUnique({ where: { id: ids.screen1 } }))!.screeningCompletedAt).toBe(true);

  // --- 5. Interview handoff: assign supervisor + deadline (notify thread) ----
  await page.goto(jobUrl);
  await page.getByTestId("supervisor-select").selectOption({ label: SUPERVISOR });
  await page.getByTestId("deadline-input").fill("2026-08-15");
  await page.getByRole("button", { name: "Assign & notify supervisor" }).click();
  await expect.poll(async () => (await prisma.job.findUnique({ where: { id: JOB_ID } }))!.interviewSupervisorId).not.toBeNull();
  await expect.poll(async () => prisma.thread.count({ where: { subject: { startsWith: "Interviews to schedule" } } })).toBeGreaterThan(0);

  // --- 6. Interview-stage exclude offers No-show; exclude the no-show --------
  await page.goto(cand(ids.noshow));
  await page.getByRole("button", { name: /Exclude/ }).first().click();
  await expect(page.getByTestId("exclude-reason")).toBeVisible();
  const intReasons = await page.getByTestId("exclude-reason").locator("option").allTextContents();
  expect(intReasons).toContain("No-show");
  await page.getByTestId("exclude-reason").selectOption("No-show");
  await page.getByRole("button", { name: "Confirm exclude" }).click();
  await expect.poll(async () => (await prisma.candidate.findUnique({ where: { id: ids.noshow } }))!.stage).toBe("excluded");
  expect((await prisma.candidate.findUnique({ where: { id: ids.noshow } }))!.excludedReason).toBe("No-show");

  // --- 7. Log an interview time + save a questionnaire ----------------------
  await page.goto(cand(ids.int1));
  await page.locator('input[type="datetime-local"]').first().fill("2026-08-10T10:00");
  await page.getByRole("button", { name: "Log time" }).click();
  await expect.poll(async () => !!(await prisma.candidate.findUnique({ where: { id: ids.int1 } }))!.interviewAt).toBe(true);

  const iv = await prisma.interview.findFirst({ where: { candidateId: ids.int1 } });
  expect(iv, "supervisor interview created").not.toBeNull();
  await page.goto(`/me/interviews/${iv!.id}`);
  await page.getByRole("button", { name: "3 · Meets" }).first().click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect.poll(async () => (await prisma.interview.findUnique({ where: { id: iv!.id } }))!.responses).toContain("competencies");

  // --- 8. Forced ranking: blocked without top-3, then rank top 3 ------------
  await page.goto(jobUrl);
  const rankSelects = page.getByTestId("rank-select");
  await expect.poll(async () => rankSelects.count()).toBe(3); // int1/int2/int3, no-show excluded
  await rankSelects.nth(0).selectOption("1");
  await page.getByRole("button", { name: /Submit rankings|Re-submit rankings/ }).click();
  await expect(page.getByText(/Rank at least the top 3/)).toBeVisible();
  expect((await prisma.job.findUnique({ where: { id: JOB_ID } }))!.selectionDeadline).toBeNull();

  await rankSelects.nth(1).selectOption("2");
  await rankSelects.nth(2).selectOption("3");
  await page.getByRole("button", { name: /Submit rankings|Re-submit rankings/ }).click();
  await expect.poll(async () => (await prisma.job.findUnique({ where: { id: JOB_ID } }))!.selectionDeadline).not.toBeNull();
  await expect.poll(async () => prisma.candidate.count({ where: { jobId: JOB_ID, stage: "ranked" } })).toBe(3);
  await expect.poll(async () => prisma.thread.count({ where: { subject: { startsWith: "Interview rankings submitted" } } })).toBeGreaterThan(0);

  // --- 9. HR selects the finalist; runner-ups auto warm-rejected ------------
  const finalist = await prisma.candidate.findFirst({ where: { jobId: JOB_ID, interviewRank: 1 } });
  expect(finalist).not.toBeNull();
  await page.goto(cand(finalist!.id));
  await page.getByRole("button", { name: "Select as finalist" }).click();
  await expect.poll(async () => (await prisma.candidate.findUnique({ where: { id: finalist!.id } }))!.stage).toBe("selected");
  const runnerUps = await prisma.candidate.findMany({ where: { jobId: JOB_ID, stage: "excluded", excludedReason: "Not selected" } });
  expect(runnerUps.length).toBe(2);
  expect(runnerUps.every((c) => c.keepWarm)).toBe(true);
  await expect.poll(async () => prisma.emailLog.count({ where: { kind: "warm_rejection" } })).toBeGreaterThanOrEqual(2);

  // --- 10. Reactivate one excluded runner-up from the archive ---------------
  await page.goto("/management/people/excluded");
  const row = page.locator("tr", { hasText: runnerUps[0].name });
  await row.getByRole("button", { name: "Reactivate" }).click();
  await row.locator("select").selectOption("interviewing");
  await row.getByRole("button", { name: "Go" }).click();
  await expect.poll(async () => (await prisma.candidate.findUnique({ where: { id: runnerUps[0].id } }))!.stage).toBe("interviewing");
  expect((await prisma.candidate.findUnique({ where: { id: runnerUps[0].id } }))!.excludedReason).toBeNull();

  // --- 11. Move the selected finalist to pre-hire (boundary) ----------------
  await page.goto(cand(finalist!.id));
  await page.getByRole("button", { name: "Move to pre-hire" }).click();
  await expect.poll(async () => !!(await prisma.candidate.findUnique({ where: { id: finalist!.id } }))!.preHireId).toBe(true);
  expect((await prisma.candidate.findUnique({ where: { id: finalist!.id } }))!.stage).toBe("pre_hire");
});
