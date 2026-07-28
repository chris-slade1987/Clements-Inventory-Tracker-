import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Hiring Template Library smoke. Runs against the production build on :3100
// WITHOUT an Anthropic key, so it also asserts the AI-assist graceful no-key
// path. Serial + single stateful test.
const prisma = new PrismaClient();

const ADMIN = { email: "manager@clementspest.com", password: "clements123" };
const JOB_ID = process.env.E2E_TT_JOB_ID ?? "";
const INTERVIEW_ID = process.env.E2E_TT_INTERVIEW_ID ?? "";
const MGR = { email: process.env.E2E_TT_MGR_EMAIL ?? "", password: process.env.E2E_TT_MGR_PASSWORD ?? "" };
const TEMPLATE_NAME = process.env.E2E_TT_TEMPLATE_NAME ?? "Pest Technician (field) interview";
// A distinctive phrase from that template's first competency question.
const QUESTION_PHRASE = "bad weather, a long day, short-staffed";
const NEW_TEMPLATE_NAME = `E2E Custom Interview ${Date.now()}`;

test.afterAll(async () => { await prisma.$disconnect(); });

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

test("hiring template library: list, build, AI no-key, assign, render, access", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, ADMIN);

  // --- 1. Library lists seeded interview + screening templates ---------------
  await page.goto("/management/people/hiring-templates");
  await expect(page.getByRole("link", { name: TEMPLATE_NAME })).toBeVisible();
  await expect(page.getByRole("link", { name: "General screening call (default)" })).toBeVisible();

  // --- 2. Open the editor; AI-assist shows the graceful no-key message -------
  await page.goto("/management/people/hiring-templates/new?kind=interview");
  await page.getByTestId("tpl-name").fill(NEW_TEMPLATE_NAME);
  await page.getByTestId("ai-open").click();
  await page.getByTestId("ai-intent").fill("how they handle an upset customer at the door");
  await page.getByTestId("ai-run").click();
  await expect(page.getByTestId("ai-message")).toContainText("off-the-shelf", { timeout: 15_000 });
  // Also assert the endpoint itself returns 200 (never 500) with no key.
  const aiRes = await page.request.post("/api/hiring/ai-questions", { data: { kind: "interview", role: "technician", intent: "reliability" } });
  expect([200, 401]).toContain(aiRes.status()); // never 500
  await page.getByRole("button", { name: "Done" }).click();

  // --- 3. Build the template: bank + custom + reorder + save -----------------
  // Insert one question from the off-the-shelf bank.
  await page.getByRole("button", { name: "From the off-the-shelf bank" }).click();
  await expect(page.getByTestId("bank-item").first()).toBeVisible();
  await page.getByTestId("bank-insert").first().click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("tpl-question")).toHaveCount(1);
  // Add one custom question and fill its text.
  await page.getByRole("button", { name: "Custom question" }).click();
  await expect(page.getByTestId("tpl-question")).toHaveCount(2);
  await page.getByTestId("tpl-question").nth(1).locator("textarea").fill("Custom: tell me about a time you fixed a callback.");
  // Reorder: move the custom question up.
  await page.getByTestId("tpl-question").nth(1).getByTestId("q-up").click();
  await page.getByTestId("tpl-save").click();
  await page.waitForURL(/\/hiring-templates\/[a-z0-9]+$/i, { timeout: 15_000 });
  const created = await prisma.hiringTemplate.findFirst({ where: { name: NEW_TEMPLATE_NAME }, include: { questions: true } });
  expect(created, "new template persisted").not.toBeNull();
  expect(created!.questions.length).toBe(2);
  expect(created!.questions.some((q) => q.text.startsWith("Custom:"))).toBe(true);

  // --- 4. Assign a seeded template to the job + confirm the fill renders it ---
  await page.goto(`/management/people/jobs/${JOB_ID}`);
  await page.getByTestId("job-interview-template").selectOption({ label: `${TEMPLATE_NAME}` });
  await page.getByRole("button", { name: "Save templates" }).click();
  await expect.poll(async () => (await prisma.job.findUnique({ where: { id: JOB_ID } }))!.interviewTemplateId).not.toBeNull();

  await page.goto(`/me/interviews/${INTERVIEW_ID}`);
  await expect(page.getByText(TEMPLATE_NAME, { exact: false })).toBeVisible();
  await expect(page.getByText(QUESTION_PHRASE, { exact: false })).toBeVisible();

  // --- 5. A non-HR manager cannot open the editor but can fill the form ------
  await page.context().clearCookies();
  await login(page, MGR);
  await page.goto("/management/people/hiring-templates");
  // Redirected away from the HR-only library (no editor content).
  await expect(page).not.toHaveURL(/\/hiring-templates/);
  await expect(page.getByRole("link", { name: TEMPLATE_NAME })).toHaveCount(0);
  // But the assigned questionnaire renders for the interviewing manager.
  await page.goto(`/me/interviews/${INTERVIEW_ID}`);
  await expect(page.getByText(QUESTION_PHRASE, { exact: false })).toBeVisible();
});
