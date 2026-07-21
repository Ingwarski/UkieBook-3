import "server-only";

import * as oauth from "oauth4webapi";
import { z } from "zod";

import type { OAuthProviderId } from "../types";

export interface VerifiedProviderIdentity {
  readonly displayName?: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly provider: OAuthProviderId;
  readonly subject: string;
}

export interface AuthorizationRequestInput {
  readonly codeChallenge: string;
  readonly nonce?: string;
  readonly redirectUri: string;
  readonly state: string;
}

export interface ProviderCallbackInput {
  readonly callbackUrl: URL;
  readonly codeVerifier: string;
  readonly expectedNonce?: string;
  readonly expectedState: string;
  readonly redirectUri: string;
}

export interface OAuthProvider {
  readonly id: OAuthProviderId;
  createAuthorizationUrl(input: AuthorizationRequestInput): URL;
  exchangeAndVerify(input: ProviderCallbackInput): Promise<VerifiedProviderIdentity>;
}

export class ProviderProtocolFailure extends Error {
  constructor(readonly failureCode: string, cause: unknown) {
    super(failureCode, { cause });
  }
}

interface ProviderDefinition {
  readonly allowInsecureRequests?: boolean;
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly issuer: string;
  readonly jwksUri?: string;
  readonly profileEndpoint: string;
  readonly tokenEndpoint: string;
}

const googleProfileSchema = z.object({
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().trim().min(1).optional(),
  sub: z.string().trim().min(1),
});

const facebookProfileSchema = z.object({
  email: z.string().email().optional(),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
});

const fetchOptions = {
  signal: () => AbortSignal.timeout(8_000),
};

function metadata(definition: ProviderDefinition, oidc: boolean): oauth.AuthorizationServer {
  return {
    authorization_endpoint: definition.authorizationEndpoint,
    id_token_signing_alg_values_supported: oidc ? ["RS256"] : undefined,
    issuer: definition.issuer,
    jwks_uri: definition.jwksUri,
    token_endpoint: definition.tokenEndpoint,
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    userinfo_endpoint: oidc ? definition.profileEndpoint : undefined,
  };
}

function client(definition: ProviderDefinition, oidc: boolean): oauth.Client {
  return {
    client_id: definition.clientId,
    id_token_signed_response_alg: oidc ? "RS256" : undefined,
    token_endpoint_auth_method: "client_secret_post",
  };
}

function authorizationParameters(
  definition: ProviderDefinition,
  input: AuthorizationRequestInput,
  scopes: string,
): URL {
  const url = new URL(definition.authorizationEndpoint);
  url.searchParams.set("client_id", definition.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.nonce) {
    url.searchParams.set("nonce", input.nonce);
  }
  return url;
}

abstract class StandardsOAuthProvider implements OAuthProvider {
  abstract readonly id: OAuthProviderId;

  constructor(protected readonly definition: ProviderDefinition) {}

  abstract createAuthorizationUrl(input: AuthorizationRequestInput): URL;
  abstract exchangeAndVerify(input: ProviderCallbackInput): Promise<VerifiedProviderIdentity>;

  protected requestOptions() {
    return this.definition.allowInsecureRequests
      ? { ...fetchOptions, [oauth.allowInsecureRequests]: true }
      : fetchOptions;
  }

