import "server-only";

import { cookies } from "next/headers";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  isAnonymousCartToken,
} from "../modules/commerce/cart-token";
import {
  commerceRuntime,
  getCartCount,
  type CartIdentity,
} from "../modules/commerce/server";
import type { SessionContext } from "../modules/identity/server/session";

interface CookieReader {
  get(name: string): { readonly value: string } | undefined;
}

export function anonymousCartTokenFrom(
  cookieReader: CookieReader,
): string | undefined {
  const value = cookieReader.get(ANONYMOUS_CART_COOKIE_NAME)?.value;
  return isAnonymousCartToken(value) ? value : undefined;
}

export async function currentAnonymousCartToken(): Promise<string | undefined> {
  return anonymousCartTokenFrom(await cookies());
}

export function cartIdentity(
  session: SessionContext | null,
  anonymousToken: string | undefined,
): CartIdentity {
  return {
    anonymousToken,
    buyerUserId: session?.session.userId,
  };
}

export async function currentCartCount(
  session: SessionContext | null,
): Promise<number> {
  const runtime = commerceRuntime();
  return getCartCount(
    runtime.database,
    cartIdentity(session, await currentAnonymousCartToken()),
  );
}
