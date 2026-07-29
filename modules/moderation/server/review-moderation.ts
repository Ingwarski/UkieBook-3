import "server-only";

import { randomUUID } from "node:crypto";

import type { SqlDatabase, SqlExecutor } from "../../platform/sql-port";
import { withDomainTransaction } from "../../platform/transaction";
import type {
  ManagerModerationCaseDetail,
  ManagerModerationQueueItem,
  ModerationDecisionAction,
} from "../types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

export interface StoredModerationReviewCase {
  readonly id: string;
  readonly revision: number;
  readonly status: "manual_review_pending" | "approved" | "rejected";
  readonly subjectId: string;
  readonly subjectVersionId: string;
  readonly sourceEventId: string | null;
  readonly reviewId: string;
  readonly bookId: string;
  readonly title: string;
  readonly buyerDisplayName: string;
  readonly reviewText: string;
  readonly submittedAt: string;
}

interface ReviewCaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly revision: number;
  readonly status: "manual_review_pending" | "approved" | "rejected";
  readonly subject_id: string;
  readonly subject_version_id: string;
  readonly source_event_id: string | null;
  readonly review_id: string;
  readonly book_id: string;
  readonly title_snapshot: string;
  readonly buyer_display_name: string;
  readonly review_text: string;
  readonly submitted_at: Date | string;
}

function mapReviewCase(row: ReviewCaseRow): StoredModerationReviewCase {
  return {
    bookId: row.book_id,
    buyerDisplayName: row.buyer_display_name,
    id: row.id,
    reviewId: row.review_id,
    reviewText: row.review_text,
    revision: row.revision,
    sourceEventId: row.source_event_id,
    status: row.status,
    subjectId: row.subject_id,
    subjectVersionId: row.subject_version_id,
    submittedAt: new Date(row.submitted_at).toISOString(),
    title: row.title_snapshot,
  };
}

const reviewCaseQuery = `
  SELECT
    moderation_case.id, moderation_case.revision, moderation_case.status,
    moderation_case.subject_id, moderation_case.subject_version_id,
    moderation_case.source_event_id,
    review.id AS review_id, review.book_id, item.title_snapshot,
    COALESCE(users.private_display_name, 'Підтверджений читач') AS buyer_display_name,
    review.review_text, review.submitted_at
  FROM moderation_cases moderation_case
  JOIN moderation_review_subjects subject ON subject.case_id = moderation_case.id
  JOIN library_reviews review ON review.id = subject.review_id
  JOIN library_entitlements entitlement ON entitlement.id = review.entitlement_id
  JOIN commerce_order_items item ON item.id = entitlement.source_order_item_id
  JOIN users ON users.id = review.buyer_user_id
`;

