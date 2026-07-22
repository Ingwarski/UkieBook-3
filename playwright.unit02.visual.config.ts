import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";

import { requireDedicatedUnit02DatabaseUrl } from "./scripts/unit02-database-guard";

const databaseUrl = requireDedicatedUnit02DatabaseUrl(process.env.UNIT02_DATABASE_URL);
const implementationRevision =
  process.env.APP_REVISION ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
process.env.UNIT02_IMPLEMENTATION_REVISION = implementationRevision;

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit02-visual",
  projects: [
    {
      name: "chromium-hidpi",
      use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "tests/visual-unit02",
  timeout: 240_000,
  use: {
    baseURL: "http://127.0.0.1:3106",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: {
    command: "node scripts/start-production-test-server.mjs 3106",
    env: {
      APP_ENV: "test",
      APP_ORIGIN: "http://127.0.0.1:3106",
      APP_REVISION: implementationRevision,
      DATABASE_URL: databaseUrl,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3106/api/health",
  },
});