  protected async exchange(
    input: ProviderCallbackInput,
    oidc: boolean,
  ): Promise<{ as: oauth.AuthorizationServer; client: oauth.Client; response: Response; tokens: oauth.TokenEndpointResponse }> {
    const as = metadata(this.definition, oidc);
    const oauthClient = client(this.definition, oidc);
    let callbackParameters: URLSearchParams;
    try {
      callbackParameters = oauth.validateAuthResponse(
        as,
        oauthClient,
        input.callbackUrl.searchParams,
        input.expectedState,
      );
    } catch (error) {
      const detail =
        error instanceof oauth.AuthorizationResponseError
          ? "authorization_denied"
          : error instanceof oauth.OperationProcessingError
            ? `authorization_${(error.code ?? "processing_error")
                .toLowerCase()
                .replace(/[^a-z0-9_]/gu, "_")
                .slice(0, 40)}`
            : "authorization_response_rejected";
      throw new ProviderProtocolFailure(detail, error);
    }
    let response: Response;
    try {
      response = await oauth.authorizationCodeGrantRequest(
        as,
        oauthClient,
        oauth.ClientSecretPost(this.definition.clientSecret),
        callbackParameters,
        input.redirectUri,
        input.codeVerifier,
        this.requestOptions(),
      );
    } catch (error) {
      throw new ProviderProtocolFailure("token_transport_failed", error);
    }
    let tokens: oauth.TokenEndpointResponse;
    try {
      tokens = await oauth.processAuthorizationCodeResponse(as, oauthClient, response, {
        expectedNonce: input.expectedNonce ?? oauth.expectNoNonce,
        requireIdToken: oidc,
      });
    } catch (error) {
      throw new ProviderProtocolFailure("token_response_rejected", error);
    }
    return { as, client: oauthClient, response, tokens };
  }
}

export class GoogleOAuthProvider extends StandardsOAuthProvider {
  readonly id = "google" as const;

  createAuthorizationUrl(input: AuthorizationRequestInput): URL {
    if (!input.nonce) {
      throw new Error("Google OAuth requires an OIDC nonce");
    }
    return authorizationParameters(this.definition, input, "openid email profile");
  }

  async exchangeAndVerify(input: ProviderCallbackInput): Promise<VerifiedProviderIdentity> {
    if (!input.expectedNonce) {
      throw new Error("Google OAuth callback requires the expected nonce");
    }
    const exchanged = await this.exchange(input, true);
    try {
      await oauth.validateApplicationLevelSignature(
        exchanged.as,
        exchanged.response,
        this.requestOptions(),
      );
    } catch (error) {
      throw new ProviderProtocolFailure("id_token_signature_rejected", error);
    }
    const claims = oauth.getValidatedIdTokenClaims(exchanged.tokens);
    if (!claims) {
      throw new Error("Google did not return a validated ID token");
    }
    let userInfo;
    try {
      const userInfoResponse = await oauth.userInfoRequest(
        exchanged.as,
        exchanged.client,
        exchanged.tokens.access_token,
        this.requestOptions(),
      );
      userInfo = googleProfileSchema.parse(
        await oauth.processUserInfoResponse(
          exchanged.as,
          exchanged.client,
          claims.sub,
          userInfoResponse,
        ),
      );
    } catch (error) {
      throw new ProviderProtocolFailure("userinfo_rejected", error);
    }
    return {
      displayName: userInfo.name,
      email: userInfo.email,
      emailVerified: userInfo.email_verified === true,
      provider: this.id,
      subject: userInfo.sub,
    };
  }
}

export class FacebookOAuthProvider extends StandardsOAuthProvider {
  readonly id = "facebook" as const;

  createAuthorizationUrl(input: AuthorizationRequestInput): URL {
    return authorizationParameters(this.definition, input, "email public_profile");
  }

  async exchangeAndVerify(input: ProviderCallbackInput): Promise<VerifiedProviderIdentity> {
    const exchanged = await this.exchange(input, false);
    const profileUrl = new URL(this.definition.profileEndpoint);
    profileUrl.searchParams.set("fields", "id,name,email");
    let response: Response;
    try {
      response = await oauth.protectedResourceRequest(
        exchanged.tokens.access_token,
        "GET",
        profileUrl,
        new Headers({ accept: "application/json" }),
        null,
        this.requestOptions(),
      );
    } catch (error) {
      throw new ProviderProtocolFailure("userinfo_transport_failed", error);
    }
    if (!response.ok) {
      throw new Error("Facebook profile request failed");
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 64_000) {
      throw new Error("Facebook profile response is too large");
    }
    let profile;
    try {
      profile = facebookProfileSchema.parse(await response.json());
    } catch (error) {
      throw new ProviderProtocolFailure("userinfo_rejected", error);
    }
    return {
      displayName: profile.name,
      email: profile.email,
      emailVerified: false,
      provider: this.id,
      subject: profile.id,
    };
  }
}

export type { ProviderDefinition };
