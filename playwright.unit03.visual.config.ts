import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { requireDedicatedUnit03DatabaseUrl } from "./scripts/unit03-database-guard";

const databaseUrl = requireDedicatedUnit03DatabaseUrl(process.env.UNIT03_DATABASE_URL);
const ebookConvertPath = process.env.CALIBRE_EBOOK_CONVERT_PATH;
if (!ebookConvertPath) throw new Error("CALIBRE_EBOOK_CONVERT_PATH is required");
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required");

const appOrigin = "http://127.0.0.1:3108";
const providerOrigin = "http://127.0.0.1:3204";
const implementationRevision = process.env.APP_REVISION ?? "unit03-working-tree";
const privateObjectRoot = process.env.UNIT03_PRIVATE_OBJECT_ROOT
  ? path.resolve(process.env.UNIT03_PRIVATE_OBJECT_ROOT)
  : path.resolve(".data/unit03-e2e-private");

process.env.UNIT03_IMPLEMENTATION_REVISION = implementationRevision;

const sharedEnvironment = {
  APP_ENV: "test",
  APP_ORIGIN: appOrigin,
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  AUTH_TEST_PROVIDER_ORIGIN: providerOrigin,
  CALIBRE_EBOOK_CONVERT_PATH: ebookConvertPath,
  DATABASE_URL: databaseUrl,
  FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT03_ALLOW_FIXTURE_SEED: "1",
  UNIT03_DATABASE_URL: databaseUrl,
  WORKER_ID: "unit03-visual-worker",
};

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit03-visual",
  projects: [
    {
      name: "chromium-hidpi",
      use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "tests/visual-unit03",
  timeout: 360_000,
  use: {
    baseURL: appOrigin,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3204",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${providerOrigin}/health`,
    },
    {
      command: "node tests/visual-unit03/start-runtime.mjs 3108",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${appOrigin}/api/health`,
    },
  ],
});
