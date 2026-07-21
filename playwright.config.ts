import { defineConfig, devices } from "@playwright/test";

// Smoke-test config for the checklist refinement. Chromium is driven via an
// explicit executablePath (CHROME_BIN) because the sandbox blocks Playwright's
// browser CDN; CHROME_BIN points at a Chrome-for-Testing build matching this
// Playwright version. The app is served by a production build on port 3100.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: {
      executablePath: process.env.CHROME_BIN,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
