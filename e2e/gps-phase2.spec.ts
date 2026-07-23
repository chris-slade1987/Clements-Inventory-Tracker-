import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Smoke test for GPS tracking Phase 2 — the analytics dashboard + the dedicated
// GPS Alerts section + the detection engine. Verified with NO Anthropic key and
// NO Verizon creds, so only the deterministic rules run (the AI layer is a
// no-op). We insert a few REAL (sample:false) positions that trip rules, run
// detection, and confirm:
//   1. /api/gps/detect (admin) creates de-duped GpsAlerts (2nd run adds none).
//   2. The GPS dashboard renders its tiles + per-vehicle rollup.
//   3. The GPS Alerts page lists them; Acknowledge moves one out of the open list.
//   4. /api/gps/detect + /api/gps/alert are 403 for a non-admin/non-manager.
//   5. NO alerts are ever filed from sample:true rows.

const ADMIN = { email: "manager@clementspest.com", password: "clements123" };

const VNS = ["E2E-SPEED", "E2E-AREA", "E2E-OFFLINE", "E2E-SAMPLE-SPEED"];
const UNITS = ["E2E-V1", "E2E-V2", "E2E-V3"];

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

async function cleanup(prisma: PrismaClient) {
  await prisma.gpsAlert.deleteMany({ where: { verizonNumber: { in: VNS } } });
  await prisma.gpsPosition.deleteMany({ where: { verizonNumber: { in: VNS } } });
  await prisma.vehicle.deleteMany({ where: { unitNumber: { in: UNITS } } });
}

test.describe("GPS tracking Phase 2 — analytics dashboard + AI-driven alerts", () => {
  test("detection files de-duped alerts (real data only), dashboard + alerts render, ack clears, 403 for employees", async ({ page }) => {
    const prisma = new PrismaClient();
    const now = new Date();
    try {
      await cleanup(prisma);

      // Three dedicated active vehicles so we don't disturb the seeded fleet.
      const vSpeed = await prisma.vehicle.create({ data: { name: "E2E Speeder", unitNumber: "E2E-V1", branch: "vero", status: "active" } });
      const vArea = await prisma.vehicle.create({ data: { name: "E2E Wanderer", unitNumber: "E2E-V2", branch: "stuart", status: "active" } });
      const vOffline = await prisma.vehicle.create({ data: { name: "E2E Ghost", unitNumber: "E2E-V3", branch: "orlando", status: "active", verizonNumber: "E2E-OFFLINE" } });

      // REAL telemetry that trips rules:
      //  - speeding: 95 mph near Vero Beach.
      await prisma.gpsPosition.create({
        data: { vehicleId: vSpeed.id, verizonNumber: "E2E-SPEED", ts: now, lat: 27.6386, lng: -80.3973, speed: 95, ignition: true, sample: false },
      });
      //  - out-of-area: stationary in Kansas (far from any FL branch).
      await prisma.gpsPosition.create({
        data: { vehicleId: vArea.id, verizonNumber: "E2E-AREA", ts: now, lat: 39.5, lng: -98.35, speed: 0, ignition: false, sample: false },
      });
      //  - offline: only a stale (26h old) real ping for the linked vehicle.
      await prisma.gpsPosition.create({
        data: { vehicleId: vOffline.id, verizonNumber: "E2E-OFFLINE", ts: new Date(now.getTime() - 26 * 3600 * 1000), lat: 28.5383, lng: -81.3792, speed: 0, ignition: false, sample: false },
      });
      //  - SAMPLE speeding (120 mph) — must NEVER produce an alert.
      await prisma.gpsPosition.create({
        data: { vehicleId: vSpeed.id, verizonNumber: "E2E-SAMPLE-SPEED", ts: now, lat: 27.64, lng: -80.4, speed: 120, ignition: true, sample: true },
      });

      await login(page, ADMIN);

      // 1. Run detection. Deterministic rules only (no keys) → our 3 findings.
      const detect1 = await page.evaluate(async () => {
        const r = await fetch("/api/gps/detect", { method: "POST", redirect: "manual" });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      });
      expect(detect1.status).toBe(200);
      expect(detect1.body.ok).toBe(true);
      expect(detect1.body.detection.created).toBeGreaterThanOrEqual(3);
      expect(detect1.body.ai.aiGenerated).toBe(false); // no key in the sandbox

      const afterFirst = await prisma.gpsAlert.count({ where: { verizonNumber: { in: VNS } } });
      expect(afterFirst).toBeGreaterThanOrEqual(3);

      // De-dupe: a second run must not create duplicates for the same keys.
      const detect2 = await page.evaluate(async () => {
        const r = await fetch("/api/gps/detect", { method: "POST" });
        return await r.json().catch(() => ({}));
      });
      const afterSecond = await prisma.gpsAlert.count({ where: { verizonNumber: { in: VNS } } });
      expect(afterSecond).toBe(afterFirst);
      expect(detect2.detection.created).toBe(0);

      // 5. NO alert was filed from the sample:true row.
      const sampleAlerts = await prisma.gpsAlert.count({ where: { verizonNumber: "E2E-SAMPLE-SPEED" } });
      expect(sampleAlerts).toBe(0);

      // Confirm each expected rule fired.
      const types = new Set((await prisma.gpsAlert.findMany({ where: { verizonNumber: { in: VNS } }, select: { type: true } })).map((a) => a.type));
      expect(types.has("speeding")).toBe(true);
      expect(types.has("out_of_area")).toBe(true);
      expect(types.has("offline")).toBe(true);

      // 2. Dashboard renders tiles + rollup.
      await page.goto("/fleet/gps");
      await expect(page.getByTestId("gps-rollup")).toBeVisible();
      await expect(page.getByTestId("gps-insights")).toBeVisible();
      await expect(page.getByTestId("exception-speeding")).toBeVisible();

      // 3. Alerts page lists open alerts; Acknowledge removes one from the list.
      await page.goto("/fleet/gps/alerts");
      const list = page.getByTestId("gps-alert-list");
      await expect(list).toBeVisible();
      const before = await page.getByTestId("gps-alert").count();
      expect(before).toBeGreaterThanOrEqual(3);
      await page.getByTestId("gps-alert-ack").first().click();
      await expect(page.getByTestId("gps-alert")).toHaveCount(before - 1, { timeout: 15_000 });

      // 4. Employees (non-admin/non-manager) are 403 on both endpoints.
      await logout(page);
      const emp = await prisma.user.findFirst({ where: { role: "employee", active: true }, select: { email: true } });
      expect(emp?.email).toBeTruthy();
      await login(page, { email: emp!.email, password: "clements123" });
      const forbidden = await page.evaluate(async () => {
        const d = await fetch("/api/gps/detect", { method: "POST", redirect: "manual" });
        const a = await fetch("/api/gps/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ack", id: "x" }), redirect: "manual" });
        return { detect: d.status, alert: a.status };
      });
      expect(forbidden.detect).toBe(403);
      expect(forbidden.alert).toBe(403);
    } finally {
      await cleanup(prisma);
      await prisma.$disconnect();
    }
  });
});
