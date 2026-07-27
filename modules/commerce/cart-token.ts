import { createHash, randomBytes } from "node:crypto";

export const ANONYMOUS_CART_COOKIE_NAME = "ukiebook_cart";

export function createAnonymousCartToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isAnonymousCartToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(value)
  );
}

export function anonymousCartTokenDigest(token: string): string {
  if (!isAnonymousCartToken(token)) {
    throw new Error("Anonymous cart token is invalid");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function anonymousCartCookieOptions(appOrigin: string): {
  readonly httpOnly: true;
  readonly maxAge: number;
  readonly path: "/";
  readonly sameSite: "lax";
  readonly secure: boolean;
} {
  const origin = new URL(appOrigin);
  return {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: origin.protocol === "https:",
  };
}
