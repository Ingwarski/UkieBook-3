import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../../db/migrate";
import { adaptPGlite } from "../../db/pglite";
import type { SqlDatabase } from "../../db/query";
import { loadPublicAuthorProfile } from "../../modules/author-profile/server/repository";
import { persistAuthorProfile } from "../../modules/author-profile/server/service";
import type { AuthRuntimeConfig } from "../../modules/identity/server/config";
import type {
  AuthorizationRequestInput,
  OAuthProvider,
  ProviderCallbackInput,
  VerifiedProviderIdentity,
} from "../../modules/identity/server/provider";
import { OAuthCallbackFailure, finishOAuthFlow, startOAuthFlow } from "../../modules/identity/server/service";
import { sessionContextFromToken } from "../../modules/identity/server/session";
import type { OAuthProviderId } from "../../modules/identity/types";

const secret = Buffer.alloc(32, 9).toString("base64url");
const config: AuthRuntimeConfig = {
  appEnv: "test",
  appOrigin: "http://127.0.0.1:3100",
  authSecret: secret,
  flowLifetimeSeconds: 600,
  sessionAbsoluteLifetimeSeconds: 30 * 24 * 60 * 60,
  sessionIdleLifetimeSeconds: 7 * 24 * 60 * 60,
};

class DeterministicProvider implements OAuthProvider {
  lastAuthorization?: AuthorizationRequestInput;
  lastCallback?: ProviderCallbackInput;

  constructor(
    readonly id: OAuthProviderId,
    private readonly identity: VerifiedProviderIdentity,
  ) {}

  createAuthorizationUrl(input: AuthorizationRequestInput): URL {
    this.lastAuthorization = input;
    const url = new URL(`https://provider.example/${this.id}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", input.redirectUri);
    if (input.nonce) url.searchParams.set("nonce", input.nonce);
    return url;
  }

  async exchangeAndVerify(input: ProviderCallbackInput) {
    this.lastCallback = input;
    expect(input.callbackUrl.searchParams.get("state")).toBe(input.expectedState);
    expect(input.codeVerifier.length).toBeGreaterThanOrEqual(43);
    if (this.id === "google") expect(input.expectedNonce).toBeTruthy();
    return this.identity;
  }
}

describe("UNIT-01 identity and Author profile integration", () => {
  let pglite: PGlite;
  let database: SqlDatabase;

  beforeEach(async () => {
    pglite = await PGlite.create();
    database = adaptPGlite(pglite);
    await applyMigrations(database);
  });

  afterEach(async () => {
    await database.close?.();
  });

  async function login(provider: DeterministicProvider, intent: "default" | "author_onboarding") {
    const started = await startOAuthFlow({
      config,
      database,
      intent,
      provider,
      returnTo: intent === "author_onboarding" ? "/author/profile" : "/cart",
    });
    const state = started.authorizationUrl.searchParams.get("state");
    expect(started.authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(started.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(started.authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${config.appOrigin}/api/auth/${provider.id}/callback`,
    );
    expect(state).toBeTruthy();
    return {
      ...started,
      callback: new URL(
        `/api/auth/${provider.id}/callback?code=verified-code&state=${encodeURIComponent(state ?? "")}`,
        config.appOrigin,
      ),
    };
  }

