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
import {
  MODERATION_DECISION_ACTIONS,
  isReasonCategoryCode,
  isRemovalGround,
  type ModerationDecisionAction,
} from "../../../../modules/moderation/types";
import {
  approveModerationCase,
  doNotPublishReviewModerationCase,
  keepPublishedModerationCase,
  ModerationConflictError,
  ModerationInputError,
  rejectModerationCase,
  removePublishedBook,
} from "../../../../modules/moderation/server/service";
import { publishingPrivateObjectStorage } from "../../../../modules/publishing/storage/runtime";

export const dynamic = "force-dynamic";

function value(formData: FormData, name: string): string {
  const candidate = formData.get(name);
  return typeof candidate === "string" ? candidate : "";
}

function revision(formData: FormData): number {
  const candidate = value(formData, "expectedRevision");
  if (!/^\d+$/u.test(candidate)) return -1;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) ? parsed : -1;
}

function isModerationDecisionAction(
  candidate: string,
): candidate is ModerationDecisionAction {
  return (MODERATION_DECISION_ACTIONS as readonly string[]).includes(candidate);
}

function moderationUrl(
  formData: FormData | null,
  options: {
    readonly decision?: string;
    readonly error?: string;
    readonly keepCase?: boolean;
    readonly result?: string;
  },
): string {
  const query = new URLSearchParams();
  const filter = formData ? value(formData, "filter") : "";
  if (filter && filter !== "all") query.set("type", filter);
  if (formData && options.keepCase) {
    const caseId = value(formData, "caseId");
    if (caseId) query.set("case", caseId);
  }
  if (options.decision) query.set("decision", options.decision);
  if (options.error) query.set("error", options.error);
  if (options.result) query.set("result", options.result);
  const suffix = query.toString();
  return suffix ? `/admin/moderation?${suffix}` : "/admin/moderation";
}

function redirectResponse(origin: string, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, origin), {
    headers: noStoreHeaders(),
    status: 303,
  });
}

function errorCode(error: unknown): string {
  if (error instanceof ModerationInputError) return error.code;
  if (error instanceof ModerationConflictError) return "conflict";
  return "decision_failed";
}

function resultCode(action: ModerationDecisionAction): string {
  if (action === "approve_publication") return "publication_approved";
  if (action === "approve_update") return "update_approved";
  if (action === "publish_review") return "review_published";
  if (action === "keep_published") return "kept_published";
  if (action === "reject_publication") return "publication_rejected";
  if (action === "reject_update") return "update_rejected";
  return "review_rejected";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runtime = identityRuntime();
  try {
    assertSameOriginMutation(request.headers, runtime.config.appOrigin);
  } catch {
    return redirectResponse(
      runtime.config.appOrigin,
      moderationUrl(null, { error: "request_rejected" }),
    );
  }

  const context = await sessionContextFromToken({
    config: runtime.config,
    database: runtime.database,
    token: request.cookies.get(sessionCookieName(runtime.config))?.value,
  });
  if (!context) {
    return redirectResponse(
      runtime.config.appOrigin,
      "/login?returnTo=%2Fadmin%2Fmoderation",
    );
  }
  if (!context.session.roles.includes("manager")) {
    return new NextResponse("Forbidden", {
      headers: noStoreHeaders(),
      status: 403,
    });
  }

  const formData = await request.formData();
  try {
    assertValidCsrf(formData.get("csrfToken"), context, runtime.config);
  } catch {
    return redirectResponse(
      runtime.config.appOrigin,
      moderationUrl(formData, { error: "request_rejected", keepCase: true }),
    );
  }

  const submittedDecision = value(formData, "decision");
  if (!isModerationDecisionAction(submittedDecision)) {
    return redirectResponse(
      runtime.config.appOrigin,
      moderationUrl(formData, { error: "invalid_decision", keepCase: true }),
    );
  }
  const decision = submittedDecision;
  const base = {
    caseId: value(formData, "caseId"),
    expectedRevision: revision(formData),
    idempotencyKey: value(formData, "idempotencyKey"),
    managerUserId: context.session.userId,
  };

  if (decision === "remove_publication") {
    const removalGround = value(formData, "removalGround");
    if (!isRemovalGround(removalGround)) {
      return redirectResponse(
        runtime.config.appOrigin,
        moderationUrl(formData, {
          decision,
          error: "removal_ground_required",
          keepCase: true,
        }),
      );
    }
    if (value(formData, "confirmed") !== "true") {
      return redirectResponse(
        runtime.config.appOrigin,
        moderationUrl(formData, {
          decision,
          error: "confirmation_required",
          keepCase: true,
        }),
      );
    }
    try {
      await removePublishedBook(runtime.database, {
        ...base,
        confirmed: true,
        removalGround,
      });
    } catch (error) {
      return redirectResponse(
        runtime.config.appOrigin,
        moderationUrl(formData, {
          decision,
          error: errorCode(error),
          keepCase: true,
        }),
      );
    }
    revalidatePath("/admin/moderation");
    return redirectResponse(
      runtime.config.appOrigin,
      moderationUrl(formData, { result: "publication_removed" }),
    );
  }

  let execute: () => Promise<void>;
  if (
    decision === "approve_publication" ||
    decision === "approve_update" ||
    decision === "publish_review"
  ) {
    execute = () =>
      approveModerationCase(
        runtime.database,
        publishingPrivateObjectStorage(),
        base,
      );
  } else if (decision === "keep_published") {
    execute = () => keepPublishedModerationCase(runtime.database, base);
  } else if (decision === "do_not_publish_review") {
    execute = () => doNotPublishReviewModerationCase(runtime.database, base);
  } else if (decision === "reject_publication" || decision === "reject_update") {
    const reasonCategoryCode = value(formData, "reasonCategoryCode");
    if (!isReasonCategoryCode(reasonCategoryCode)) {
      return redirectResponse(
        runtime.config.appOrigin,
        moderationUrl(formData, {
          decision,
          error: "reason_required",
          keepCase: true,
        }),
      );
    }
    execute = () =>
      rejectModerationCase(runtime.database, {
        ...base,
        reasonCategoryCode,
      });
  } else {
    return redirectResponse(
      runtime.config.appOrigin,
      moderationUrl(formData, { error: "invalid_decision", keepCase: true }),
    );
  }

  try {
    await execute();
  } catch (error) {
    return redirectResponse(
      runtime.config.appOrigin,
      moderationUrl(formData, {
        decision,
        error: errorCode(error),
        keepCase: true,
      }),
    );
  }
  revalidatePath("/admin/moderation");
  return redirectResponse(
    runtime.config.appOrigin,
    moderationUrl(formData, { result: resultCode(decision) }),
  );
}
