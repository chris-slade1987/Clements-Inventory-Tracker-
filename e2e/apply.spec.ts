import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Public job-application intake ("apply front door") smoke. Runs against the
// production build on :3100. The apply page + API are PUBLIC (no auth); we drive
// the browser for the UI flows and query the DB directly (Playwright specs run
// in Node) to assert the Candidate is created, linked, and sourced correctly.
const prisma = new PrismaClient();

const OPEN_TOKEN = process.env.OPEN_APPLY_TOKEN ?? "e2e-open-apply-token";
const CLOSED_TOKEN = process.env.CLOSED_APPLY_TOKEN ?? "e2e-closed-apply-token";
const OPEN_JOB_ID = process.env.OPEN_JOB_ID ?? "";
const OPEN_JOB_TITLE = process.env.OPEN_JOB_TITLE ?? "E2E Field Technician (Apply Test)";

const ADMIN = { email: "manager@clementspest.com", password: "clements123" };
const RESUME = { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e test résumé\n") };

test.afterAll(async () => { await prisma.$disconnect(); });

async function fillAndSubmit(page: Page, token: string, src: string, applicant: { first: string; last: string; phone: string; email: string }) {
  await page.goto(`/apply/${token}${src ? `?src=${src}` : ""}`);
  await expect(page.getByRole("heading", { name: OPEN_JOB_TITLE })).toBeVisible();
  await page.locator('input[autocomplete="given-name"]').fill(applicant.first);
  await page.locator('input[autocomplete="family-name"]').fill(applicant.last);
  await page.locator('input[autocomplete="tel"]').fill(applicant.phone);
  await page.locator('input[autocomplete="email"]').fill(applicant.email);
  await page.locator('input[type="file"]').setInputFiles(RESUME);
  await page.getByRole("button", { name: "Submit application" }).click();
}

test("public apply (no auth, ?src=indeed) creates a linked Candidate + confirmation + HR notification", async ({ page }) => {
  const email = "e2e.applicant.indeed@example.com";
  await fillAndSubmit(page, OPEN_TOKEN, "indeed", { first: "Casey", last: "Rivera", phone: "(772) 555-0142", email });

  await expect(page.getByRole("heading", { name: "Application received" })).toBeVisible({ timeout: 15_000 });

  // Candidate created, linked to the job, sourced from the Indeed channel.
  const c = await prisma.candidate.findFirst({ where: { email } });
  expect(c, "candidate created").not.toBeNull();
  expect(c!.jobId).toBe(OPEN_JOB_ID);
  expect(c!.stage).toBe("applied");
  expect(c!.source).toBe("Indeed");
  expect(c!.firstName).toBe("Casey");
  expect(c!.lastName).toBe("Rivera");
  expect(c!.name).toBe("Casey Rivera");
  expect(c!.resumePath, "résumé stored").toBeTruthy();

  // Confirmation-email path invoked (logged even when no provider is configured).
  const mail = await prisma.emailLog.findFirst({ where: { kind: "applicant_confirmation", to: email } });
  expect(mail, "applicant confirmation email logged").not.toBeNull();

  // HR / supervisor notification thread created.
  const thread = await prisma.thread.findFirst({ where: { subject: { startsWith: `New applicant: Casey Rivera` } } });
  expect(thread, "HR notification thread created").not.toBeNull();
});

test("?src=website maps the source to Company Website", async ({ page }) => {
  const email = "e2e.applicant.website@example.com";
  await fillAndSubmit(page, OPEN_TOKEN, "website", { first: "Jordan", last: "Blake", phone: "(772) 555-0188", email });
  await expect(page.getByRole("heading", { name: "Application received" })).toBeVisible({ timeout: 15_000 });

  const c = await prisma.candidate.findFirst({ where: { email } });
  expect(c!.source).toBe("Company Website");
  expect(c!.jobId).toBe(OPEN_JOB_ID);
});

test("honeypot silently drops spam (200, no candidate)", async ({ page }) => {
  const email = "e2e.applicant.honeypot@example.com";
  await page.goto(`/apply/${OPEN_TOKEN}`);
  const status = await page.evaluate(async ({ token, email }) => {
    const fd = new FormData();
    fd.set("token", token);
    fd.set("firstName", "Bot");
    fd.set("lastName", "Spam");
    fd.set("phone", "0000000000");
    fd.set("email", email);
    fd.set("website", "http://spam.example"); // honeypot filled
    fd.set("resume", new File([new Blob(["x"])], "r.pdf", { type: "application/pdf" }));
    const r = await fetch("/api/apply", { method: "POST", body: fd });
    return r.status;
  }, { token: OPEN_TOKEN, email });
  expect(status).toBe(200);

  const c = await prisma.candidate.findFirst({ where: { email } });
  expect(c, "spam application dropped").toBeNull();
});

test("closed token shows the friendly closed page (no form)", async ({ page }) => {
  await page.goto(`/apply/${CLOSED_TOKEN}`);
  await expect(page.getByRole("heading", { name: /no longer accepting applications/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit application" })).toHaveCount(0);
});

test("/careers lists the open job and links to its apply page", async ({ page }) => {
  await page.goto("/careers");
  await expect(page.getByRole("heading", { name: OPEN_JOB_TITLE })).toBeVisible();
  const applyLink = page.locator(`a[href="/apply/${OPEN_TOKEN}?src=website"]`).first();
  await expect(applyLink).toBeVisible();
  await applyLink.click();
  await expect(page.getByRole("heading", { name: OPEN_JOB_TITLE })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit application" })).toBeVisible();
});

test("job detail page shows copyable Indeed + website apply links (HR)", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(ADMIN.email);
  await page.locator('input[type="password"]').fill(ADMIN.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);

  await page.goto(`/management/people/jobs/${OPEN_JOB_ID}`);
  await expect(page.getByText("Public application link")).toBeVisible();
  await expect(page.locator(`input[value*="/apply/${OPEN_TOKEN}?src=indeed"]`)).toBeVisible();
  await expect(page.locator(`input[value*="/apply/${OPEN_TOKEN}?src=website"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" }).first()).toBeVisible();

  // The applicant from the first test appears in this job's pipeline.
  await expect(page.getByText("Casey Rivera")).toBeVisible();
});
