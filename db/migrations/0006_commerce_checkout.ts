import { createHash } from "node:crypto";

import { COMMERCE_CHECKOUT_MIGRATION_ID } from "../../modules/platform/schema-revision";
import type { Migration } from "./types";
import { runStatements } from "./types";

const upStatements = [
  `
    CREATE TABLE commerce_carts (
      id UUID PRIMARY KEY,
      buyer_user_id UUID REFERENCES users(id),
      anonymous_token_digest CHAR(64)
        CHECK (
          anonymous_token_digest IS NULL
          OR anonymous_token_digest ~ '^[0-9a-f]{64}$'
        ),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'checkout_pending', 'purchased', 'merged')),
      merged_into_cart_id UUID REFERENCES commerce_carts(id),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (
          status IN ('active', 'checkout_pending')
          AND merged_into_cart_id IS NULL
          AND (
            (buyer_user_id IS NOT NULL AND anonymous_token_digest IS NULL)
            OR (buyer_user_id IS NULL AND anonymous_token_digest IS NOT NULL)
          )
        )
        OR (
          status = 'purchased'
          AND buyer_user_id IS NOT NULL
          AND anonymous_token_digest IS NULL
          AND merged_into_cart_id IS NULL
        )
        OR (
          status = 'merged'
          AND buyer_user_id IS NULL
          AND anonymous_token_digest IS NOT NULL
          AND merged_into_cart_id IS NOT NULL
        )
      ),
      CHECK (merged_into_cart_id IS NULL OR merged_into_cart_id <> id)
    )
  `,
  `
    CREATE UNIQUE INDEX commerce_one_open_cart_per_buyer_idx
      ON commerce_carts (buyer_user_id)
      WHERE buyer_user_id IS NOT NULL
        AND status IN ('active', 'checkout_pending')
  `,
  `
    CREATE UNIQUE INDEX commerce_one_active_cart_per_anonymous_token_idx
      ON commerce_carts (anonymous_token_digest)
      WHERE anonymous_token_digest IS NOT NULL
        AND status IN ('active', 'checkout_pending')
  `,
  `
    CREATE TABLE commerce_cart_items (
      cart_id UUID NOT NULL REFERENCES commerce_carts(id) ON DELETE CASCADE,
      book_id UUID NOT NULL REFERENCES catalog_book_read_models(book_id),
      added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (cart_id, book_id)
    )
  `,
  `
    CREATE TABLE commerce_orders (
      id UUID PRIMARY KEY,
      buyer_user_id UUID NOT NULL REFERENCES users(id),
      cart_id UUID NOT NULL REFERENCES commerce_carts(id),
      cart_revision INTEGER NOT NULL CHECK (cart_revision > 0),
      reference TEXT NOT NULL UNIQUE CHECK (length(btrim(reference)) BETWEEN 8 AND 120),
      status TEXT NOT NULL DEFAULT 'payment_pending'
        CHECK (status IN ('payment_pending', 'paid', 'payment_failed', 'cancelled')),
      currency CHAR(3) NOT NULL DEFAULT 'UAH' CHECK (currency = 'UAH'),
      total_kopiykas BIGINT NOT NULL CHECK (total_kopiykas > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      UNIQUE (cart_id, cart_revision),
      CHECK (
        (status = 'paid' AND paid_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND paid_at IS NULL)
        OR (status IN ('payment_pending', 'payment_failed') AND paid_at IS NULL AND cancelled_at IS NULL)
      )
    )
  `,
  `
    CREATE INDEX commerce_orders_buyer_created_idx
      ON commerce_orders (buyer_user_id, created_at DESC, id)
  `,
  `
    CREATE TABLE commerce_order_items (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES commerce_orders(id),
      ordinal INTEGER NOT NULL CHECK (ordinal > 0),
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      book_version_id UUID NOT NULL REFERENCES publishing_book_versions(id),
      author_id UUID NOT NULL REFERENCES author_profiles(user_id),
      title_snapshot VARCHAR(240) NOT NULL
        CHECK (length(btrim(title_snapshot)) BETWEEN 1 AND 240),
      author_public_name_snapshot VARCHAR(120) NOT NULL
        CHECK (length(btrim(author_public_name_snapshot)) BETWEEN 2 AND 120),
      cover_path_snapshot TEXT NOT NULL
        CHECK (cover_path_snapshot LIKE '/books/covers/%'),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
      base_price_kopiykas BIGINT NOT NULL CHECK (base_price_kopiykas >= 0),
      discount_kopiykas BIGINT NOT NULL DEFAULT 0 CHECK (discount_kopiykas >= 0),
      unit_price_kopiykas BIGINT NOT NULL CHECK (unit_price_kopiykas >= 0),
      line_total_kopiykas BIGINT NOT NULL CHECK (line_total_kopiykas >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (order_id, ordinal),
      UNIQUE (order_id, book_id),
      CHECK (unit_price_kopiykas = base_price_kopiykas - discount_kopiykas),
      CHECK (line_total_kopiykas = unit_price_kopiykas * quantity)
    )
  `,
  `
    CREATE TABLE commerce_payment_sessions (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES commerce_orders(id),
      provider TEXT NOT NULL DEFAULT 'mono' CHECK (provider = 'mono'),
      request_key TEXT NOT NULL UNIQUE CHECK (length(btrim(request_key)) BETWEEN 8 AND 240),
      provider_invoice_id TEXT UNIQUE
        CHECK (provider_invoice_id IS NULL OR length(btrim(provider_invoice_id)) BETWEEN 1 AND 160),
      checkout_url TEXT
        CHECK (checkout_url IS NULL OR length(btrim(checkout_url)) BETWEEN 1 AND 2048),
      status TEXT NOT NULL DEFAULT 'creating'
        CHECK (
          status IN (
            'creating', 'creation_unknown', 'created', 'processing', 'hold',
            'success', 'failure', 'reversed', 'expired'
          )
        ),
      amount_kopiykas BIGINT NOT NULL CHECK (amount_kopiykas > 0),
      currency_numeric INTEGER NOT NULL DEFAULT 980 CHECK (currency_numeric = 980),
      provider_created_at TIMESTAMPTZ,
      provider_modified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      failure_code VARCHAR(80),
      failure_reason VARCHAR(320),
      reconciliation_attempt INTEGER NOT NULL DEFAULT 0
        CHECK (reconciliation_attempt >= 0),
      last_reconciled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        status IN ('creating', 'creation_unknown', 'failure')
        OR provider_invoice_id IS NOT NULL
      )
    )
  `,
  `
    CREATE UNIQUE INDEX commerce_one_open_payment_session_per_order_idx
      ON commerce_payment_sessions (order_id)
      WHERE status IN ('creating', 'creation_unknown', 'created', 'processing', 'hold')
  `,
  `
    CREATE INDEX commerce_payment_sessions_reconciliation_idx
      ON commerce_payment_sessions (status, updated_at, id)
      WHERE status IN ('created', 'processing', 'hold')
  `,
  `
    CREATE TABLE commerce_payment_observations (
      id UUID PRIMARY KEY,
      payment_session_id UUID NOT NULL REFERENCES commerce_payment_sessions(id),
      provider_event_key TEXT NOT NULL UNIQUE
        CHECK (length(btrim(provider_event_key)) BETWEEN 8 AND 240),
      source TEXT NOT NULL CHECK (source IN ('webhook', 'reconciliation')),
      provider_status TEXT NOT NULL CHECK (
        provider_status IN ('created', 'processing', 'hold', 'success', 'failure', 'reversed', 'expired')
      ),
      amount_kopiykas BIGINT NOT NULL CHECK (amount_kopiykas >= 0),
      final_amount_kopiykas BIGINT CHECK (final_amount_kopiykas IS NULL OR final_amount_kopiykas >= 0),
      currency_numeric INTEGER NOT NULL,
      provider_reference TEXT,
      provider_modified_at TIMESTAMPTZ,
      body_sha256 CHAR(64)
        CHECK (body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$'),
      signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
      applied BOOLEAN NOT NULL DEFAULT FALSE,
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (source <> 'webhook' OR (signature_verified AND body_sha256 IS NOT NULL))
    )
  `,
  `
    CREATE INDEX commerce_payment_observations_session_idx
      ON commerce_payment_observations (
        payment_session_id, provider_modified_at DESC, received_at DESC, id
      )
  `,
  `
    CREATE TABLE commerce_reconciliation_issues (
      id UUID PRIMARY KEY,
      payment_session_id UUID NOT NULL REFERENCES commerce_payment_sessions(id),
      issue_type TEXT NOT NULL CHECK (
        issue_type IN (
          'amount_mismatch', 'currency_mismatch', 'reference_mismatch',
          'duplicate_success', 'status_conflict', 'creation_unknown',
          'reconciliation_overdue'
        )
      ),
      details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
      detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMPTZ
    )
  `,
  `
    CREATE UNIQUE INDEX commerce_open_reconciliation_issue_idx
      ON commerce_reconciliation_issues (payment_session_id, issue_type)
      WHERE resolved_at IS NULL
  `,
  `
    CREATE TABLE commerce_paid_sales (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL UNIQUE REFERENCES commerce_orders(id),
      payment_session_id UUID NOT NULL UNIQUE REFERENCES commerce_payment_sessions(id),
      provider_invoice_id TEXT NOT NULL UNIQUE,
      total_kopiykas BIGINT NOT NULL CHECK (total_kopiykas > 0),
      currency CHAR(3) NOT NULL DEFAULT 'UAH' CHECK (currency = 'UAH'),
      paid_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE notifications_purchase_deliveries (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL UNIQUE REFERENCES commerce_orders(id),
      paid_sale_id UUID NOT NULL UNIQUE REFERENCES commerce_paid_sales(id),
      buyer_user_id UUID NOT NULL REFERENCES users(id),
      request_event_id UUID NOT NULL UNIQUE REFERENCES outbox_events(id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent')),
      provider_message_id TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (status = 'pending' AND sent_at IS NULL)
        OR (status = 'sent' AND sent_at IS NOT NULL)
      )
    )
  `,
  `
    CREATE FUNCTION reject_commerce_immutable_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'commerce financial records are append-only';
    END;
    $$
  `,
  `
    CREATE FUNCTION guard_commerce_order_item_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM 1
      FROM commerce_orders
      WHERE id = NEW.order_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'commerce order does not exist';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM commerce_payment_sessions
        WHERE order_id = NEW.order_id
      ) THEN
        RAISE EXCEPTION 'commerce order snapshot is sealed for payment';
      END IF;
      RETURN NEW;
    END;
    $$
  `,
  `
    CREATE FUNCTION validate_commerce_payment_session_snapshot()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      expected_total BIGINT;
      item_count BIGINT;
      item_total NUMERIC;
    BEGIN
      SELECT total_kopiykas
      INTO expected_total
      FROM commerce_orders
      WHERE id = NEW.order_id
      FOR UPDATE;

      SELECT COUNT(*), COALESCE(SUM(line_total_kopiykas), 0)
      INTO item_count, item_total
      FROM commerce_order_items
      WHERE order_id = NEW.order_id;

      IF expected_total IS NULL
        OR item_count = 0
        OR item_total <> expected_total
        OR NEW.amount_kopiykas <> expected_total
      THEN
        RAISE EXCEPTION 'payment session does not match immutable order items';
      END IF;
      RETURN NEW;
    END;
    $$
  `,
  `
    CREATE FUNCTION protect_commerce_order_snapshot()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id
        OR NEW.cart_id IS DISTINCT FROM OLD.cart_id
        OR NEW.cart_revision IS DISTINCT FROM OLD.cart_revision
        OR NEW.reference IS DISTINCT FROM OLD.reference
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.total_kopiykas IS DISTINCT FROM OLD.total_kopiykas
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'commerce order snapshot is immutable';
      END IF;
      RETURN NEW;
    END;
    $$
  `,
  `
    CREATE TRIGGER commerce_orders_snapshot_protected
      BEFORE UPDATE ON commerce_orders
      FOR EACH ROW EXECUTE FUNCTION protect_commerce_order_snapshot()
  `,
  `
    CREATE FUNCTION protect_commerce_payment_session_snapshot()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.request_key IS DISTINCT FROM OLD.request_key
        OR NEW.amount_kopiykas IS DISTINCT FROM OLD.amount_kopiykas
        OR NEW.currency_numeric IS DISTINCT FROM OLD.currency_numeric
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR (
          OLD.provider_invoice_id IS NOT NULL
          AND NEW.provider_invoice_id IS DISTINCT FROM OLD.provider_invoice_id
        )
        OR (
          OLD.checkout_url IS NOT NULL
          AND NEW.checkout_url IS DISTINCT FROM OLD.checkout_url
        )
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'commerce payment-session snapshot is immutable';
      END IF;
      RETURN NEW;
    END;
    $$
  `,
  `
    CREATE TRIGGER commerce_payment_sessions_snapshot_protected
      BEFORE UPDATE ON commerce_payment_sessions
      FOR EACH ROW EXECUTE FUNCTION protect_commerce_payment_session_snapshot()
  `,
  `
    CREATE TRIGGER commerce_order_items_immutable
      BEFORE UPDATE OR DELETE ON commerce_order_items
      FOR EACH ROW EXECUTE FUNCTION reject_commerce_immutable_mutation()
  `,
  `
    CREATE TRIGGER commerce_order_items_insert_guard
      BEFORE INSERT ON commerce_order_items
      FOR EACH ROW EXECUTE FUNCTION guard_commerce_order_item_insert()
  `,
  `
    CREATE TRIGGER commerce_payment_sessions_insert_guard
      BEFORE INSERT ON commerce_payment_sessions
      FOR EACH ROW EXECUTE FUNCTION validate_commerce_payment_session_snapshot()
  `,
  `
    CREATE FUNCTION protect_commerce_payment_observation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'commerce financial records are append-only';
      END IF;
      IF OLD.applied = FALSE
        AND NEW.applied = TRUE
        AND (to_jsonb(NEW) - 'applied') =
            (to_jsonb(OLD) - 'applied')
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'commerce payment observation is immutable';
    END;
    $$
  `,
  `
    CREATE TRIGGER commerce_payment_observations_immutable
      BEFORE UPDATE OR DELETE ON commerce_payment_observations
      FOR EACH ROW EXECUTE FUNCTION protect_commerce_payment_observation()
  `,
  `
    CREATE TRIGGER commerce_paid_sales_immutable
      BEFORE UPDATE OR DELETE ON commerce_paid_sales
      FOR EACH ROW EXECUTE FUNCTION reject_commerce_immutable_mutation()
  `,
] as const;

