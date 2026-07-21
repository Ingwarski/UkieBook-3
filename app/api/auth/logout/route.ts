import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withSqlTransaction } from "../../../../modules/platform/sql-port";
import {
  assertSameOriginMutation,
  noStoreHeaders,
  secureCookie,
  sessionCookieName,
} from "../../../../modules/identity/server/http";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { revokeSession } from "../../../../modules/identity/server/repository";
import {
  assertValidCsrf,
  sessionContextFromToken,
} from "../../../../modules/identity/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const runtime = identityRuntime();
  try {
    assertSameOriginMutation(request.headers, runtime.config.appOrigin);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const cookieName = sessionCookieName(runtime.config);
  const context = await sessionContextFromToken({
    config: runtime.config,
    database: runtime.database,
    token: request.cookies.get(cookieName)?.value,
  });
  if (!context) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const form = await request.formData();
  try {
    assertValidCsrf(form.get("csrfToken"), context, runtime.config);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  await withSqlTransaction(runtime.database, (transaction) =>
    revokeSession(
      transaction,
      context.session.sessionId,
      context.session.userId,
      "user_logout",
    ),
  );
  const response = NextResponse.redirect(new URL("/", runtime.config.appOrigin), {
    headers: noStoreHeaders(),
    status: 303,
  });
  response.cookies.set(cookieName, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: secureCookie(runtime.config),
  });
  return response;
}
