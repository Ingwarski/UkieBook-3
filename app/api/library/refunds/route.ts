import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  LibraryConflictError,
  LibraryInputError,
  LibraryNotFoundError,
  requestRefund,
} from "../../../../modules/library/server";
import {
  assertSameOriginMutation,
  noStoreHeaders,
} from "../../../../modules/identity/server/http";
import { currentSessionContext } from "../../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { assertValidCsrf } from "../../../../modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

function libraryTarget(origin: string, state: string): NextResponse {
  const target = new URL("/library", origin);
  target.searchParams.set("refund", state);
  return NextResponse.redirect(target, { headers: noStoreHeaders(), status: 303 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runtimeState = identityRuntime();
  let form: FormData;
  try {
    assertSameOriginMutation(request.headers, runtimeState.config.appOrigin);
    form = await request.formData();
  } catch {
    return new NextResponse("Request rejected", { headers: noStoreHeaders(), status: 403 });
  }
  const session = await currentSessionContext();
  if (!session) {
    const login = new URL("/login", runtimeState.config.appOrigin);
    login.searchParams.set("returnTo", "/library");
    return NextResponse.redirect(login, { headers: noStoreHeaders(), status: 303 });
  }
  try {
    assertValidCsrf(form.get("csrfToken"), session, runtimeState.config);
    await requestRefund(runtimeState.database, {
      buyerUserId: session.session.userId,
      entitlementId: text(form, "entitlementId"),
      idempotencyKey: text(form, "idempotencyKey"),
      reason: text(form, "reason"),
    });
    return libraryTarget(runtimeState.config.appOrigin, "submitted");
  } catch (error) {
    const state = error instanceof LibraryInputError ||
      error instanceof LibraryConflictError ||
      error instanceof LibraryNotFoundError
      ? "rejected"
      : "error";
    return libraryTarget(runtimeState.config.appOrigin, state);
  }
}
