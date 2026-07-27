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
const implementationRevision =
  process.env.APP_REVISION ?? "unit05-working-tree";

process.env.AUTH_SECRET = authSecret;
process.env.MONO_MERCHANT_TOKEN = merchantToken;
process.env.UNIT05_IMPLEMENTATION_REVISION = implementationRevision;
process.env.UNIT05_MONO_CONTROL_TOKEN = controlToken;

const appOrigin = "http://127.0.0.1:3122";
const oauthOrigin = "http://127.0.0.1:3218";
const monoOrigin = "http://127.0.0.1:3318";
process.env.UNIT05_MONO_ORIGIN = monoOrigin;
const privateObjectRoot = path.resolve(
  process.env.UNIT05_PRIVATE_OBJECT_ROOT ?? ".data/unit05-visual-private",
);
const publicAssetRoot = path.resolve(
  process.env.UNIT05_PUBLIC_ASSET_ROOT ?? ".data/unit05-visual-public",
);
const emailCaptureRoot = path.resolve(
  process.env.UNIT05_EMAIL_CAPTURE_ROOT ?? ".data/unit05-visual-email",
);
process.env.UNIT05_EMAIL_CAPTURE_ROOT = emailCaptureRoot;
const monoStateRoot = path.resolve(
  process.env.UNIT05_MONO_STATE_ROOT ?? ".data/unit05-visual-mono",
);
const monoPublicKeyFile = path.join(monoStateRoot, "public-key.json");
const sharedEnvironment = {
  APP_ENV: "test",
  APP_ORIGIN: appOrigin,
  APP_REVISION: implementationRevision,
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
  WORKER_ID: "unit05-visual-worker",
};

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit05-visual",
  projects: [
    {
      name: "chromium-hidpi",
      use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "tests/visual-unit05",
  timeout: 480_000,
  use: {
    baseURL: appOrigin,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx tsx scripts/oauth-provider-simulator.ts 3218",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${oauthOrigin}/health`,
    },
    {
      command: `npx tsx scripts/mono-provider-simulator.ts 3318 ${JSON.stringify(monoPublicKeyFile)}`,
      env: {
        MONO_MERCHANT_TOKEN: merchantToken,
        UNIT05_MONO_CONTROL_TOKEN: controlToken,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${monoOrigin}/health`,
    },
    {
      command: "node scripts/start-unit05-test-runtime.mjs 3122",
      env: sharedEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${appOrigin}/api/health`,
    },
  ],
});
