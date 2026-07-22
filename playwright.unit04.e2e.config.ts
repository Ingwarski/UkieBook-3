import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { requireDedicatedUnit04DatabaseUrl } from "./scripts/unit04-database-guard";

const databaseUrl = requireDedicatedUnit04DatabaseUrl(
  process.env.UNIT04_DATABASE_URL,
);
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required");

const appOrigin = "http://127.0.0.1:3119";
const providerOrigin = "http://127.0.0.1:3215";
const privateObjectRoot = process.env.UNIT04_PRIVATE_OBJECT_ROOT
  ? path.resolve(process.env.UNIT04_PRIVATE_OBJECT_ROOT)
  : path.resolve(".data/unit04-e2e-private");
const publicAssetRoot = process.env.UNIT04_PUBLIC_ASSET_ROOT
  ? path.resolve(process.env.UNIT04_PUBLIC_ASSET_ROOT)
  : path.resolve(".data/unit04-e2e-public");
const sharedEnvironment = {
  APP_ENV: "test",
  APP_ORIGIN: appOrigin,
  APP_REVISION: process.env.APP_REVISION ?? "unit04-e2e",
  AUTH_SECRET: authSecret,
  AUTH_TEST_PROVIDER_ORIGIN: providerOrigin,
  DATABASE_URL: databaseUrl,
  FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  PUBLIC_CATALOG_ASSET_ROOT: publicAssetRoot,
  UNIT04_ALLOW_FIXTURE_SEED: "1",
  UNIT04_DATABASE_URL: databaseUrl,
  UNIT04_PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT04_PUBLIC_ASSET_ROOT: publicAssetRoot,
  WORKER_ID: "unit04-e2e-worker",
};

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit04-e2e",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  reporter: "list",
  retries: 0,
  testDir: "tests/e2e-unit04",
  timeout: 180_000,
  use: {
    baseURL: appOrigin,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3215",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${providerOrigin}/health`,
    },
    {
      command: "node scripts/start-unit04-test-runtime.mjs 3119",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${appOrigin}/api/health`,
    },
  ],
});
