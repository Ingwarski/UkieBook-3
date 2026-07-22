import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { requireDedicatedUnit03DatabaseUrl } from "./scripts/unit03-database-guard";

const databaseUrl = requireDedicatedUnit03DatabaseUrl(process.env.UNIT03_DATABASE_URL);
const ebookConvertPath = process.env.CALIBRE_EBOOK_CONVERT_PATH;
if (!ebookConvertPath) throw new Error("CALIBRE_EBOOK_CONVERT_PATH is required");
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required");
const sharedEnvironment = {
  APP_ENV: "test",
  APP_ORIGIN: "http://127.0.0.1:3117",
  APP_REVISION: process.env.APP_REVISION ?? "unit03-e2e",
  AUTH_SECRET: authSecret,
  AUTH_TEST_PROVIDER_ORIGIN: "http://127.0.0.1:3213",
  CALIBRE_EBOOK_CONVERT_PATH: ebookConvertPath,
  DATABASE_URL: databaseUrl,
  FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  PRIVATE_OBJECT_ROOT: path.resolve(".data/unit03-e2e-private"),
  WORKER_ID: "unit03-e2e-worker",
};

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit03-e2e",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  reporter: "list",
  retries: 0,
  testDir: "tests/e2e-unit03",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3117",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3213",
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:3213/health",
    },
    {
      command: "node scripts/start-unit03-test-runtime.mjs 3117",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3117/api/health",
    },
  ],
});