export async function findModerationReviewCase(
  executor: SqlExecutor,
  caseId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<StoredModerationReviewCase | null> {
  const result = await executor.query<ReviewCaseRow>(
    `
      ${reviewCaseQuery}
      WHERE moderation_case.id = $1
      ${options.forUpdate ? "FOR UPDATE OF moderation_case" : ""}
    `,
    [requireUuid(caseId, "caseId")],
  );
  return result.rows[0] ? mapReviewCase(result.rows[0]) : null;
}

export async function listPendingModerationReviewCases(
  executor: SqlExecutor,
): Promise<StoredModerationReviewCase[]> {
  const result = await executor.query<ReviewCaseRow>(`
    ${reviewCaseQuery}
    WHERE moderation_case.status = 'manual_review_pending'
    ORDER BY moderation_case.created_at ASC, moderation_case.id ASC
  `);
  return result.rows.map(mapReviewCase);
}

export function managerReviewQueueItem(
  reviewCase: StoredModerationReviewCase,
): ManagerModerationQueueItem {
  return {
    aiSignal: "Відгук очікує ручної перевірки.",
    authorPublicName: reviewCase.buyerDisplayName,
    coverUrl: null,
    id: reviewCase.id,
    isPublished: false,
    revision: reviewCase.revision,
    safeFail: false,
    status: "manual_review_pending",
    subjectType: "review",
    submittedAt: reviewCase.submittedAt,
    title: reviewCase.title,
  };
}

export function managerReviewCaseDetail(
  reviewCase: StoredModerationReviewCase,
): ManagerModerationCaseDetail {
  return {
    ...managerReviewQueueItem(reviewCase),
    fragment: reviewCase.reviewText,
    internalSignals: [],
  };
}

interface ReviewSubmittedPayload {
  readonly buyerUserId: string;
  readonly bookId: string;
  readonly entitlementId: string;
  readonly reviewId: string;
}

function parseReviewSubmittedPayload(value: unknown): ReviewSubmittedPayload {
  const raw = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("buyerUserId" in raw) ||
    !("bookId" in raw) ||
    !("entitlementId" in raw) ||
    !("reviewId" in raw) ||
    !("schemaVersion" in raw) ||
    raw.schemaVersion !== 1 ||
    typeof raw.buyerUserId !== "string" ||
    typeof raw.bookId !== "string" ||
    typeof raw.entitlementId !== "string" ||
    typeof raw.reviewId !== "string"
  ) {
    throw new Error("ReviewSubmitted payload is invalid");
  }
  requireUuid(raw.buyerUserId, "buyerUserId");
  requireUuid(raw.bookId, "bookId");
  requireUuid(raw.entitlementId, "entitlementId");
  requireUuid(raw.reviewId, "reviewId");
  return {
    bookId: raw.bookId,
    buyerUserId: raw.buyerUserId,
    entitlementId: raw.entitlementId,
    reviewId: raw.reviewId,
  };
}

export async function relayReviewSubmittedEvents(
  database: SqlDatabase,
  options: { readonly limit?: number } = {},
): Promise<readonly string[]> {
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Review relay limit is invalid");
  }
  const caseIds: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const caseId = await withDomainTransaction(database, async (transaction) => {
      const eventResult = await transaction.connection.query<{
        readonly correlation_id: string;
        readonly id: string;
        readonly payload: unknown;
      }>(`
        SELECT id, correlation_id, payload
        FROM outbox_events
        WHERE event_type = 'ReviewSubmitted'
          AND event_version = 1
          AND published_at IS NULL
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const event = eventResult.rows[0];
      if (!event) return null;
      const payload = parseReviewSubmittedPayload(event.payload);
      const review = await transaction.connection.query<{
        readonly id: string;
      }>(
        `
          SELECT review.id
          FROM library_reviews review
          JOIN library_entitlements entitlement ON entitlement.id = review.entitlement_id
          WHERE review.id = $1
            AND review.buyer_user_id = $2
            AND review.book_id = $3
            AND review.entitlement_id = $4
            AND review.status = 'pending_moderation'
        `,
        [payload.reviewId, payload.buyerUserId, payload.bookId, payload.entitlementId],
      );
      if (!review.rows[0]) throw new Error("ReviewSubmitted does not match a pending review");
      const idempotencyKey = `moderation.review-submitted:${event.id}`;
      const inserted = await transaction.connection.query<{ readonly id: string }>(
        `
          INSERT INTO moderation_cases (
            id, subject_type, subject_id, subject_version_id, trigger_type,
            source_event_id, idempotency_key, status
          ) VALUES ($1, 'review', $2, $3, 'submission', $4, $5, 'manual_review_pending')
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
        [randomUUID(), payload.reviewId, payload.reviewId, event.id, idempotencyKey],
      );
      let resolvedCaseId = inserted.rows[0]?.id;
      if (!resolvedCaseId) {
        const existing = await transaction.connection.query<{ readonly id: string }>(
          "SELECT id FROM moderation_cases WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        resolvedCaseId = existing.rows[0]?.id;
      }
      if (!resolvedCaseId) throw new Error("Unable to recover review moderation case");
      await transaction.connection.query(
        `
          INSERT INTO moderation_review_subjects (case_id, review_id)
          VALUES ($1, $2)
          ON CONFLICT (case_id) DO NOTHING
        `,
        [resolvedCaseId, payload.reviewId],
      );
      await transaction.emit({
        aggregateId: resolvedCaseId,
        aggregateType: "ModerationCase",
        correlationId: event.correlation_id,
        eventType: "ModerationManualReviewRequested",
        eventVersion: 1,
        idempotencyKey: `moderation.manual-review:${resolvedCaseId}`,
        payload: {
          caseId: resolvedCaseId,
          subjectId: payload.reviewId,
          subjectType: "review",
          subjectVersionId: payload.reviewId,
        },
        topic: "moderation.manual-review-requested.v1",
      });
      await transaction.connection.query(
        `
          UPDATE outbox_events
          SET published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
              publish_attempts = publish_attempts + 1,
              last_error = NULL
          WHERE id = $1
        `,
        [event.id],
      );
      return resolvedCaseId;
    });
    if (!caseId) break;
    caseIds.push(caseId);
  }
  return caseIds;
}

