import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.UNIT01_DATABASE_URL;
const authSecret = process.env.UNIT01_AUTH_SECRET;
if (!databaseUrl || !authSecret) {
  throw new Error("UNIT01_DATABASE_URL and UNIT01_AUTH_SECRET are required");
}

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit01-e2e",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  reporter: "list",
  retries: 0,
  testDir: "tests/e2e-unit01",
  use: {
    baseURL: "http://127.0.0.1:3102",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx --no-install tsx scripts/oauth-provider-simulator.ts 3200",
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:3200/health",
    },
    {
      command: "node scripts/start-production-test-server.mjs 3102",
      env: {
        APP_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:3102",
        APP_REVISION: process.env.APP_REVISION ?? "unit01-e2e",
        AUTH_SECRET: authSecret,
        AUTH_TEST_PROVIDER_ORIGIN: "http://127.0.0.1:3200",
        DATABASE_URL: databaseUrl,
        FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
        FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3102/api/health",
    },
  ],
});
