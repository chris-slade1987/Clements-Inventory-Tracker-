import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Smoke test for GPS tracking (Verizon Connect Reveal) Phase 1 — verified with
// NO Verizon env set, so the sample-data fallback is active:
//   1. Admin can sync (/api/gps/sync) → sample data; the Live Map renders
//      markers + the vehicle list with a "Sample data" banner.
//   2. A vehicle profile shows its GPS / Location panel.
//   3. /api/gps/sync returns 403 for a non-admin manager.
//   4. /api/gps/webhook stores an event and returns 200.

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

test.describe("GPS tracking (Verizon Reveal) Phase 1", () => {
  test("admin: sync → sample Live Map markers + list, per-vehicle GPS panel, webhook stores an event", async ({ page }) => {
    await login(page, ADMIN);

    // 1. Sync from within the authenticated page (session cookie sent). Not
    //    configured in the sandbox → sample fallback.
    const sync = await page.evaluate(async () => {
      const r = await fetch("/api/gps/sync", { method: "POST", redirect: "manual" });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    expect(sync.status).toBe(200);
    expect(sync.body.ok).toBe(true);
    expect(sync.body.sample).toBe(true);
    expect(sync.body.positions).toBeGreaterThan(0);

    // 2. Live Map: sample banner, a rendered marker, and the vehicle list.
    await page.goto("/fleet/map");
    await expect(page.getByTestId("sample-banner")).toBeVisible();
    await expect(page.getByTestId("vehicle-list")).toBeVisible();
    // Leaflet renders each pin as a .leaflet-marker-icon in the DOM.
    await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible({ timeout: 20_000 });
    const listCount = await page.getByTestId("vehicle-list").locator("a").count();
    expect(listCount).toBeGreaterThan(0);

    // 3. Per-vehicle GPS panel via the first list entry.
    await Promise.all([
      page.waitForURL(/\/fleet\/[^/]+$/, { timeout: 30_000 }),
      page.getByTestId("vehicle-list").locator("a").first().click(),
    ]);
    const panel = page.getByTestId("vehicle-gps");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("GPS / Location");

    // 4. Webhook stores an event (no token configured → 200). Verify via the DB.
    const prisma = new PrismaClient();
    try {
      const before = await prisma.gpsWebhookEvent.count();
      const res = await page.request.post("/api/gps/webhook", {
        headers: { "Content-Type": "application/json" },
        data: { type: "speeding", vehicleNumber: "SMOKE-1", detail: "e2e" },
      });
      expect(res.status()).toBe(200);
      await expect.poll(async () => prisma.gpsWebhookEvent.count(), { timeout: 10_000 }).toBe(before + 1);
      const latest = await prisma.gpsWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" } });
      expect(latest?.type).toBe("speeding");
      expect(latest?.verizonNumber).toBe("SMOKE-1");
    } finally {
      await prisma.$disconnect();
    }
  });

  test("non-admin manager: /api/gps/sync is 403", async ({ page }) => {
    await logout(page);
    await login(page, MANAGER);
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/gps/sync", { method: "POST", redirect: "manual" });
      return r.status;
    });
    expect(status).toBe(403);
  });
});
