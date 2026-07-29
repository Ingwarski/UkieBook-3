import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { decideRefund, LibraryConflictError, LibraryInputError, LibraryNotFoundError } from "../../../../modules/library/server";
import {
  assertSameOriginMutation,
  noStoreHeaders,
  sessionCookieName,
} from "../../../../modules/identity/server/http";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { assertValidCsrf, sessionContextFromToken } from "../../../../modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function value(formData: FormData, field: string): string {
  const candidate = formData.get(field);
  return typeof candidate === "string" ? candidate : "";
}

function redirect(origin: string, result: string): NextResponse {
  const target = new URL("/admin/refunds", origin);
  target.searchParams.set("result", result);
  return NextResponse.redirect(target, { headers: noStoreHeaders(), status: 303 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runtimeState = identityRuntime();
  try {
    assertSameOriginMutation(request.headers, runtimeState.config.appOrigin);
  } catch {
    return redirect(runtimeState.config.appOrigin, "error");
  }
  const context = await sessionContextFromToken({
    config: runtimeState.config,
    database: runtimeState.database,
    token: request.cookies.get(sessionCookieName(runtimeState.config))?.value,
  });
  if (!context) {
    return NextResponse.redirect(new URL("/login?returnTo=%2Fadmin%2Frefunds", runtimeState.config.appOrigin), {
      headers: noStoreHeaders(),
      status: 303,
    });
  }
  if (!context.session.roles.includes("manager")) {
    return new NextResponse("Forbidden", { headers: noStoreHeaders(), status: 403 });
  }
  const formData = await request.formData();
  try {
    assertValidCsrf(formData.get("csrfToken"), context, runtimeState.config);
    const decision = value(formData, "decision");
    if (decision !== "approved" && decision !== "declined") return redirect(runtimeState.config.appOrigin, "error");
    await decideRefund(runtimeState.database, {
      decision,
      decisionNote: value(formData, "decisionNote"),
      idempotencyKey: value(formData, "idempotencyKey"),
      managerUserId: context.session.userId,
      refundRequestId: value(formData, "refundRequestId"),
    });
    revalidatePath("/admin/refunds");
    revalidatePath("/library");
    return redirect(runtimeState.config.appOrigin, decision);
  } catch (error) {
    if (error instanceof LibraryInputError || error instanceof LibraryConflictError || error instanceof LibraryNotFoundError) {
      return redirect(runtimeState.config.appOrigin, "error");
    }
    return redirect(runtimeState.config.appOrigin, "error");
  }
}
