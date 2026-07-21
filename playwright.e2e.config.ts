import { defineConfig, devices } from "@playwright/test";

const secretSentinel =
  process.env.UNIT00_SECRET_SENTINEL ??
  "unit00-browser-secret-sentinel-4f8d7b68";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: "test-results/e2e",
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"]
    }
  ],
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node scripts/start-production-test-server.mjs 3100",
    env: {
      APP_REVISION: process.env.APP_REVISION ?? "unit00-e2e",
      DATABASE_URL: `postgres://unit00:${secretSentinel}@127.0.0.1:5432/unit00`,
      UNIT00_SECRET_SENTINEL: secretSentinel,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100/api/health"
  }
});
