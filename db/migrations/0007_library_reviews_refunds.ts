import { createHash } from "node:crypto";

import { LIBRARY_REVIEWS_REFUNDS_MIGRATION_ID } from "../../modules/platform/schema-revision";
import type { Migration } from "./types";
import { runStatements } from "./types";

const upStatements = [
  `
    CREATE TABLE library_entitlements (
      id UUID PRIMARY KEY,
      buyer_user_id UUID NOT NULL REFERENCES users(id),
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      paid_sale_id UUID NOT NULL REFERENCES commerce_paid_sales(id),
      source_order_item_id UUID NOT NULL UNIQUE REFERENCES commerce_order_items(id),
      source_book_version_id UUID NOT NULL REFERENCES publishing_book_versions(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      refunded_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (buyer_user_id, book_id),
      UNIQUE (paid_sale_id, book_id),
      CHECK (
        (status = 'active' AND refunded_at IS NULL)
        OR (status = 'refunded' AND refunded_at IS NOT NULL)
      )
    )
  `,
  `
    CREATE INDEX library_entitlements_buyer_idx
      ON library_entitlements (buyer_user_id, created_at DESC, id)
  `,
  `
    CREATE TABLE library_entitlement_events (
      id UUID PRIMARY KEY,
      entitlement_id UUID NOT NULL REFERENCES library_entitlements(id),
      event_type TEXT NOT NULL CHECK (
        event_type IN ('created', 'version_resolved', 'refund_requested', 'refund_approved', 'refund_declined')
      ),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE library_reviews (
      id UUID PRIMARY KEY,
      entitlement_id UUID NOT NULL UNIQUE REFERENCES library_entitlements(id),
      buyer_user_id UUID NOT NULL REFERENCES users(id),
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      review_text TEXT NOT NULL CHECK (length(btrim(review_text)) BETWEEN 2 AND 3000),
      status TEXT NOT NULL DEFAULT 'pending_moderation'
        CHECK (status IN ('pending_moderation', 'published', 'not_published')),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      moderated_at TIMESTAMPTZ,
      UNIQUE (buyer_user_id, book_id),
      CHECK (
        (status = 'pending_moderation' AND moderated_at IS NULL)
        OR (status IN ('published', 'not_published') AND moderated_at IS NOT NULL)
      )
    )
  `,
  `
    CREATE INDEX library_reviews_book_status_idx
      ON library_reviews (book_id, status, submitted_at DESC, id)
  `,
  `
    CREATE TABLE moderation_review_subjects (
      case_id UUID PRIMARY KEY REFERENCES moderation_cases(id) ON DELETE CASCADE,
      review_id UUID NOT NULL UNIQUE REFERENCES library_reviews(id),
      UNIQUE (case_id, review_id)
    )
  `,
  `
    CREATE TABLE refund_requests (
      id UUID PRIMARY KEY,
      entitlement_id UUID NOT NULL UNIQUE REFERENCES library_entitlements(id),
      buyer_user_id UUID NOT NULL REFERENCES users(id),
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (status = 'pending' AND decided_at IS NULL)
        OR (status IN ('approved', 'declined') AND decided_at IS NOT NULL)
      )
    )
  `,
  `
    CREATE INDEX refund_requests_manager_queue_idx
      ON refund_requests (status, requested_at ASC, id)
  `,
  `
    CREATE TABLE refund_decisions (
      id UUID PRIMARY KEY,
      refund_request_id UUID NOT NULL UNIQUE REFERENCES refund_requests(id),
      manager_user_id UUID NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL CHECK (decision IN ('approved', 'declined')),
      decision_note TEXT NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1200),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
      decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE refund_compensations (
      id UUID PRIMARY KEY,
      refund_request_id UUID NOT NULL UNIQUE REFERENCES refund_requests(id),
      refund_decision_id UUID NOT NULL UNIQUE REFERENCES refund_decisions(id),
      entitlement_id UUID NOT NULL UNIQUE REFERENCES library_entitlements(id),
      paid_sale_id UUID NOT NULL REFERENCES commerce_paid_sales(id),
      buyer_user_id UUID NOT NULL REFERENCES users(id),
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      amount_kopiykas BIGINT NOT NULL CHECK (amount_kopiykas > 0),
      currency CHAR(3) NOT NULL DEFAULT 'UAH' CHECK (currency = 'UAH'),
      refund_approved_event_id UUID NOT NULL UNIQUE REFERENCES outbox_events(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE FUNCTION reject_library_immutable_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'library audit and compensation records are append-only';
    END;
    $$
  `,
  `
    CREATE TRIGGER library_entitlement_events_immutable
      BEFORE UPDATE OR DELETE ON library_entitlement_events
      FOR EACH ROW EXECUTE FUNCTION reject_library_immutable_mutation()
  `,
  `
    CREATE TRIGGER library_reviews_immutable_snapshot
      BEFORE DELETE ON library_reviews
      FOR EACH ROW EXECUTE FUNCTION reject_library_immutable_mutation()
  `,
  `
    CREATE TRIGGER refund_decisions_immutable
      BEFORE UPDATE OR DELETE ON refund_decisions
      FOR EACH ROW EXECUTE FUNCTION reject_library_immutable_mutation()
  `,
  `
    CREATE TRIGGER refund_compensations_immutable
      BEFORE UPDATE OR DELETE ON refund_compensations
      FOR EACH ROW EXECUTE FUNCTION reject_library_immutable_mutation()
  `,
] as const;

const downStatements = [
  "DROP TRIGGER IF EXISTS refund_compensations_immutable ON refund_compensations",
  "DROP TRIGGER IF EXISTS refund_decisions_immutable ON refund_decisions",
  "DROP TRIGGER IF EXISTS library_reviews_immutable_snapshot ON library_reviews",
  "DROP TRIGGER IF EXISTS library_entitlement_events_immutable ON library_entitlement_events",
  "DROP FUNCTION IF EXISTS reject_library_immutable_mutation()",
  "DROP TABLE IF EXISTS refund_compensations",
  "DROP TABLE IF EXISTS refund_decisions",
  "DROP TABLE IF EXISTS refund_requests",
  "DROP TABLE IF EXISTS moderation_review_subjects",
  "DROP TABLE IF EXISTS library_reviews",
  "DROP TABLE IF EXISTS library_entitlement_events",
  "DROP TABLE IF EXISTS library_entitlements",
] as const;

export const libraryReviewsRefundsMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: LIBRARY_REVIEWS_REFUNDS_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  down: (connection) => runStatements(connection, downStatements),
  id: LIBRARY_REVIEWS_REFUNDS_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
};
