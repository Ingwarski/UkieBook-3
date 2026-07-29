import { randomBytes } from "node:crypto";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { requireDedicatedUnit06DatabaseUrl } from "./scripts/unit06-database-guard";

const databaseUrl = requireDedicatedUnit06DatabaseUrl(process.env.UNIT06_DATABASE_URL);
const authSecret = process.env.AUTH_SECRET ?? randomBytes(32).toString("base64url");
const appOrigin = "http://127.0.0.1:3132";
const oauthOrigin = "http://127.0.0.1:3232";
const privateRoot = path.resolve(process.env.UNIT06_PRIVATE_OBJECT_ROOT ?? ".data/unit06-visual-private");
const implementationRevision = process.env.UNIT06_IMPLEMENTATION_REVISION ?? "unit06-visual";

process.env.AUTH_SECRET = authSecret;
process.env.UNIT06_APP_ORIGIN = appOrigin;
process.env.UNIT06_IMPLEMENTATION_REVISION = implementationRevision;
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
  WORKER_ID: "unit06-visual-worker",
};

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit06-visual",
  projects: [{
    name: "chromium-hidpi",
    use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 },
  }],
  reporter: "list",
  retries: 0,
  testDir: "tests/visual-unit06",
  timeout: 360_000,
  use: { baseURL: appOrigin, screenshot: "only-on-failure", trace: "off" },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3232",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${oauthOrigin}/health`,
    },
    {
      command: "node scripts/start-unit06-test-runtime.mjs 3132",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${appOrigin}/api/health`,
    },
  ],
});
