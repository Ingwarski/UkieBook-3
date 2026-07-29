import { randomBytes } from "node:crypto";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { requireDedicatedUnit06DatabaseUrl } from "./scripts/unit06-database-guard";

const databaseUrl = requireDedicatedUnit06DatabaseUrl(process.env.UNIT06_DATABASE_URL);
const authSecret = process.env.AUTH_SECRET ?? randomBytes(32).toString("base64url");
const appOrigin = "http://127.0.0.1:3131";
const oauthOrigin = "http://127.0.0.1:3231";
const privateRoot = path.resolve(process.env.UNIT06_PRIVATE_OBJECT_ROOT ?? ".data/unit06-e2e-private");
const implementationRevision = process.env.UNIT06_IMPLEMENTATION_REVISION ?? "unit06-e2e";

process.env.AUTH_SECRET = authSecret;
process.env.UNIT06_APP_ORIGIN = appOrigin;
process.env.UNIT06_PRIVATE_OBJECT_ROOT = privateRoot;

const sharedEnvironment = {
  APP_ENV: "test",
  APP_ORIGIN: appOrigin,
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  AUTH_TEST_PROVIDER_ORIGIN: oauthOrigin,
  DATABASE_URL: databaseUrl,
  FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  PRIVATE_OBJECT_ROOT: privateRoot,
  UNIT06_ALLOW_FIXTURE_SEED: "1",
  UNIT06_DATABASE_URL: databaseUrl,
  UNIT06_PRIVATE_OBJECT_ROOT: privateRoot,
  WORKER_ID: "unit06-e2e-worker",
};

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit06-e2e",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  reporter: "list",
  retries: 0,
  testDir: "tests/e2e-unit06",
  timeout: 240_000,
  use: { baseURL: appOrigin, screenshot: "only-on-failure", trace: "off" },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3231",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${oauthOrigin}/health`,
    },
    {
      command: "node scripts/start-unit06-test-runtime.mjs 3131",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${appOrigin}/api/health`,
    },
  ],
});
