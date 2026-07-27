import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  addCartItem,
  anonymousCartCookieOptions,
  commerceRuntime,
  CommerceConflictError,
  CommerceInputError,
} from "../../../../modules/commerce/server";
import { normalizeReturnTo } from "../../../../modules/identity/return-to";
import {
  assertSameOriginMutation,
  noStoreHeaders,
} from "../../../../modules/identity/server/http";
import { currentSessionContext } from "../../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { assertValidCsrf } from "../../../../modules/identity/server/session";
import {
  anonymousCartTokenFrom,
  cartIdentity,
} from "../../../commerce-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CommerceInputError) {
    return new NextResponse("Invalid cart input", {
      headers: noStoreHeaders(),
      status: 400,
    });
  }
  if (error instanceof CommerceConflictError) {
    return new NextResponse("Cart update conflicts with current state", {
      headers: noStoreHeaders(),
      status: error.code === "BOOK_UNAVAILABLE" ? 409 : 422,
    });
  }
  return new NextResponse("Cart update failed", {
    headers: noStoreHeaders(),
    status: 500,
  });
}

export async function POST(request: NextRequest) {
  const runtimeState = commerceRuntime();
  let form: FormData;
  try {
    assertSameOriginMutation(request.headers, runtimeState.config.appOrigin);
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
      assertValidCsrf(
        form.get("csrfToken"),
        session,
        identityRuntime().config,
      );
    } catch {
      return new NextResponse("Request rejected", {
        headers: noStoreHeaders(),
        status: 403,
      });
    }
  }

  try {
    const anonymousToken = anonymousCartTokenFrom(request.cookies);
    const result = await addCartItem(runtimeState.database, {
      ...cartIdentity(session, anonymousToken),
      bookId: text(form.get("bookId")),
    });
    const returnTo = normalizeReturnTo(
      text(form.get("returnTo")),
      runtimeState.config.appOrigin,
      "/cart",
    );
    const target = new URL(returnTo, runtimeState.config.appOrigin);
    target.searchParams.set("added", "1");
    const response = NextResponse.redirect(target, {
      headers: noStoreHeaders(),
      status: 303,
    });
    if (!session && result.anonymousToken) {
      response.cookies.set(
        ANONYMOUS_CART_COOKIE_NAME,
        result.anonymousToken,
        anonymousCartCookieOptions(runtimeState.config.appOrigin),
      );
    } else if (session && anonymousToken) {
      response.cookies.set(ANONYMOUS_CART_COOKIE_NAME, "", {
        ...anonymousCartCookieOptions(runtimeState.config.appOrigin),
        expires: new Date(0),
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