async function requireManager(executor: SqlExecutor, managerUserId: string): Promise<void> {
  const result = await executor.query<{ readonly allowed: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'manager'
      ) AS allowed
    `,
    [requireUuid(managerUserId, "managerUserId")],
  );
  if (!result.rows[0]?.allowed) throw new Error("Manager role is required");
}

export async function decideReviewModerationCase(
  database: SqlDatabase,
  input: {
    readonly caseId: string;
    readonly managerUserId: string;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly action: "publish_review" | "do_not_publish_review";
  },
): Promise<void> {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 240
  ) {
    throw new Error("Review decision input is invalid");
  }
  await withDomainTransaction(database, async (transaction) => {
    await requireManager(transaction.connection, input.managerUserId);
    const current = await findModerationReviewCase(transaction.connection, input.caseId, {
      forUpdate: true,
    });
    if (!current) throw new Error("Review moderation case was not found");
    const existing = await transaction.connection.query<{
      readonly action: ModerationDecisionAction;
      readonly id: string;
      readonly idempotency_key: string;
      readonly manager_user_id: string;
    }>(
      `
        SELECT id, action, idempotency_key, manager_user_id
        FROM moderation_decisions
        WHERE case_id = $1
      `,
      [current.id],
    );
    const present = existing.rows[0];
    if (present) {
      if (
        present.action === input.action &&
        present.idempotency_key === input.idempotencyKey &&
        present.manager_user_id === input.managerUserId
      ) {
        return;
      }
      throw new Error("Review moderation case is already decided");
    }
    if (current.status !== "manual_review_pending" || current.revision !== input.expectedRevision) {
      throw new Error("Review moderation case changed");
    }
    const decisionId = randomUUID();
    await transaction.connection.query(
      `
        INSERT INTO moderation_decisions (
          id, case_id, manager_user_id, action, case_revision, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        decisionId,
        current.id,
        input.managerUserId,
        input.action,
        current.revision,
        input.idempotencyKey,
      ],
    );
    await transaction.connection.query(
      `
        UPDATE moderation_cases
        SET status = $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [current.id, input.action === "publish_review" ? "approved" : "rejected"],
    );
    await transaction.emit({
      aggregateId: current.id,
      aggregateType: "ModerationCase",
      correlationId: current.id,
      eventType: "ModerationDecisionRecorded",
      eventVersion: 1,
      idempotencyKey: `moderation.decision:${decisionId}`,
      payload: {
        action: input.action,
        caseId: current.id,
        decisionId,
        managerUserId: input.managerUserId,
        reasonCategoryCode: null,
        subjectId: current.subjectId,
        subjectType: "review",
        subjectVersionId: current.subjectVersionId,
      },
      topic: "moderation.decision-recorded.v1",
    });
  });
}
