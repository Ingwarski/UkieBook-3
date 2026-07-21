"use server";

import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { validatePublicName } from "../../../modules/author-profile/types";
import { persistAuthorProfile } from "../../../modules/author-profile/server/service";
import { canCompleteAuthorOnboarding } from "../../../modules/identity/route-policy";
import {
  assertSameOriginMutation,
  secureCookie,
  sessionCookieName,
} from "../../../modules/identity/server/http";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { assertValidCsrf, sessionContextFromToken } from "../../../modules/identity/server/session";

function rejectProfileMutation(): never {
  redirect("/author/profile?error=request_rejected");
}

export async function saveAuthorProfileAction(formData: FormData): Promise<void> {
  const runtime = identityRuntime();
  const requestHeaders = await headers();
  try {
    assertSameOriginMutation(requestHeaders, runtime.config.appOrigin);
  } catch {
    rejectProfileMutation();
  }
  const cookieStore = await cookies();
  const cookieName = sessionCookieName(runtime.config);
  const context = await sessionContextFromToken({
    config: runtime.config,
    database: runtime.database,
    token: cookieStore.get(cookieName)?.value,
  });
  if (!context) {
    redirect("/login?returnTo=%2Fauthor%2Fprofile&intent=author");
  }
  if (!canCompleteAuthorOnboarding(context.session)) {
    forbidden();
  }
  try {
    assertValidCsrf(formData.get("csrfToken"), context, runtime.config);
  } catch {
    rejectProfileMutation();
  }
  const candidate = formData.get("publicName");
  const validation = validatePublicName(candidate);
  if (!validation.value) {
    const error = validation.error?.includes("120")
      ? "too_long"
      : validation.error?.includes("службові")
        ? "unsafe"
        : validation.error?.includes("2 символи")
          ? "too_short"
          : "required";
    const query = new URLSearchParams({ error });
    if (typeof candidate === "string" && candidate.length <= 256) {
      query.set("value", candidate);
    }
    redirect(`/author/profile?${query.toString()}`);
  }
  const result = await persistAuthorProfile({
    config: runtime.config,
    database: runtime.database,
    publicName: validation.value,
    sessionContext: context,
  });
  if (result.replacementSession) {
    cookieStore.set(cookieName, result.replacementSession.token, {
      expires: result.replacementSession.expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: secureCookie(runtime.config),
    });
  }
  redirect(result.redirectTo ?? "/author/profile?saved=1");
}
