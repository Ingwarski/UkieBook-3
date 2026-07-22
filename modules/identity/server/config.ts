import "server-only";

import type { ServerEnvironment } from "../../platform/environment/server";
import type { OAuthProviderId } from "../types";
import {
  FacebookOAuthProvider,
  GoogleOAuthProvider,
  type OAuthProvider,
  type ProviderDefinition,
} from "./provider";

export interface AuthRuntimeConfig {
  readonly appEnv: ServerEnvironment["APP_ENV"];
  readonly appOrigin: string;
  readonly authSecret: string;
  readonly flowLifetimeSeconds: number;
  readonly sessionAbsoluteLifetimeSeconds: number;
  readonly sessionIdleLifetimeSeconds: number;
}

export type AuthCookieConfig = Pick<AuthRuntimeConfig, "appOrigin">;

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_ORIGIN must be a bare origin without credentials, path, query, or hash");
  }
  return url.origin;
}

function isLoopback(url: URL): boolean {
  return (
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") &&
    (url.protocol === "http:" || url.protocol === "https:")
  );
}

export function authRuntimeConfig(environment: ServerEnvironment): AuthRuntimeConfig {
  if (!environment.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required for identity operations");
  }
  const { appOrigin } = authCookieConfig(environment);
  if (environment.AUTH_TEST_PROVIDER_ORIGIN && environment.APP_ENV !== "test") {
    throw new Error("AUTH_TEST_PROVIDER_ORIGIN is allowed only when APP_ENV=test");
  }
  return {
    appEnv: environment.APP_ENV,
    appOrigin,
    authSecret: environment.AUTH_SECRET,
    flowLifetimeSeconds: 10 * 60,
    sessionAbsoluteLifetimeSeconds: 30 * 24 * 60 * 60,
    sessionIdleLifetimeSeconds: 7 * 24 * 60 * 60,
  };
}

export function authCookieConfig(environment: ServerEnvironment): AuthCookieConfig {
  const appOrigin = normalizedOrigin(environment.APP_ORIGIN);
  if (environment.APP_ENV === "production" && !appOrigin.startsWith("https://")) {
    throw new Error("Production APP_ORIGIN must use HTTPS");
  }
  return { appOrigin };
}

function productionDefinition(
  provider: OAuthProviderId,
  clientId: string,
  clientSecret: string,
): ProviderDefinition {
  if (provider === "google") {
    return {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId,
      clientSecret,
      issuer: "https://accounts.google.com",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      profileEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
    };
  }
  return {
    authorizationEndpoint: "https://www.facebook.com/dialog/oauth",
    clientId,
    clientSecret,
    issuer: "https://www.facebook.com",
    profileEndpoint: "https://graph.facebook.com/me",
    tokenEndpoint: "https://graph.facebook.com/oauth/access_token",
  };
}

function loopbackDefinition(
  provider: OAuthProviderId,
  originText: string,
  clientId: string,
  clientSecret: string,
): ProviderDefinition {
  const origin = new URL(originText);
  if (!isLoopback(origin) || origin.origin !== originText.replace(/\/$/u, "")) {
    throw new Error("AUTH_TEST_PROVIDER_ORIGIN must be a bare loopback origin");
  }
  const root = `${origin.origin}/${provider}`;
  return {
    allowInsecureRequests: origin.protocol === "http:",
    authorizationEndpoint: `${root}/authorize`,
    clientId,
    clientSecret,
    issuer: root,
    jwksUri: provider === "google" ? `${root}/jwks` : undefined,
    profileEndpoint: `${root}/userinfo`,
    tokenEndpoint: `${root}/token`,
  };
}

export function createProviderRegistry(
  environment: ServerEnvironment,
): ReadonlyMap<OAuthProviderId, OAuthProvider> {
  const credentials = {
    facebook: {
      clientId: environment.FACEBOOK_OAUTH_CLIENT_ID,
      clientSecret: environment.FACEBOOK_OAUTH_CLIENT_SECRET,
    },
    google: {
      clientId: environment.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET,
    },
  } as const;
  for (const [provider, values] of Object.entries(credentials)) {
    if (!values.clientId || !values.clientSecret) {
      throw new Error(`${provider.toUpperCase()} OAuth credentials are required`);
    }
  }

  const definition = (provider: OAuthProviderId): ProviderDefinition => {
    const values = credentials[provider];
    const clientId = values.clientId as string;
    const clientSecret = values.clientSecret as string;
    if (environment.AUTH_TEST_PROVIDER_ORIGIN) {
      if (environment.APP_ENV !== "test") {
        throw new Error("Loopback OAuth providers are allowed only in APP_ENV=test");
      }
      return loopbackDefinition(
        provider,
        environment.AUTH_TEST_PROVIDER_ORIGIN,
        clientId,
        clientSecret,
      );
    }
    return productionDefinition(provider, clientId, clientSecret);
  };

  return new Map<OAuthProviderId, OAuthProvider>([
    ["google", new GoogleOAuthProvider(definition("google"))],
    ["facebook", new FacebookOAuthProvider(definition("facebook"))],
  ]);
}

export function callbackUri(appOrigin: string, provider: OAuthProviderId): string {
  return `${appOrigin}/api/auth/${provider}/callback`;
}
