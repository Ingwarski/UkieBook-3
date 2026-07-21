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

  it("exposes only the allow-listed public key", () => {
    expect(
      readPublicEnvironment({
        DATABASE_URL: "postgres://must-not-leak",
        NEXT_PUBLIC_APP_ENV: "test"
      })
    ).toEqual({ NEXT_PUBLIC_APP_ENV: "test" });
  });
});