const downStatements = [
  "DROP TRIGGER IF EXISTS commerce_payment_sessions_insert_guard ON commerce_payment_sessions",
  "DROP TRIGGER IF EXISTS commerce_order_items_insert_guard ON commerce_order_items",
  "DROP TRIGGER IF EXISTS commerce_payment_sessions_snapshot_protected ON commerce_payment_sessions",
  "DROP TRIGGER IF EXISTS commerce_orders_snapshot_protected ON commerce_orders",
  "DROP TRIGGER IF EXISTS commerce_paid_sales_immutable ON commerce_paid_sales",
  "DROP TRIGGER IF EXISTS commerce_payment_observations_immutable ON commerce_payment_observations",
  "DROP TRIGGER IF EXISTS commerce_order_items_immutable ON commerce_order_items",
  "DROP FUNCTION IF EXISTS protect_commerce_payment_observation()",
  "DROP FUNCTION IF EXISTS validate_commerce_payment_session_snapshot()",
  "DROP FUNCTION IF EXISTS guard_commerce_order_item_insert()",
  "DROP FUNCTION IF EXISTS protect_commerce_payment_session_snapshot()",
  "DROP FUNCTION IF EXISTS reject_commerce_immutable_mutation()",
  "DROP FUNCTION IF EXISTS protect_commerce_order_snapshot()",
  "DROP TABLE IF EXISTS notifications_purchase_deliveries",
  "DROP TABLE IF EXISTS commerce_paid_sales",
  "DROP TABLE IF EXISTS commerce_reconciliation_issues",
  "DROP TABLE IF EXISTS commerce_payment_observations",
  "DROP TABLE IF EXISTS commerce_payment_sessions",
  "DROP TABLE IF EXISTS commerce_order_items",
  "DROP TABLE IF EXISTS commerce_orders",
  "DROP TABLE IF EXISTS commerce_cart_items",
  "DROP TABLE IF EXISTS commerce_carts",
] as const;

export const commerceCheckoutMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: COMMERCE_CHECKOUT_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  down: (connection) => runStatements(connection, downStatements),
  id: COMMERCE_CHECKOUT_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
};
