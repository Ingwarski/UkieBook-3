import { describe, expect, it } from "vitest";

import { validatePublicName } from "../../modules/author-profile/types";
import {
  normalizeAuthIntent,
  normalizeReturnTo,
} from "../../modules/identity/return-to";
import { decideRouteAccess } from "../../modules/identity/route-policy";
import type { AuthSession } from "../../modules/identity/types";
import { authRuntimeConfig, createProviderRegistry } from "../../modules/identity/server/config";
import {
  csrfTokenForSession,
  openAuthValue,
  randomOpaqueToken,
  sealAuthValue,
  verifyCsrfToken,
} from "../../modules/identity/server/crypto";
import {
  assertSameOriginMutation,
  flowCookieName,
  readSessionCookie,
  sessionCookieName,
} from "../../modules/identity/server/http";
import { readServerEnvironment } from "../../modules/platform/environment/runtime";

const appOrigin = "https://ukiebook.example";
const secret = Buffer.alloc(32, 7).toString("base64url");

function session(roles: AuthSession["roles"]): AuthSession {
  return {
    authorOnboarding: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    roles,
    sessionId: "session-1",
    userId: "user-1",
  };
}

describe("UNIT-01 identity security contracts", () => {
  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/%2f%2fevil.example/steal",
    "/%252f%252fevil.example/steal",
    "/\\evil.example/steal",
    "/author/%2e%2e/admin",
    "/author/../admin",
    "/%0d%0aLocation:https://evil.example",
    "javascript:alert(1)",
    "/api/auth/google/callback",
    "/_next/static/file.js",
    "/unknown-product-route",
  ])("rejects an unsafe return target: %s", (candidate) => {
    expect(normalizeReturnTo(candidate, appOrigin)).toBe("/");
  });

  it("keeps only allow-listed same-origin product routes and author intent", () => {
    expect(normalizeReturnTo("/cart?step=checkout", appOrigin)).toBe(
      "/cart?step=checkout",
    );
    expect(normalizeReturnTo("/author/profile", appOrigin)).toBe(
      "/author/profile",
    );
    expect(normalizeReturnTo("/admin", appOrigin)).toBe("/admin");
    expect(
      normalizeReturnTo(
        "/checkout/result?order=11111111-1111-4111-8111-111111111111",
        appOrigin,
      ),
    ).toBe(
      "/checkout/result?order=11111111-1111-4111-8111-111111111111",
    );
    expect(normalizeAuthIntent("default", "/author/profile")).toBe(
      "author_onboarding",
    );
    expect(normalizeAuthIntent("manager", "/")).toBe("default");
  });

  it("uses explicit capability checks instead of a role hierarchy", () => {
    expect(decideRouteAccess("/", null).outcome).toBe("allow");
    expect(decideRouteAccess("/library", null).outcome).toBe(
      "redirect_to_login",
    );
    expect(decideRouteAccess("/library", session(["buyer"])).outcome).toBe(
      "allow",
    );
    expect(decideRouteAccess("/author/profile", session(["buyer"])).outcome).toBe(
      "deny",
    );
    expect(decideRouteAccess("/author/profile", session(["author"])).outcome).toBe(
      "allow",
    );
    expect(decideRouteAccess("/admin", session(["author"])).outcome).toBe(
      "deny",
    );
    expect(decideRouteAccess("/admin", session(["manager"])).outcome).toBe(
      "allow",
    );
  });

  it("seals flow values and binds CSRF proof to the opaque session token", () => {
    const token = randomOpaqueToken();
    const sealed = sealAuthValue("pkce-verifier", secret);
    expect(sealed).not.toContain("pkce-verifier");
    expect(openAuthValue(sealed, secret)).toBe("pkce-verifier");
    expect(() => openAuthValue(`${sealed}x`, secret)).toThrow();
    const csrf = csrfTokenForSession(token, secret);
    expect(verifyCsrfToken(csrf, token, secret)).toBe(true);
    expect(verifyCsrfToken(csrf, `${token}x`, secret)).toBe(false);
  });

  it("rejects cross-origin mutation headers and accepts only the configured origin", () => {
    expect(() =>
      assertSameOriginMutation(new Headers({ origin: appOrigin }), appOrigin),
    ).not.toThrow();
    expect(() =>
      assertSameOriginMutation(
        new Headers({ referer: `${appOrigin}/admin/moderation` }),
        appOrigin,
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOriginMutation(
        new Headers({ origin: "https://attacker.invalid" }),
        appOrigin,
      ),
    ).toThrow(/Cross-origin mutation rejected/u);
    expect(() =>
      assertSameOriginMutation(new Headers(), appOrigin),
    ).toThrow(/origin is missing or invalid/u);
  });

  it("uses host-prefixed cookies whenever HTTPS makes the prefix enforceable", () => {
    const httpsConfig = {
      appEnv: "production",
      appOrigin,
      authSecret: secret,
      flowLifetimeSeconds: 600,
      sessionAbsoluteLifetimeSeconds: 2_592_000,
      sessionIdleLifetimeSeconds: 604_800,
    } as const;
    expect(flowCookieName(httpsConfig)).toBe("__Host-ukiebook_oauth_flow");
    expect(sessionCookieName(httpsConfig)).toBe("__Host-ukiebook_session");
    expect(
      flowCookieName({ ...httpsConfig, appEnv: "test", appOrigin: "http://127.0.0.1:3000" }),
    ).toBe("ukiebook_oauth_flow");

    const cookies = new Map([
      ["__Host-ukiebook_session", { value: "host-token" }],
      ["ukiebook_session", { value: "plain-token" }],
    ]);
    expect(readSessionCookie(cookies, httpsConfig)).toBe("host-token");
    expect(
      readSessionCookie(cookies, { appOrigin: "http://127.0.0.1:3000" }),
    ).toBe("plain-token");
    expect(
      readSessionCookie(
        new Map([["ukiebook_session", { value: "attacker-token" }]]),
        httpsConfig,
      ),
    ).toBeNull();
    expect(
      readSessionCookie(
        new Map([["__Host-ukiebook_session", { value: "stale-host-token" }]]),
        { appOrigin: "http://127.0.0.1:3000" },
      ),
    ).toBeNull();
  });

  it("validates a public name without inventing uniqueness", () => {
    expect(validatePublicName("  Леся   Українка  ")).toEqual({
      value: "Леся Українка",
    });
    expect(validatePublicName("x").error).toMatch(/2 символи/u);
    expect(validatePublicName("😀").error).toMatch(/2 символи/u);
    expect(validatePublicName("😀😀")).toEqual({ value: "😀😀" });
    expect(validatePublicName("😀".repeat(121)).error).toMatch(/120/u);
    expect(validatePublicName(`Автор\u202e`).error).toMatch(/службові/u);
    expect(validatePublicName("а".repeat(121)).error).toMatch(/120/u);
  });

  it("rejects loopback provider overrides outside APP_ENV=test", () => {
    const environment = readServerEnvironment({
      APP_ENV: "production",
      APP_ORIGIN: appOrigin,
      AUTH_SECRET: secret,
      AUTH_TEST_PROVIDER_ORIGIN: "http://127.0.0.1:3200",
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
      FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    });
    expect(() => authRuntimeConfig(environment)).toThrow(/only when APP_ENV=test/u);
    expect(() => createProviderRegistry(environment)).toThrow(/APP_ENV=test/u);
  });
});
