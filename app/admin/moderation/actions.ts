"use server";

import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { assertSameOriginMutation } from "../../../modules/identity/server/http";
import { currentSessionContext } from "../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { assertValidCsrf } from "../../../modules/identity/server/session";
import {
  MODERATION_DECISION_ACTIONS,
  isReasonCategoryCode,
  isRemovalGround,
  type ModerationDecisionAction,
} from "../../../modules/moderation/types";
import {
  approveModerationCase,
  doNotPublishReviewModerationCase,
  keepPublishedModerationCase,
  ModerationConflictError,
  ModerationInputError,
  rejectModerationCase,
  removePublishedBook,
} from "../../../modules/moderation/server/service";
import { publishingPrivateObjectStorage } from "../../../modules/publishing/storage/runtime";

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

function isModerationDecisionAction(value: string): value is ModerationDecisionAction {
  return (MODERATION_DECISION_ACTIONS as readonly string[]).includes(value);
}

function moderationUrl(
  formData: FormData,
  options: {
    readonly decision?: string;
    readonly error?: string;
    readonly keepCase?: boolean;
    readonly result?: string;
  },
): string {
  const query = new URLSearchParams();
  const filter = value(formData, "filter");
  if (filter && filter !== "all") query.set("type", filter);
  if (options.keepCase) {
    const caseId = value(formData, "caseId");
    if (caseId) query.set("case", caseId);
  }
  if (options.decision) query.set("decision", options.decision);
  if (options.error) query.set("error", options.error);
  if (options.result) query.set("result", options.result);
  const suffix = query.toString();
  return suffix ? `/admin/moderation?${suffix}` : "/admin/moderation";
}

async function managerMutationContext(formData: FormData) {
  const runtime = identityRuntime();
  try {
    assertSameOriginMutation(await headers(), runtime.config.appOrigin);
  } catch {
    redirect(moderationUrl(formData, { error: "request_rejected", keepCase: true }));
  }
  const context = await currentSessionContext();
  if (!context) redirect("/login?returnTo=%2Fadmin%2Fmoderation");
  if (!context.session.roles.includes("manager")) forbidden();
  try {
    assertValidCsrf(formData.get("csrfToken"), context, runtime.config);
  } catch {
    redirect(moderationUrl(formData, { error: "request_rejected", keepCase: true }));
  }
  return { context, runtime };
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

export async function decideModerationCaseAction(formData: FormData): Promise<void> {
  const { context, runtime } = await managerMutationContext(formData);
  const submittedDecision = value(formData, "decision");
  if (!isModerationDecisionAction(submittedDecision)) {
    redirect(
      moderationUrl(formData, {
        error: "invalid_decision",
        keepCase: true,
      }),
    );
  }
  const decision = submittedDecision;
  const base = {
    caseId: value(formData, "caseId"),
    expectedRevision: revision(formData),
    idempotencyKey: value(formData, "idempotencyKey"),
    managerUserId: context.session.userId,
  };
  let execute: () => Promise<void>;
  if (
    decision === "approve_publication" ||
    decision === "approve_update" ||
    decision === "publish_review"
  ) {
    execute = () => approveModerationCase(
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
      redirect(
        moderationUrl(formData, {
          decision,
          error: "reason_required",
          keepCase: true,
        }),
      );
    }
    execute = () => rejectModerationCase(runtime.database, {
      ...base,
      reasonCategoryCode,
    });
  } else {
    redirect(
      moderationUrl(formData, {
        error: "invalid_decision",
        keepCase: true,
      }),
    );
  }
  try {
    await execute();
  } catch (error) {
    redirect(
      moderationUrl(formData, {
        decision,
        error: errorCode(error),
        keepCase: true,
      }),
    );
  }
  redirect(moderationUrl(formData, { result: resultCode(decision) }));
}

export async function removePublicationAction(formData: FormData): Promise<void> {
  const { context, runtime } = await managerMutationContext(formData);
  const removalGround = value(formData, "removalGround");
  if (!isRemovalGround(removalGround)) {
    redirect(
      moderationUrl(formData, {
        decision: "remove_publication",
        error: "removal_ground_required",
        keepCase: true,
      }),
    );
  }
  if (value(formData, "confirmed") !== "true") {
    redirect(
      moderationUrl(formData, {
        decision: "remove_publication",
        error: "confirmation_required",
        keepCase: true,
      }),
    );
  }
  try {
    await removePublishedBook(runtime.database, {
      caseId: value(formData, "caseId"),
      confirmed: true,
      expectedRevision: revision(formData),
      idempotencyKey: value(formData, "idempotencyKey"),
      managerUserId: context.session.userId,
      removalGround,
    });
  } catch (error) {
    redirect(
      moderationUrl(formData, {
        decision: "remove_publication",
        error: errorCode(error),
        keepCase: true,
      }),
    );
  }
  redirect(moderationUrl(formData, { result: "publication_removed" }));
}
