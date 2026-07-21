import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isOAuthProviderId } from "../../../../../modules/identity/types";
import {
  flowCookieName,
  noStoreHeaders,
  secureCookie,
  sessionCookieName,
} from "../../../../../modules/identity/server/http";
import { identityRuntime } from "../../../../../modules/identity/server/runtime";
import {
  finishOAuthFlow,
  OAuthCallbackFailure,
} from "../../../../../modules/identity/server/service";

export const dynamic = "force-dynamic";

function clearFlowCookie(
  response: NextResponse,
  cookieName: string,
  secure: boolean,
): void {
  response.cookies.set(cookieName, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerValue } = await context.params;
  if (!isOAuthProviderId(providerValue)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const runtime = identityRuntime();
  const cookieName = flowCookieName(runtime.config);
  try {
    const result = await finishOAuthFlow({
      browserBinding: request.cookies.get(cookieName)?.value,
      callbackUrl: request.nextUrl,
      config: runtime.config,
      database: runtime.database,
      provider: runtime.provider(providerValue),
    });
    const target = new URL(result.redirectTo, runtime.config.appOrigin);
    const response = NextResponse.redirect(target, {
      headers: noStoreHeaders(),
      status: 303,
    });
    response.cookies.set(sessionCookieName(runtime.config), result.sessionToken, {
      expires: result.idleExpiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: secureCookie(runtime.config),
    });
    clearFlowCookie(response, cookieName, secureCookie(runtime.config));
    return response;
  } catch (error) {
    const failure =
      error instanceof OAuthCallbackFailure
        ? error
        : new OAuthCallbackFailure("provider_failed");
    const login = new URL("/login", runtime.config.appOrigin);
    login.searchParams.set("error", failure.code);
    login.searchParams.set("returnTo", failure.returnTo);
    if (failure.intent === "author_onboarding") {
      login.searchParams.set("intent", "author");
    }
    const response = NextResponse.redirect(login, {
      headers: noStoreHeaders(),
      status: 303,
    });
    clearFlowCookie(response, cookieName, secureCookie(runtime.config));
    return response;
  }
}
