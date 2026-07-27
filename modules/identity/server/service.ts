import "server-only";

import * as oauth from "oauth4webapi";

import type { SqlDatabase } from "../../platform/sql-port";
import { withSqlTransaction } from "../../platform/sql-port";
import type { AuthIntent, OAuthProviderId } from "../types";
import { callbackUri, type AuthRuntimeConfig } from "./config";
import {
  openAuthValue,
  randomOpaqueToken,
  sealAuthValue,
  sha256Hex,
} from "./crypto";
import { ProviderProtocolFailure, type OAuthProvider } from "./provider";
import {
  appendFailedLoginAudit,
  claimOAuthFlow,
  completeOAuthLogin,
  insertOAuthFlow,
  markOAuthFlowFailed,
} from "./repository";

export interface OAuthStartResult {
  readonly authorizationUrl: URL;
  readonly browserBinding: string;
  readonly expiresAt: Date;
}

function safeProviderFailureCode(error: unknown): string {
  if (error instanceof ProviderProtocolFailure) {
    return `provider_${error.failureCode}`;
  }
  if (error instanceof oauth.AuthorizationResponseError) {
    return "provider_authorization_denied";
  }
  if (error instanceof oauth.ResponseBodyError) {
    return "provider_token_response_rejected";
  }
  if (error instanceof oauth.OperationProcessingError) {
    const suffix = (error.code ?? "processing_error")
      .toLowerCase()
      .replace(/[^a-z0-9_]/gu, "_")
      .slice(0, 48);
    return `provider_${suffix}`;
  }
  if (error instanceof TypeError) {
    return "provider_transport_or_shape_error";
  }
  return "provider_exchange_failed";
}

export async function startOAuthFlow(input: {
  readonly config: AuthRuntimeConfig;
  readonly database: SqlDatabase;
  readonly intent: AuthIntent;
  readonly provider: OAuthProvider;
  readonly returnTo: string;
}): Promise<OAuthStartResult> {
  const state = randomOpaqueToken();
  const browserBinding = randomOpaqueToken();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const nonce = input.provider.id === "google" ? oauth.generateRandomNonce() : undefined;
  const redirectUri = callbackUri(input.config.appOrigin, input.provider.id);
  const expiresAt = new Date(Date.now() + input.config.flowLifetimeSeconds * 1_000);
  await insertOAuthFlow(input.database, {
    browserBindingDigest: sha256Hex(browserBinding),
    expiresAt,
    intent: input.intent,
    provider: input.provider.id,
    returnTo: input.returnTo,
    sealedCodeVerifier: sealAuthValue(codeVerifier, input.config.authSecret),
    sealedNonce: nonce ? sealAuthValue(nonce, input.config.authSecret) : undefined,
    stateDigest: sha256Hex(state),
  });
  return {
    authorizationUrl: input.provider.createAuthorizationUrl({
      codeChallenge,
      nonce,
      redirectUri,
      state,
    }),
    browserBinding,
    expiresAt,
  };
}

export class OAuthCallbackFailure extends Error {
  constructor(
    readonly code: "invalid_flow" | "provider_failed",
    readonly returnTo = "/",
    readonly intent: AuthIntent = "default",
  ) {
    super(code);
  }
}

export interface OAuthCallbackResult {
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
  readonly redirectTo: string;
  readonly sessionToken: string;
  readonly userId: string;
}

export async function finishOAuthFlow(input: {
  readonly browserBinding: string | undefined;
  readonly callbackUrl: URL;
  readonly config: AuthRuntimeConfig;
  readonly database: SqlDatabase;
  readonly provider: OAuthProvider;
}): Promise<OAuthCallbackResult> {
  const state = input.callbackUrl.searchParams.get("state");
  if (!state || state.length > 256 || !input.browserBinding) {
    throw new OAuthCallbackFailure("invalid_flow");
  }
  const flow = await claimOAuthFlow(input.database, {
    browserBindingDigest: sha256Hex(input.browserBinding),
    provider: input.provider.id,
    stateDigest: sha256Hex(state),
  });
  if (!flow) {
    throw new OAuthCallbackFailure("invalid_flow");
  }

  let identity;
  try {
    identity = await input.provider.exchangeAndVerify({
      callbackUrl: input.callbackUrl,
      codeVerifier: openAuthValue(flow.sealedCodeVerifier, input.config.authSecret),
      expectedNonce: flow.sealedNonce
        ? openAuthValue(flow.sealedNonce, input.config.authSecret)
        : undefined,
      expectedState: state,
      redirectUri: callbackUri(input.config.appOrigin, input.provider.id),
    });
  } catch (error) {
    const failureCode = safeProviderFailureCode(error);
    await withSqlTransaction(input.database, async (transaction) => {
      await markOAuthFlowFailed(transaction, flow.id, failureCode);
      await appendFailedLoginAudit(
        transaction,
        input.provider.id,
        failureCode,
      );
    });
    throw new OAuthCallbackFailure("provider_failed", flow.returnTo, flow.intent);
  }

  const now = Date.now();
  const idleExpiresAt = new Date(
    now + input.config.sessionIdleLifetimeSeconds * 1_000,
  );
  const absoluteExpiresAt = new Date(
    now + input.config.sessionAbsoluteLifetimeSeconds * 1_000,
  );
  const sessionToken = randomOpaqueToken();
  let completed: Awaited<ReturnType<typeof completeOAuthLogin>>;
  try {
    completed = await withSqlTransaction(input.database, (transaction) =>
      completeOAuthLogin(transaction, {
        flow,
        identity,
        session: {
          absoluteExpiresAt,
          authorOnboarding: false,
          idleExpiresAt,
          tokenDigest: sha256Hex(sessionToken),
        },
      }),
    );
  } catch {
    try {
      await withSqlTransaction(input.database, async (transaction) => {
        await markOAuthFlowFailed(transaction, flow.id, "storage_completion_failed");
        await appendFailedLoginAudit(
          transaction,
          input.provider.id,
          "storage_completion_failed",
        );
      });
    } catch {
      // The callback still fails closed if the database cannot record the failure.
    }
    throw new OAuthCallbackFailure("provider_failed", flow.returnTo, flow.intent);
  }

  let redirectTo = flow.returnTo;
  if (completed.authorOnboarding || (completed.roles.includes("author") && !completed.hasAuthorProfile)) {
    redirectTo = "/author/profile";
  }
  return {
    absoluteExpiresAt,
    idleExpiresAt,
    redirectTo,
    sessionToken,
    userId: completed.userId,
  };
}

export function oauthErrorMessage(code: string | null | undefined): string | undefined {
  switch (code) {
    case "invalid_flow":
      return "Сеанс входу недійсний або вже використаний. Почніть вхід ще раз.";
    case "provider_failed":
      return "Не вдалося завершити вхід через провайдера. Спробуйте ще раз.";
    case "provider_unavailable":
      return "Вхід через цього провайдера тимчасово недоступний.";
    case "author_required":
      return "Для цієї дії потрібен профіль автора.";
    default:
      return undefined;
  }
}

export function providerFromCallback(provider: string): OAuthProviderId | null {
  return provider === "google" || provider === "facebook" ? provider : null;
}
