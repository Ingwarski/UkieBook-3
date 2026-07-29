import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  LibraryConflictError,
  LibraryInputError,
  submitVerifiedBuyerReview,
} from "../../../modules/library/server";
import {
  assertSameOriginMutation,
  noStoreHeaders,
} from "../../../modules/identity/server/http";
import { currentSessionContext } from "../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { assertValidCsrf } from "../../../modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

function reviewTarget(origin: string, bookId: string, state: string): NextResponse {
  const target = new URL(`/books/${encodeURIComponent(bookId)}`, origin);
  target.searchParams.set("review", state);
  target.hash = "reviews";
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
  const bookId = text(form, "bookId");
  const session = await currentSessionContext();
  if (!session) {
    const login = new URL("/login", runtimeState.config.appOrigin);
    login.searchParams.set("returnTo", `/books/${encodeURIComponent(bookId)}#reviews`);
    return NextResponse.redirect(login, { headers: noStoreHeaders(), status: 303 });
  }
  try {
    assertValidCsrf(form.get("csrfToken"), session, runtimeState.config);
    await submitVerifiedBuyerReview(runtimeState.database, {
      bookId,
      buyerUserId: session.session.userId,
      idempotencyKey: text(form, "idempotencyKey"),
      rating: Number(text(form, "rating")),
      reviewText: text(form, "reviewText"),
    });
    return reviewTarget(runtimeState.config.appOrigin, bookId, "submitted");
  } catch (error) {
    const state = error instanceof LibraryInputError || error instanceof LibraryConflictError
      ? "rejected"
      : "error";
    return reviewTarget(runtimeState.config.appOrigin, bookId, state);
  }
}
