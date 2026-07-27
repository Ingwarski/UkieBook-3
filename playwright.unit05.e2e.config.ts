import { randomBytes } from "node:crypto";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { requireDedicatedUnit05DatabaseUrl } from "./scripts/unit05-database-guard";

const databaseUrl = requireDedicatedUnit05DatabaseUrl(
  process.env.UNIT05_DATABASE_URL,
);
const authSecret =
  process.env.AUTH_SECRET ?? randomBytes(32).toString("base64url");
const merchantToken =
  process.env.MONO_MERCHANT_TOKEN ?? randomBytes(32).toString("base64url");
const controlToken =
  process.env.UNIT05_MONO_CONTROL_TOKEN ??
  randomBytes(32).toString("base64url");

process.env.AUTH_SECRET = authSecret;
process.env.MONO_MERCHANT_TOKEN = merchantToken;
process.env.UNIT05_MONO_CONTROL_TOKEN = controlToken;

const appOrigin = "http://127.0.0.1:3121";
const oauthOrigin = "http://127.0.0.1:3217";
const monoOrigin = "http://127.0.0.1:3317";
process.env.UNIT05_MONO_ORIGIN = monoOrigin;
const privateObjectRoot = path.resolve(
  process.env.UNIT05_PRIVATE_OBJECT_ROOT ?? ".data/unit05-e2e-private",
);
const publicAssetRoot = path.resolve(
  process.env.UNIT05_PUBLIC_ASSET_ROOT ?? ".data/unit05-e2e-public",
);
const emailCaptureRoot = path.resolve(
  process.env.UNIT05_EMAIL_CAPTURE_ROOT ?? ".data/unit05-e2e-email",
);
process.env.UNIT05_EMAIL_CAPTURE_ROOT = emailCaptureRoot;
const monoStateRoot = path.resolve(
  process.env.UNIT05_MONO_STATE_ROOT ?? ".data/unit05-e2e-mono",
);
const monoPublicKeyFile = path.join(monoStateRoot, "public-key.json");
const sharedEnvironment = {
  APP_ENV: "test",
  APP_ORIGIN: appOrigin,
  APP_REVISION: process.env.APP_REVISION ?? "unit05-e2e",
  AUTH_SECRET: authSecret,
  AUTH_TEST_PROVIDER_ORIGIN: oauthOrigin,
  DATABASE_URL: databaseUrl,
  EMAIL_FROM: "purchases@ukiebook.test",
  FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  MONO_API_ORIGIN: monoOrigin,
  MONO_MERCHANT_TOKEN: merchantToken,
  PAYMENT_RECONCILIATION_INTERVAL_MS: "1000",
  PAYMENT_SESSION_VALIDITY_SECONDS: "3600",
  PAYMENT_WEBHOOK_MAX_BYTES: "65536",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  PUBLIC_CATALOG_ASSET_ROOT: publicAssetRoot,
  UNIT05_ALLOW_FIXTURE_SEED: "1",
  UNIT05_DATABASE_URL: databaseUrl,
  UNIT05_EMAIL_CAPTURE_ROOT: emailCaptureRoot,
  UNIT05_MONO_CONTROL_TOKEN: controlToken,
  UNIT05_MONO_PUBLIC_KEY_FILE: monoPublicKeyFile,
  UNIT05_MONO_STATE_ROOT: monoStateRoot,
  UNIT05_PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT05_PUBLIC_ASSET_ROOT: publicAssetRoot,
  WORKER_ID: "unit05-e2e-worker",
};

export default defineConfig({
  expect: { timeout: 30_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit05-e2e",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  reporter: "list",
  retries: 0,
  testDir: "tests/e2e-unit05",
  timeout: 240_000,
  use: {
    baseURL: appOrigin,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3217",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${oauthOrigin}/health`,
    },
    {
      command: `npx tsx scripts/mono-provider-simulator.ts 3317 ${JSON.stringify(monoPublicKeyFile)}`,
      env: {
        MONO_MERCHANT_TOKEN: merchantToken,
        UNIT05_MONO_CONTROL_TOKEN: controlToken,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${monoOrigin}/health`,
    },
    {
      command: "node scripts/start-unit05-test-runtime.mjs 3121",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${appOrigin}/api/health`,
    },
  ],
});
