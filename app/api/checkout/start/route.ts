import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  anonymousCartCookieOptions,
  commerceRuntime,
  CommerceConflictError,
  CommerceInputError,
  startCheckout,
} from "../../../../modules/commerce/server";
import {
  PaymentProviderConfigurationError,
  PaymentProviderProtocolError,
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
} from "../../../../modules/commerce";
import {
  assertSameOriginMutation,
  noStoreHeaders,
} from "../../../../modules/identity/server/http";
import { currentSessionContext } from "../../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { assertValidCsrf } from "../../../../modules/identity/server/session";
import { anonymousCartTokenFrom } from "../../../commerce-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clearAnonymousCartCookie(
  response: NextResponse,
  appOrigin: string,
): void {
  response.cookies.set(ANONYMOUS_CART_COOKIE_NAME, "", {
    ...anonymousCartCookieOptions(appOrigin),
    expires: new Date(0),
    maxAge: 0,
  });
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
  if (!session) {
    const login = new URL("/login", commerce.config.appOrigin);
    login.searchParams.set("returnTo", "/cart?step=checkout");
    return NextResponse.redirect(login, {
      headers: noStoreHeaders(),
      status: 303,
    });
  }
  try {
    assertValidCsrf(form.get("csrfToken"), session, identityRuntime().config);
  } catch {
    return new NextResponse("Request rejected", {
      headers: noStoreHeaders(),
      status: 403,
    });
  }

  const anonymousToken = anonymousCartTokenFrom(request.cookies);
  try {
    const checkout = await startCheckout({
      anonymousToken,
      appOrigin: commerce.config.appOrigin,
      buyerUserId: session.session.userId,
      database: commerce.database,
      provider: commerce.provider,
      reconciliationIntervalMs: commerce.config.reconciliationIntervalMs,
      validitySeconds: commerce.config.validitySeconds,
    });
    const transition = new URL("/checkout/redirect", commerce.config.appOrigin);
    transition.searchParams.set(
      "paymentSession",
      checkout.paymentSession.id,
    );
    const response = NextResponse.redirect(transition, {
      headers: noStoreHeaders(),
      status: 303,
    });
    if (anonymousToken) {
      clearAnonymousCartCookie(response, commerce.config.appOrigin);
    }
    return response;
  } catch (error) {
    const target = new URL("/cart", commerce.config.appOrigin);
    target.searchParams.set(
      "error",
      error instanceof PaymentProviderConfigurationError ||
      error instanceof PaymentProviderRejectedError
        ? "payment_start_failed"
        : error instanceof PaymentProviderProtocolError ||
            error instanceof PaymentProviderUnavailableError
          ? "payment_start_pending"
          : error instanceof CommerceConflictError
        ? error.code === "CART_CHECKOUT_PENDING" ||
          error.code === "PAYMENT_START_IN_PROGRESS"
          ? "cart_checkout_pending"
          : "payment_start_failed"
        : error instanceof CommerceInputError
          ? "request_rejected"
          : "payment_start_failed",
    );
    return NextResponse.redirect(target, {
      headers: noStoreHeaders(),
      status: 303,
    });
  }
}
