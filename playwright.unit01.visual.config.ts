import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.UNIT01_DATABASE_URL;
const authSecret = process.env.UNIT01_AUTH_SECRET;
if (!databaseUrl || !authSecret) {
  throw new Error("UNIT01_DATABASE_URL and UNIT01_AUTH_SECRET are required");
}

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/unit01-visual",
  projects: [
    {
      name: "chromium-hidpi",
      use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "tests/visual-unit01",
  use: {
    baseURL: "http://127.0.0.1:3103",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npx --no-install tsx scripts/oauth-provider-simulator.ts 3201",
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:3201/health",
    },
    {
      command: "node scripts/start-production-test-server.mjs 3103",
      env: {
        APP_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:3103",
        APP_REVISION: process.env.APP_REVISION ?? "unit01-visual",
        AUTH_SECRET: authSecret,
        AUTH_TEST_PROVIDER_ORIGIN: "http://127.0.0.1:3201",
        DATABASE_URL: databaseUrl,
        FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
        FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3103/api/health",
    },
  ],
});