  it("runs callback to hashed session to atomic Author profile and role grant", async () => {
    const provider = new DeterministicProvider("google", {
      displayName: "Private Google Name",
      email: "private-google@example.test",
      emailVerified: true,
      provider: "google",
      subject: "google-subject-1",
    });
    const started = await login(provider, "author_onboarding");
    const finished = await finishOAuthFlow({
      browserBinding: started.browserBinding,
      callbackUrl: started.callback,
      config,
      database,
      provider,
    });
    expect(finished.redirectTo).toBe("/author/profile");

    const digestRows = await database.query<{
      raw_present: boolean;
      token_digest: string;
    }>(
      `
        SELECT token_digest,
               token_digest = $1 AS raw_present
        FROM sessions
      `,
      [finished.sessionToken],
    );
    expect(digestRows.rows[0]?.raw_present).toBe(false);
    expect(digestRows.rows[0]?.token_digest).toMatch(/^[0-9a-f]{64}$/u);

    const firstContext = await sessionContextFromToken({
      config,
      database,
      token: finished.sessionToken,
    });
    expect(firstContext?.session.roles).toEqual(["buyer"]);
    expect(firstContext?.session.authorOnboarding).toBe(true);
    expect(firstContext).not.toBeNull();

    const saved = await persistAuthorProfile({
      config,
      database,
      publicName: "Леся Українка",
      sessionContext: firstContext!,
    });
    expect(saved.redirectTo).toBe("/author/publish");
    expect(saved.roleGranted).toBe(true);
    expect(saved.replacementSession?.token).toBeTruthy();
    await expect(
      sessionContextFromToken({ config, database, token: finished.sessionToken }),
    ).resolves.toBeNull();
    const replacement = await sessionContextFromToken({
      config,
      database,
      token: saved.replacementSession?.token,
    });
    expect(replacement?.session.roles).toEqual(["author", "buyer"]);
    expect(replacement?.session.authorOnboarding).toBe(false);

    await database.query(
      `
        INSERT INTO author_payout_details (
          user_id, schema_version, key_id, nonce, ciphertext, authentication_tag
        ) VALUES ($1, 1, 'unit-test-key', $2, $3, $4)
      `,
      [
        replacement?.session.userId,
        new Uint8Array(12).fill(1),
        new TextEncoder().encode("BANK-TAX-PAYOUT-SENTINEL"),
        new Uint8Array(16).fill(2),
      ],
    );
    const publicProfile = await loadPublicAuthorProfile(
      database,
      replacement?.session.userId ?? "",
    );
    expect(publicProfile).toEqual({
      authorId: replacement?.session.userId,
      publicName: "Леся Українка",
    });
    const serialized = JSON.stringify(publicProfile);
    expect(serialized).not.toContain("private-google@example.test");
    expect(serialized).not.toContain("BANK-TAX-PAYOUT-SENTINEL");
    expect(Object.keys(publicProfile ?? {}).sort()).toEqual(["authorId", "publicName"]);

    const audit = await database.query<{ event_type: string }>(
      "SELECT event_type FROM identity_audit_events ORDER BY created_at, id",
    );
    const eventTypes = audit.rows.map((row) => row.event_type);
    expect(eventTypes.filter((type) => type === "role_granted")).toHaveLength(2);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["login_succeeded", "author_profile_updated"]),
    );
    await expect(
      database.query("UPDATE identity_audit_events SET reason_code = 'tampered'"),
    ).rejects.toThrow(/append-only/u);
  });

  it("rejects replay, wrong browser binding, expiry and provider mix-up", async () => {
    const google = new DeterministicProvider("google", {
      emailVerified: true,
      provider: "google",
      subject: "security-subject",
    });
    const started = await login(google, "default");
    await expect(
      finishOAuthFlow({
        browserBinding: "wrong-browser",
        callbackUrl: started.callback,
        config,
        database,
        provider: google,
      }),
    ).rejects.toMatchObject({ code: "invalid_flow" } satisfies Partial<OAuthCallbackFailure>);

    const facebook = new DeterministicProvider("facebook", {
      emailVerified: false,
      provider: "facebook",
      subject: "security-subject",
    });
    await expect(
      finishOAuthFlow({
        browserBinding: started.browserBinding,
        callbackUrl: started.callback,
        config,
        database,
        provider: facebook,
      }),
    ).rejects.toMatchObject({ code: "invalid_flow" } satisfies Partial<OAuthCallbackFailure>);

    const valid = await finishOAuthFlow({
      browserBinding: started.browserBinding,
      callbackUrl: started.callback,
      config,
      database,
      provider: google,
    });
    expect(valid.redirectTo).toBe("/cart");
    await expect(
      finishOAuthFlow({
        browserBinding: started.browserBinding,
        callbackUrl: started.callback,
        config,
        database,
        provider: google,
      }),
    ).rejects.toMatchObject({ code: "invalid_flow" } satisfies Partial<OAuthCallbackFailure>);

    const expired = await login(google, "default");
    await database.query(`
      UPDATE oauth_flows
      SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 seconds',
          expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE status = 'pending'
    `);
    await expect(
      finishOAuthFlow({
        browserBinding: expired.browserBinding,
        callbackUrl: expired.callback,
        config,
        database,
        provider: google,
      }),
    ).rejects.toMatchObject({ code: "invalid_flow" } satisfies Partial<OAuthCallbackFailure>);
  });

  it("never auto-links Google and Facebook accounts by matching email", async () => {
    const commonEmail = "same-email@example.test";
    const google = new DeterministicProvider("google", {
      email: commonEmail,
      emailVerified: true,
      provider: "google",
      subject: "google-distinct",
    });
    const facebook = new DeterministicProvider("facebook", {
      email: commonEmail,
      emailVerified: false,
      provider: "facebook",
      subject: "facebook-distinct",
    });
    for (const provider of [google, facebook]) {
      const started = await login(provider, "default");
      await finishOAuthFlow({
        browserBinding: started.browserBinding,
        callbackUrl: started.callback,
        config,
        database,
        provider,
      });
    }
    const counts = await database.query<{ accounts: number; users: number }>(`
      SELECT
        (SELECT COUNT(*)::int FROM oauth_accounts) AS accounts,
        (SELECT COUNT(*)::int FROM users) AS users
    `);
    expect(counts.rows[0]).toEqual({ accounts: 2, users: 2 });
    const managers = await database.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM user_roles WHERE role = 'manager'",
    );
    expect(managers.rows[0]?.count).toBe(0);
  });
});
