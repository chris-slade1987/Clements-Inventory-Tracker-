import { test, expect, type Page } from "@playwright/test";

// Smoke test for Attendance / Call-Out tracking. Employee IDs/names + the
// accident-record ID are injected by the runner (looked up from the DB via
// e2e/setup-absence.ts) so the specs navigate straight to profiles.
const ADMIN = { email: "manager@clementspest.com", password: "clements123" };
const VERO_MGR = { email: "vero@clementspestcontrol.com", password: "clements123" };

const ILLNESS_ID = process.env.ILLNESS_EMP_ID ?? "";
const ILLNESS_NAME = process.env.ILLNESS_EMP_NAME ?? "";
const NOTIFY_ID = process.env.NOTIFY_EMP_ID ?? "";
const NOTIFY_NAME = process.env.NOTIFY_EMP_NAME ?? "";
const ADMIN_EMP_ID = process.env.ADMIN_EMP_ID ?? "";
const ADMIN_EMP_NAME = process.env.ADMIN_EMP_NAME ?? "";
const STUART_ID = process.env.STUART_EMP_ID ?? "";

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

// The Attendance / Call-Outs card, located by its heading.
function card(page: Page) {
  return page.locator("div.surface-light", { hasText: "Attendance / Call-Outs" }).first();
}

async function fillLogger(
  page: Page,
  opts: { start: string; end: string; reason: string; workplace?: "Yes" | "No"; submit?: boolean },
) {
  const c = card(page);
  await c.getByRole("button", { name: "Log a call-out" }).click();
  await page.locator('label:has-text("First day out") input').fill(opts.start);
  await page.locator('label:has-text("Last day out") input').fill(opts.end);
  await page.locator('label:has-text("Reason") select').selectOption(opts.reason);
  if (opts.workplace) {
    await page.getByRole("button", { name: opts.workplace, exact: true }).click();
  }
  if (opts.submit !== false) {
    await page.getByRole("button", { name: "Log call-out" }).click();
  }
}

test.describe("Attendance / Call-Outs", () => {
  test.beforeAll(() => {
    expect(ILLNESS_ID, "ILLNESS_EMP_ID must be set").not.toBe("");
    expect(NOTIFY_ID, "NOTIFY_EMP_ID must be set").not.toBe("");
    expect(STUART_ID, "STUART_EMP_ID must be set").not.toBe("");
  });

  test("admin: 3-day illness flags a medical note; received clears it; 1-day illness does not flag", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/management/people/${ILLNESS_ID}`);
    await expect(card(page)).toBeVisible();

    // 3-day employee illness → medical note auto-requested (banner).
    await fillLogger(page, { start: "2026-08-03", end: "2026-08-05", reason: "employee_illness" });
    await expect(page.getByText("Medical note requested", { exact: false })).toBeVisible({ timeout: 15_000 });

    // Shows in the HR overview's outstanding list.
    await page.goto("/management/people/callouts");
    const row = page.locator("li", { hasText: ILLNESS_NAME }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Mark received" }).click();

    // Banner clears on the profile.
    await page.goto(`/management/people/${ILLNESS_ID}`);
    await expect(card(page)).toBeVisible();
    await expect(page.getByText("Medical note requested", { exact: false })).toHaveCount(0);

    // A 1-day illness does NOT flag a note.
    await fillLogger(page, { start: "2026-08-10", end: "2026-08-10", reason: "employee_illness" });
    await expect(card(page).getByText("Call-out logged.", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Medical note requested", { exact: false })).toHaveCount(0);
  });

  test("admin: physical injury requires workplace Y/N, links an accident, and surfaces banners", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/management/people/${ILLNESS_ID}`);
    await expect(card(page)).toBeVisible();

    // Attempt to submit a physical injury WITHOUT answering workplace-related.
    await fillLogger(page, { start: "2026-08-15", end: "2026-08-15", reason: "physical_injury" });
    await expect(page.getByText("Indicate whether the injury is workplace-related", { exact: false })).toBeVisible();

    // Answer Yes → accident dropdown appears → link it → submit.
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page.locator('label:has-text("Link the accident report") select').selectOption({ index: 1 });
    await page.getByRole("button", { name: "Log call-out" }).click();

    // Profile banner + accident-record out-of-work banner both visible.
    await expect(page.getByText("Out due to workplace injury", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Employee out of work due to this injury", { exact: false })).toBeVisible();
  });

  test("branch manager: own-branch log, cross-branch redirect + 403, and cannot resolve notes", async ({ page }) => {
    await login(page, VERO_MGR);

    // Cross-branch profile → redirected away (branch-locked).
    await page.goto(`/my-branch/team/${STUART_ID}`);
    await expect(page).toHaveURL(/\/my-branch\/team$/);

    // Own-branch profile → log a 3-day illness (this also fires the manager alert).
    await page.goto(`/my-branch/team/${NOTIFY_ID}`);
    await expect(card(page)).toBeVisible();
    await fillLogger(page, { start: "2026-08-04", end: "2026-08-06", reason: "employee_illness" });
    await expect(page.getByText("Medical note requested", { exact: false })).toBeVisible({ timeout: 15_000 });

    // Manager cannot resolve — no resolution controls in the card.
    await expect(card(page).getByRole("button", { name: "Mark received" })).toHaveCount(0);

    // Cross-branch write via the API is 403. Use the browser's own fetch so the
    // session cookie is sent (Playwright's request context drops the secure
    // cookie over http on 127.0.0.1).
    const status = await page.evaluate(async (employeeId) => {
      const r = await fetch("/api/absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", employeeId, startDate: "2026-08-04", endDate: "2026-08-04", reason: "personal" }),
      });
      return r.status;
    }, STUART_ID);
    expect(status).toBe(403);
  });

  test("manager-logged call-out notifies CEO + HR; admin-logged does not", async ({ page }) => {
    // The manager already logged for NOTIFY_EMP in the previous test → a thread
    // to the CEO/admin should exist. Verify from the admin (CEO) inbox.
    await login(page, ADMIN);
    await page.goto("/inbox");
    await expect(page.getByText(`Call-out logged: ${NOTIFY_NAME}`, { exact: false })).toBeVisible({ timeout: 15_000 });

    // When admin logs a call-out themselves, NO notification thread is created.
    await page.goto(`/management/people/${ADMIN_EMP_ID}`);
    await expect(card(page)).toBeVisible();
    await fillLogger(page, { start: "2026-08-07", end: "2026-08-07", reason: "personal" });
    await expect(card(page).getByText("Call-out logged.", { exact: false })).toBeVisible({ timeout: 15_000 });

    await page.goto("/inbox");
    await expect(page.getByText(`Call-out logged: ${ADMIN_EMP_NAME}`, { exact: false })).toHaveCount(0);
  });
});
