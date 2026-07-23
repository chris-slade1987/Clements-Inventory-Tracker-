import { test, expect, type Page } from "@playwright/test";

// Smoke test for the employee-profile change:
//   1. The Contact card surfaces "Start date" (formatted from the Paychex census
//      hire date), "Work phone", and "Personal phone".
//   2. Tim Slade's start date reads "Jun 1, 1975".
//   3. HR/admin can Edit the card, save a Personal phone, and it persists.
//
// TIM_EMPLOYEE_ID is injected by the runner (looked up from the DB) so the test
// navigates straight to the profile without depending on list filtering.

const ADMIN = { email: "manager@clementspest.com", password: "clements123" };
const TIM_ID = process.env.TIM_EMPLOYEE_ID ?? "";
const NEW_PERSONAL_PHONE = "(772) 555-0199";

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

test.describe("Employee profile — start date + phones", () => {
  test("profile shows start date + phone rows; edit saves a personal phone", async ({ page }) => {
    expect(TIM_ID, "TIM_EMPLOYEE_ID must be set").not.toBe("");
    await login(page, ADMIN);

    await page.goto(`/management/people/${TIM_ID}`);
    await expect(page.getByRole("heading", { name: "Tim Slade" })).toBeVisible();

    // Contact card surfaces the three labeled fields.
    const contact = page.locator("div").filter({ hasText: /^Contact/ }).first();
    await expect(page.getByText("Start date", { exact: true })).toBeVisible();
    await expect(page.getByText("Work phone", { exact: true })).toBeVisible();
    await expect(page.getByText("Personal phone", { exact: true })).toBeVisible();

    // Start date is formatted from the census hire date.
    await expect(page.getByText("Jun 1, 1975")).toBeVisible();

    // Edit → set a personal phone → save.
    await page.getByRole("button", { name: "Edit" }).click();
    const personalInput = page.locator('label:has-text("Personal phone") input');
    await expect(personalInput).toBeVisible();
    await personalInput.fill(NEW_PERSONAL_PHONE);
    await page.getByRole("button", { name: "Save" }).click();

    // After save the card returns to view mode and shows the persisted value.
    await expect(page.getByText(NEW_PERSONAL_PHONE)).toBeVisible({ timeout: 15_000 });

    // Persistence survives a full reload (read back from the DB).
    await page.reload();
    await expect(page.getByText(NEW_PERSONAL_PHONE)).toBeVisible();
    await expect(page.getByText("Jun 1, 1975")).toBeVisible();

    void contact;
  });
});
