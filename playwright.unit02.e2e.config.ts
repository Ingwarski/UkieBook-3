import { defineConfig, devices } from "@playwright/test";

import { requireDedicatedUnit02DatabaseUrl } from "./scripts/unit02-database-guard";

const databaseUrl = requireDedicatedUnit02DatabaseUrl(process.env.UNIT02_DATABASE_URL);

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit02-e2e",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  reporter: "list",
  retries: 0,
  testDir: "tests/e2e-unit02",
  use: {
    baseURL: "http://127.0.0.1:3105",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: {
    command: "node scripts/start-production-test-server.mjs 3105",
    env: {
      APP_ENV: "test",
      APP_ORIGIN: "http://127.0.0.1:3105",
      APP_REVISION: process.env.APP_REVISION ?? "unit02-e2e",
      DATABASE_URL: databaseUrl,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3105/api/health",
  },
});
