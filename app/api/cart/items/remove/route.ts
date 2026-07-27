import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  anonymousCartCookieOptions,
  commerceRuntime,
  CommerceConflictError,
  CommerceInputError,
  removeCartItem,
} from "../../../../../modules/commerce/server";
import { normalizeReturnTo } from "../../../../../modules/identity/return-to";
import {
  assertSameOriginMutation,
  noStoreHeaders,
} from "../../../../../modules/identity/server/http";
import { currentSessionContext } from "../../../../../modules/identity/server/next-session";
import { assertValidCsrf } from "../../../../../modules/identity/server/session";
import { identityRuntime } from "../../../../../modules/identity/server/runtime";
import {
  anonymousCartTokenFrom,
  cartIdentity,
} from "../../../../commerce-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: NextRequest) {
  const commerce = commerceRuntime();
  let form: FormData;
  try {
    assertSameOriginMutation(request.headers, commerce.config.appOrigin);
    form = await request.formData();
  } catch {
    return new NextResponse("Request rejected", {
      headers: noStoreHeaders(),
      status: 403,
    });
  }
  const session = await currentSessionContext();
  if (session) {
    try {
      assertValidCsrf(form.get("csrfToken"), session, identityRuntime().config);
    } catch {
      return new NextResponse("Request rejected", {
        headers: noStoreHeaders(),
        status: 403,
      });
    }
  }

  try {
    const anonymousToken = anonymousCartTokenFrom(request.cookies);
    const result = await removeCartItem(commerce.database, {
      ...cartIdentity(session, anonymousToken),
      bookId: text(form.get("bookId")),
    });
    const returnTo = normalizeReturnTo(
      text(form.get("returnTo")),
      commerce.config.appOrigin,
      "/cart",
    );
    const target = new URL(returnTo, commerce.config.appOrigin);
    target.searchParams.set("removed", "1");
    const response = NextResponse.redirect(target, {
      headers: noStoreHeaders(),
      status: 303,
    });
    if (!session && result?.anonymousToken) {
      response.cookies.set(
        ANONYMOUS_CART_COOKIE_NAME,
        result.anonymousToken,
        anonymousCartCookieOptions(commerce.config.appOrigin),
      );
    } else if (session && anonymousToken) {
      response.cookies.set(ANONYMOUS_CART_COOKIE_NAME, "", {
        ...anonymousCartCookieOptions(commerce.config.appOrigin),
        expires: new Date(0),
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    const code =
      error instanceof CommerceInputError
        ? 400
        : error instanceof CommerceConflictError
          ? 409
          : 500;
    return new NextResponse("Cart update failed", {
      headers: noStoreHeaders(),
      status: code,
    });
  }
}
