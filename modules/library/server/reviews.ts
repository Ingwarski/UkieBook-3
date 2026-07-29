import "server-only";

import { randomUUID } from "node:crypto";

import type { SqlDatabase } from "../../platform/sql-port";
import { withDomainTransaction } from "../../platform/transaction";
import { LIBRARY_SCHEMA_VERSION, type LibraryReviewStatus } from "../types";
import {
  LibraryConflictError,
  LibraryInputError,
  parsePayload,
  requireIdempotencyKey,
  requireUuid,
} from "./common";

function requireRating(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5) {
    throw new LibraryInputError("REVIEW_RATING", "Оцінка має бути від 1 до 5.");
  }
  return value;
}

function requireReviewText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length < 2 || normalized.length > 3000) {
    throw new LibraryInputError("REVIEW_TEXT", "Відгук має містити від 2 до 3000 символів.");
  }
  return normalized;
}

export async function submitVerifiedBuyerReview(
  database: SqlDatabase,
  input: {
    readonly buyerUserId: string;
    readonly bookId: string;
    readonly rating: number;
    readonly reviewText: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly reviewId: string; readonly status: LibraryReviewStatus }> {
  const buyerUserId = requireUuid(input.buyerUserId, "buyerUserId");
  const bookId = requireUuid(input.bookId, "bookId");
  const rating = requireRating(input.rating);
  const reviewText = requireReviewText(input.reviewText);
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  return withDomainTransaction(database, async (transaction) => {
    const entitlement = await transaction.connection.query<{
      id: string;
      status: "active" | "refunded";
    }>(
      `
        SELECT id, status
        FROM library_entitlements
        WHERE buyer_user_id = $1 AND book_id = $2
        FOR UPDATE
      `,
      [buyerUserId, bookId],
    );
    const owned = entitlement.rows[0];
    if (!owned || owned.status !== "active") {
      throw new LibraryConflictError(
        "VERIFIED_BUYER_REQUIRED",
        "Відгук доступний лише після підтвердженої покупки.",
      );
    }
    const existing = await transaction.connection.query<{
      id: string;
      status: LibraryReviewStatus;
    }>(
      "SELECT id, status FROM library_reviews WHERE entitlement_id = $1",
      [owned.id],
    );
    if (existing.rows[0]) {
      return { reviewId: existing.rows[0].id, status: existing.rows[0].status };
    }
    const reviewId = randomUUID();
    await transaction.connection.query(
      `
        INSERT INTO library_reviews (
          id, entitlement_id, buyer_user_id, book_id, rating, review_text
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [reviewId, owned.id, buyerUserId, bookId, rating, reviewText],
    );
    await transaction.emit({
      aggregateId: reviewId,
      aggregateType: "Review",
      correlationId: owned.id,
      eventType: "ReviewSubmitted",
      eventVersion: 1,
      idempotencyKey: `library.review-submitted:${idempotencyKey}`,
      payload: {
        bookId,
        buyerUserId,
        entitlementId: owned.id,
        rating,
        reviewId,
        schemaVersion: LIBRARY_SCHEMA_VERSION,
      },
      topic: "library.review-submitted.v1",
    });
    return { reviewId, status: "pending_moderation" };
  });
}

interface DecisionEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly payload: unknown;
}

interface ReviewDecisionPayload {
  readonly action: "publish_review" | "do_not_publish_review";
  readonly caseId: string;
  readonly decisionId: string;
  readonly subjectId: string;
}

function parseReviewDecisionPayload(value: unknown): ReviewDecisionPayload {
  const raw = parsePayload(value);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("action" in raw) ||
    !("caseId" in raw) ||
    !("decisionId" in raw) ||
    !("subjectId" in raw) ||
    !("subjectType" in raw) ||
    (raw.action !== "publish_review" && raw.action !== "do_not_publish_review") ||
    raw.subjectType !== "review" ||
    typeof raw.caseId !== "string" ||
    typeof raw.decisionId !== "string" ||
    typeof raw.subjectId !== "string"
  ) {
    throw new Error("Review moderation decision payload is invalid");
  }
  requireUuid(raw.caseId, "caseId");
  requireUuid(raw.decisionId, "decisionId");
  requireUuid(raw.subjectId, "subjectId");
  return {
    action: raw.action,
    caseId: raw.caseId,
    decisionId: raw.decisionId,
    subjectId: raw.subjectId,
  };
}

export async function relayReviewModerationDecisions(
  database: SqlDatabase,
  options: { readonly limit?: number } = {},
): Promise<readonly string[]> {
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new LibraryInputError("LIMIT", "Некоректний ліміт обробки.");
  }
  const reviewIds: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const reviewId = await withDomainTransaction(database, async (transaction) => {
      const eventResult = await transaction.connection.query<DecisionEventRow>(`
        SELECT id, payload
        FROM outbox_events
        WHERE event_type = 'ModerationDecisionRecorded'
          AND event_version = 1
          AND published_at IS NULL
          AND payload->>'subjectType' = 'review'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const event = eventResult.rows[0];
      if (!event) return null;
      const payload = parseReviewDecisionPayload(event.payload);
      const reviewResult = await transaction.connection.query<{
        book_id: string;
        id: string;
        rating: number;
        review_text: string;
        status: LibraryReviewStatus;
      }>(
        `
          SELECT review.id, review.book_id, review.rating, review.review_text, review.status
          FROM moderation_review_subjects subject
          JOIN library_reviews review ON review.id = subject.review_id
          JOIN moderation_cases moderation_case ON moderation_case.id = subject.case_id
          JOIN moderation_decisions decision ON decision.case_id = moderation_case.id
          WHERE subject.case_id = $1
            AND review.id = $2
            AND decision.id = $3
            AND decision.action = $4
        `,
        [payload.caseId, payload.subjectId, payload.decisionId, payload.action],
      );
      const review = reviewResult.rows[0];
      if (!review) {
        throw new Error("Review moderation decision does not match a submitted review");
      }
      const nextStatus: LibraryReviewStatus =
        payload.action === "publish_review" ? "published" : "not_published";
      if (review.status === "pending_moderation") {
        await transaction.connection.query(
          `
            UPDATE library_reviews
            SET status = $2, moderated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'pending_moderation'
          `,
          [review.id, nextStatus],
        );
      } else if (review.status !== nextStatus) {
        throw new Error("Review status conflicts with moderation decision");
      }
      if (nextStatus === "published") {
        await transaction.connection.query(
          `
            INSERT INTO catalog_review_read_models (
              review_id, book_id, reviewer_public_name, rating, review_text, published_at
            ) VALUES ($1, $2, 'Підтверджений читач', $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (review_id) DO NOTHING
          `,
          [review.id, review.book_id, review.rating, review.review_text],
        );
        await transaction.connection.query(
          `
            UPDATE catalog_book_read_models book
            SET rating_count = aggregate.rating_count,
                rating_average = aggregate.rating_average,
                updated_at = CURRENT_TIMESTAMP
            FROM (
              SELECT COUNT(*)::int AS rating_count,
                     ROUND(AVG(rating)::numeric, 1) AS rating_average
              FROM catalog_review_read_models
              WHERE book_id = $1
            ) aggregate
            WHERE book.book_id = $1
          `,
          [review.book_id],
        );
      } else {
        await transaction.connection.query(
          "DELETE FROM catalog_review_read_models WHERE review_id = $1",
          [review.id],
        );
      }
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
      return review.id;
    });
    if (!reviewId) break;
    reviewIds.push(reviewId);
  }
  return reviewIds;
}
