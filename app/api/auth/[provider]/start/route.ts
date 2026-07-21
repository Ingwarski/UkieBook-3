import { NextResponse } from "next/server";

import {
  normalizeAuthIntent,
  normalizeReturnTo,
} from "../../../../../modules/identity/return-to";
import { isOAuthProviderId } from "../../../../../modules/identity/types";
import {
  assertSameOriginMutation,
  flowCookieName,
  noStoreHeaders,
  secureCookie,
} from "../../../../../modules/identity/server/http";
import { identityRuntime } from "../../../../../modules/identity/server/runtime";
import { startOAuthFlow } from "../../../../../modules/identity/server/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerValue } = await context.params;
  if (!isOAuthProviderId(providerValue)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const runtime = identityRuntime();
  try {
    assertSameOriginMutation(request.headers, runtime.config.appOrigin);
  } catch {
    return new NextResponse("Forbidden", {
      headers: noStoreHeaders(),
      status: 403,
    });
  }
  let returnTo = "/";
  let intent: "default" | "author_onboarding" = "default";
  try {
    const form = await request.formData();
    const returnValue = form.get("returnTo");
    returnTo = normalizeReturnTo(
      typeof returnValue === "string" ? returnValue : undefined,
      runtime.config.appOrigin,
    );
    const intentValue = form.get("intent");
    intent = normalizeAuthIntent(
      typeof intentValue === "string" ? intentValue : undefined,
      returnTo,
    );
    const result = await startOAuthFlow({
      config: runtime.config,
      database: runtime.database,
      intent,
      provider: runtime.provider(providerValue),
      returnTo,
    });
    const response = NextResponse.redirect(result.authorizationUrl, {
      headers: noStoreHeaders(),
      status: 303,
    });
    response.cookies.set(flowCookieName(runtime.config), result.browserBinding, {
      expires: result.expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: secureCookie(runtime.config),
    });
    return response;
  } catch {
    const login = new URL("/login", runtime.config.appOrigin);
    login.searchParams.set("error", "provider_unavailable");
    login.searchParams.set("returnTo", returnTo);
    if (intent === "author_onboarding") {
      login.searchParams.set("intent", "author");
    }
    return NextResponse.redirect(login, {
      headers: noStoreHeaders(),
      status: 303,
    });
  }
}
