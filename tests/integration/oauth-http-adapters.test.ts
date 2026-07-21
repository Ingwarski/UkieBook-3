import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../../db/migrate";
import { adaptPGlite } from "../../db/pglite";
import type { SqlDatabase } from "../../db/query";
import { authRuntimeConfig, createProviderRegistry } from "../../modules/identity/server/config";
import { finishOAuthFlow, startOAuthFlow } from "../../modules/identity/server/service";
import type { OAuthProviderId } from "../../modules/identity/types";
import { readServerEnvironment } from "../../modules/platform/environment/runtime";
import {
  startOAuthProviderSimulator,
  type OAuthProviderSimulator,
} from "../../scripts/oauth-provider-simulator";

const authSecret = Buffer.alloc(32, 11).toString("base64url");

describe("UNIT-01 production OAuth HTTP adapters", () => {
  let database: SqlDatabase;
  let pglite: PGlite;
  let simulator: OAuthProviderSimulator;

  beforeAll(async () => {
    simulator = await startOAuthProviderSimulator();
  });

  afterAll(async () => {
    await simulator.close();
  });

  beforeEach(async () => {
    pglite = await PGlite.create();
    database = adaptPGlite(pglite);
    await applyMigrations(database);
  });

  afterEach(async () => {
    await database.close?.();
  });

  it.each(["google", "facebook"] as const)(
    "verifies %s code exchange through the loopback provider protocol",
    async (providerId: OAuthProviderId) => {
      const environment = readServerEnvironment({
        APP_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:3100",
        AUTH_SECRET: authSecret,
        AUTH_TEST_PROVIDER_ORIGIN: simulator.origin,
        DATABASE_URL: "postgres://unit:unit@127.0.0.1:5432/unit",
        FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
        FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      });
      const config = authRuntimeConfig(environment);
      const provider = createProviderRegistry(environment).get(providerId);
      expect(provider).toBeTruthy();
      const started = await startOAuthFlow({
        config,
        database,
        intent: "default",
        provider: provider!,
        returnTo: "/cart",
      });
      const decision = new URL(`/${providerId}/decision`, simulator.origin);
      for (const [key, value] of started.authorizationUrl.searchParams) {
        decision.searchParams.set(key, value);
      }
      decision.searchParams.set("decision", "approve");
      const consent = await fetch(decision, { redirect: "manual" });
      expect(consent.status).toBe(302);
      const callback = new URL(consent.headers.get("location") ?? "");
      const finished = await finishOAuthFlow({
        browserBinding: started.browserBinding,
        callbackUrl: callback,
        config,
        database,
        provider: provider!,
      });
      expect(finished.redirectTo).toBe("/cart");

      const account = await database.query<{
        provider: string;
        provider_email: string;
        provider_subject: string;
      }>(
        `
          SELECT provider, provider_subject, provider_email
          FROM oauth_accounts
        `,
      );
      expect(account.rows[0]).toMatchObject({
        provider: providerId,
        provider_email: `${providerId}-private@simulator.test`,
        provider_subject: `${providerId}-simulated-subject`,
      });
      const columns = await database.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'oauth_accounts'
        ORDER BY column_name
      `);
      expect(columns.rows.map((row) => row.column_name)).not.toEqual(
        expect.arrayContaining(["access_token", "refresh_token", "id_token"]),
      );
    },
  );

  it.each([
    ["forged_signature", "provider_id_token_signature_rejected"],
    ["wrong_nonce", "provider_token_response_rejected"],
    ["userinfo_subject_mismatch", "provider_userinfo_rejected"],
  ] as const)(
    "fails closed for Google %s responses",
    async (fault, expectedFailureCode) => {
      const environment = readServerEnvironment({
        APP_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:3100",
        AUTH_SECRET: authSecret,
        AUTH_TEST_PROVIDER_ORIGIN: simulator.origin,
        DATABASE_URL: "postgres://unit:unit@127.0.0.1:5432/unit",
        FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
        FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      });
      const config = authRuntimeConfig(environment);
      const provider = createProviderRegistry(environment).get("google");
      expect(provider).toBeTruthy();
      const started = await startOAuthFlow({
        config,
        database,
        intent: "default",
        provider: provider!,
        returnTo: "/cart",
      });
      const decision = new URL("/google/decision", simulator.origin);
      for (const [key, value] of started.authorizationUrl.searchParams) {
        decision.searchParams.set(key, value);
      }
      decision.searchParams.set("decision", "approve");
      decision.searchParams.set("fault", fault);
      const consent = await fetch(decision, { redirect: "manual" });
      expect(consent.status).toBe(302);
      const callback = new URL(consent.headers.get("location") ?? "");

      await expect(
        finishOAuthFlow({
          browserBinding: started.browserBinding,
          callbackUrl: callback,
          config,
          database,
          provider: provider!,
        }),
      ).rejects.toMatchObject({
        code: "provider_failed",
        intent: "default",
        returnTo: "/cart",
      });

      const flow = await database.query<{
        failure_code: string;
        status: string;
      }>("SELECT status, failure_code FROM oauth_flows");
      expect(flow.rows[0]).toEqual({
        failure_code: expectedFailureCode,
        status: "failed",
      });
      const persistedIdentity = await database.query<{
        account_count: number;
        session_count: number;
        user_count: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM oauth_accounts) AS account_count,
          (SELECT COUNT(*)::int FROM sessions) AS session_count,
          (SELECT COUNT(*)::int FROM users) AS user_count
      `);
      expect(persistedIdentity.rows[0]).toEqual({
        account_count: 0,
        session_count: 0,
        user_count: 0,
      });
      const audit = await database.query<{
        event_type: string;
        provider: string;
        reason_code: string;
      }>(`
        SELECT event_type, provider, reason_code
        FROM identity_audit_events
      `);
      expect(audit.rows).toEqual([
        {
          event_type: "login_failed",
          provider: "google",
          reason_code: expectedFailureCode,
        },
      ]);
    },
  );
});
