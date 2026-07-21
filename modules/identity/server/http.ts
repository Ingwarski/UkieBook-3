import "server-only";

import type { AuthRuntimeConfig } from "./config";

export function flowCookieName(config: AuthRuntimeConfig): string {
  return config.appOrigin.startsWith("https://")
    ? "__Host-ukiebook_oauth_flow"
    : "ukiebook_oauth_flow";
}

export function sessionCookieName(config: AuthRuntimeConfig): string {
  return config.appOrigin.startsWith("https://")
    ? "__Host-ukiebook_session"
    : "ukiebook_session";
}

export function secureCookie(config: AuthRuntimeConfig): boolean {
  return config.appOrigin.startsWith("https://");
}

export function assertSameOriginMutation(
  headers: Headers,
  appOrigin: string,
): void {
  const origin = headers.get("origin");
  if (origin) {
    if (origin !== appOrigin) {
      throw new Error("Cross-origin mutation rejected");
    }
    return;
  }
  const referer = headers.get("referer");
  if (!referer || new URL(referer).origin !== appOrigin) {
    throw new Error("Mutation origin is missing or invalid");
  }
}

export function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
  };
}
