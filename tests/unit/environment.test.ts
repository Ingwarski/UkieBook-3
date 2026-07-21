import { describe, expect, it } from "vitest";

import {
  readServerEnvironment,
  SERVER_ENV_BUNDLE_MARKER
} from "@/modules/platform/environment/server";
import { readPublicEnvironment } from "@/modules/platform/environment/public";

describe("environment contracts", () => {
  it("validates server-only configuration with deterministic defaults", () => {
    const environment = readServerEnvironment({
      DATABASE_URL: "postgres://ukiebook:ukiebook@localhost:5432/ukiebook"
    });

    expect(environment).toEqual({
      APP_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
      APP_REVISION: "development",
      DATABASE_URL: "postgres://ukiebook:ukiebook@localhost:5432/ukiebook",
      JOB_LEASE_SECONDS: 60,
      JOB_MAX_ATTEMPTS: 5,
      SCHEDULER_TICK_MS: 60_000,
      WORKER_ID: "local-worker"
    });
    expect(SERVER_ENV_BUNDLE_MARKER).toBe("UKIEBOOK_SERVER_ENV_ONLY_v1");
  });

  it("rejects missing database configuration", () => {
    expect(() => readServerEnvironment({})).toThrow();
  });

  it("rejects copied AUTH_SECRET placeholders and accepts canonical random bytes", () => {
    const database = "postgres://ukiebook:ukiebook@localhost:5432/ukiebook";
    expect(() =>
      readServerEnvironment({
        AUTH_SECRET: "<base64url-secret-with-at-least-32-random-bytes>",
        DATABASE_URL: database,
      }),
    ).toThrow(/AUTH_SECRET/u);
    expect(() =>
      readServerEnvironment({
        AUTH_SECRET: "replace-with-generated-secret",
        DATABASE_URL: database,
      }),
    ).toThrow(/AUTH_SECRET/u);

    const authSecret = Buffer.alloc(32, 7).toString("base64url");
    expect(
      readServerEnvironment({
        AUTH_SECRET: authSecret,
        DATABASE_URL: database,
        FACEBOOK_OAUTH_CLIENT_ID: "",
        GOOGLE_OAUTH_CLIENT_SECRET: "  ",
      }),
    ).toMatchObject({ AUTH_SECRET: authSecret });
  });

  it("exposes only the allow-listed public key", () => {
    expect(
      readPublicEnvironment({
        DATABASE_URL: "postgres://must-not-leak",
        NEXT_PUBLIC_APP_ENV: "test"
      })
    ).toEqual({ NEXT_PUBLIC_APP_ENV: "test" });
  });
});
