import { test, expect, type Page } from "@playwright/test";

// Smoke test for the checklist refinement — covers all four changes:
//   1. Monthly oversight checklist removed (weekly-only).
//   2. "Recurring tasks" card groups weekly checklist + vehicle inspections with
//      a frequency badge + due date on the right.
//   3. Weekly run has NO time stamps and BOLD item labels.
//   4. Missed-checklist penalty: reported; a MANAGER can never clear, an ADMIN can
//      clear with a required note; cleared misses stay as history.

const ADMIN = { email: "manager@clementspest.com", password: "clements123" };
const MANAGER = { email: "vero@clementspestcontrol.com", password: "clements123" };

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

async function logout(page: Page) {
  await page.request.post("/api/auth/logout").catch(() => {});
  await page.context().clearCookies();
}

test.describe("Checklist refinement", () => {
  test("manager view: recurring-tasks card, weekly run, weekly-only hub, cannot clear", async ({ page }) => {
    await login(page, MANAGER);

    // Change 4: red missed-checklist banner (created by the live sweep).
    const banner = page.getByTestId("miss-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/missed weekly checklist/i);
    await expect(banner).toContainText(/Only HR or the CEO can clear/i);

    // Change 2: Recurring tasks card with frequency + due date on the right.
    const recurring = page.getByTestId("recurring-tasks");
    await expect(recurring).toBeVisible();
    await expect(recurring).toContainText("Weekly Oversight Checklist");
    await expect(recurring).toContainText("Weekly");
    await expect(recurring).toContainText(/Due Fri \w{3} \d{1,2}/); // e.g. "Due Fri Jul 24"
    await expect(recurring).toContainText("Vehicle Inspections");
    await expect(recurring).toContainText("Monthly");

    // Change 1: hub shows the weekly checklist and NOT the monthly one.
    await page.goto("/checklists");
    await expect(page.getByText("Weekly Oversight Checklist").first()).toBeVisible();
    await expect(page.getByText("Monthly Oversight Checklist")).toHaveCount(0);
    // Frequency + due date treatment on the hub card.
    await expect(page.getByText("Weekly", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Due Fri \w{3} \d{1,2}/).first()).toBeVisible();

    // Change 3: weekly run — no time stamps, bold item labels.
    await page.goto("/checklists/weekly?branch=vero");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/); // no "1:00 PM" style stamps
    expect(body).not.toContain("END OF DAY");
    // A known item label is present and rendered as a bold (font-semibold) node.
    const boldItem = page.locator("span.font-semibold", { hasText: "Bank deposits" });
    await expect(boldItem.first()).toBeVisible();

    // Change 4: manager CANNOT clear — alerts compliance section is read-only.
    await page.goto("/alerts");
    const locked = page.getByTestId("clear-locked").first();
    await expect(locked).toBeVisible();
    await expect(locked).toContainText(/Only the CEO or HR can clear/i);
    await expect(page.getByTestId("clear-miss-btn")).toHaveCount(0);

    // And the API refuses a manager's clear attempt with 403 (issued from within
    // the authenticated page so the session cookie is sent).
    const openMiss = page.getByTestId("open-miss").first();
    await expect(openMiss).toBeVisible();
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/checklists/miss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", missId: "does-not-matter", note: "attempt" }),
        redirect: "manual",
      });
      return r.status;
    });
    expect(status).toBe(403);
  });

  test("admin view: oversight weekly-only, can clear a miss with a note → history", async ({ page }) => {
    await logout(page);
    await login(page, ADMIN);

    await page.goto("/checklists/oversight");

    // Change 1: oversight has a Weekly column, no Monthly oversight checklist.
    await expect(page.getByText("Monthly Oversight Checklist")).toHaveCount(0);
    await expect(page.locator("th", { hasText: "Weekly" }).first()).toBeVisible();

    // Change 4: open misses are reported and the admin has a Clear action.
    const missPanel = page.getByTestId("missed-checklists");
    await expect(missPanel).toBeVisible();
    const firstClearBtn = page.getByTestId("clear-miss-btn").first();
    await expect(firstClearBtn).toBeVisible();

    const openBefore = await page.getByTestId("open-miss").count();
    expect(openBefore).toBeGreaterThan(0);

    // Clear the first miss WITH a required note.
    await firstClearBtn.click();
    await page.getByTestId("clear-note").first().fill("Reviewed with branch manager; corrective follow-up logged.");
    await page.getByTestId("clear-confirm").first().click();

    // It moves out of "open" and into cleared history with the note.
    await expect
      .poll(async () => page.getByTestId("open-miss").count(), { timeout: 15_000 })
      .toBe(openBefore - 1);
    const history = page.getByTestId("cleared-miss").first();
    await expect(history).toBeVisible();
    await expect(history).toContainText("corrective follow-up logged");
  });
});
