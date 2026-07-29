import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  assertSameOriginMutation,
  noStoreHeaders,
  sessionCookieName,
} from "../../../../modules/identity/server/http";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import {
  assertValidCsrf,
  sessionContextFromToken,
} from "../../../../modules/identity/server/session";
import { relayReviewModerationDecisions } from "../../../../modules/library/server";
import { decideReviewModerationCase } from "../../../../modules/moderation/server/review-moderation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function value(formData: FormData, name: string): string {
  const candidate = formData.get(name);
  return typeof candidate === "string" ? candidate : "";
}

function expectedRevision(formData: FormData): number {
  const candidate = value(formData, "expectedRevision");
  return /^\d+$/u.test(candidate) ? Number(candidate) : -1;
}

function target(origin: string, formData: FormData | null, options: {
  readonly error?: string;
  readonly result?: string;
}): NextResponse {
  const query = new URLSearchParams();
  const filter = formData ? value(formData, "filter") : "";
  const caseId = formData ? value(formData, "caseId") : "";
  if (filter && filter !== "all") query.set("type", filter);
  if (caseId) query.set("case", caseId);
  if (options.error) query.set("error", options.error);
  if (options.result) query.set("result", options.result);
  const suffix = query.toString();
  return NextResponse.redirect(new URL(suffix ? `/admin/moderation?${suffix}` : "/admin/moderation", origin), {
    headers: noStoreHeaders(),
    status: 303,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runtimeState = identityRuntime();
  try {
    assertSameOriginMutation(request.headers, runtimeState.config.appOrigin);
  } catch {
    return target(runtimeState.config.appOrigin, null, { error: "request_rejected" });
  }
  const context = await sessionContextFromToken({
    config: runtimeState.config,
    database: runtimeState.database,
    token: request.cookies.get(sessionCookieName(runtimeState.config))?.value,
  });
  if (!context) {
    return NextResponse.redirect(new URL("/login?returnTo=%2Fadmin%2Fmoderation", runtimeState.config.appOrigin), {
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
  } catch {
    return target(runtimeState.config.appOrigin, formData, { error: "request_rejected" });
  }
  const action = value(formData, "decision");
  if (action !== "publish_review" && action !== "do_not_publish_review") {
    return target(runtimeState.config.appOrigin, formData, { error: "invalid_decision" });
  }
  try {
    await decideReviewModerationCase(runtimeState.database, {
      action,
      caseId: value(formData, "caseId"),
      expectedRevision: expectedRevision(formData),
      idempotencyKey: value(formData, "idempotencyKey"),
      managerUserId: context.session.userId,
    });
    await relayReviewModerationDecisions(runtimeState.database, { limit: 1 });
  } catch {
    return target(runtimeState.config.appOrigin, formData, { error: "decision_failed" });
  }
  revalidatePath("/admin/moderation");
  revalidatePath("/");
  return target(runtimeState.config.appOrigin, formData, {
    result: action === "publish_review" ? "review_published" : "review_rejected",
  });
}
