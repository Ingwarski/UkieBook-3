import { createHash } from "node:crypto";

import { REWARDS_PAYOUTS_MIGRATION_ID } from "../../modules/platform/schema-revision";
import type { Migration } from "./types";
import { runStatements } from "./types";

const upStatements = [
  `
    ALTER TABLE author_payout_details
      ADD COLUMN reward_model TEXT
        CHECK (reward_model IS NULL OR reward_model IN ('fop', 'royalty')),
      ADD COLUMN details_revision INTEGER NOT NULL DEFAULT 1
        CHECK (details_revision > 0)
  `,
  `
    CREATE TABLE reward_allocation_rules (
      id TEXT PRIMARY KEY CHECK (length(btrim(id)) BETWEEN 1 AND 80),
      rule_kind TEXT NOT NULL CHECK (rule_kind IN ('standard', 'founder')),
      platform_net_revenue_bps INTEGER NOT NULL CHECK (platform_net_revenue_bps BETWEEN 0 AND 10000),
      platform_tax_component_bps INTEGER NOT NULL CHECK (platform_tax_component_bps BETWEEN 0 AND 10000),
      author_share_bps INTEGER NOT NULL CHECK (author_share_bps BETWEEN 0 AND 10000),
      public_platform_share_bps INTEGER NOT NULL CHECK (public_platform_share_bps BETWEEN 0 AND 10000),
      effective_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (platform_net_revenue_bps + platform_tax_component_bps = public_platform_share_bps),
      CHECK (public_platform_share_bps + author_share_bps = 10000),
      CHECK (
        (rule_kind = 'standard'
          AND platform_net_revenue_bps = 2900
          AND platform_tax_component_bps = 600
          AND author_share_bps = 6500
          AND public_platform_share_bps = 3500)
        OR
        (rule_kind = 'founder'
          AND platform_net_revenue_bps = 0
          AND platform_tax_component_bps = 0
          AND author_share_bps = 10000
          AND public_platform_share_bps = 0)
      )
    )
  `,
  `
    INSERT INTO reward_allocation_rules (
      id, rule_kind, platform_net_revenue_bps, platform_tax_component_bps,
      author_share_bps, public_platform_share_bps, effective_at
    ) VALUES
      ('standard-v1', 'standard', 2900, 600, 6500, 3500, '2026-07-01T00:00:00Z'),
      ('founder-v1', 'founder', 0, 0, 10000, 0, '2026-07-01T00:00:00Z')
  `,
  `
    CREATE TABLE reward_founder_state (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      author_user_id UUID NOT NULL UNIQUE REFERENCES author_profiles(user_id),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      assigned_by_manager_user_id UUID NOT NULL REFERENCES users(id),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE reward_founder_assignment_events (
      id UUID PRIMARY KEY,
      author_user_id UUID NOT NULL REFERENCES author_profiles(user_id),
      previous_author_user_id UUID REFERENCES author_profiles(user_id),
      manager_user_id UUID NOT NULL REFERENCES users(id),
      state_revision INTEGER NOT NULL CHECK (state_revision > 0),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (previous_author_user_id IS NULL OR previous_author_user_id <> author_user_id)
    )
  `,
  `
    CREATE TABLE reward_source_event_consumptions (
      source_event_id UUID PRIMARY KEY REFERENCES outbox_events(id),
      source_event_type TEXT NOT NULL
        CHECK (source_event_type IN ('PaidSale', 'RefundApproved', 'UpdateFeeAccrued')),
      produced_accrual_count INTEGER NOT NULL CHECK (produced_accrual_count >= 0),
      consumed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE reward_accrual_events (
      id UUID PRIMARY KEY,
      source_event_id UUID NOT NULL REFERENCES outbox_events(id),
      source_event_type TEXT NOT NULL
        CHECK (source_event_type IN ('PaidSale', 'RefundApproved', 'UpdateFeeAccrued')),
      source_record_id TEXT NOT NULL CHECK (length(btrim(source_record_id)) BETWEEN 1 AND 240),
      paid_sale_id UUID REFERENCES commerce_paid_sales(id),
      related_accrual_event_id UUID REFERENCES reward_accrual_events(id),
      author_user_id UUID NOT NULL REFERENCES author_profiles(user_id),
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      rule_id TEXT NOT NULL REFERENCES reward_allocation_rules(id),
      founder_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
      gross_kopiykas BIGINT NOT NULL CHECK (gross_kopiykas <> 0),
      platform_net_kopiykas BIGINT NOT NULL,
      platform_tax_kopiykas BIGINT NOT NULL,
      author_kopiykas BIGINT NOT NULL,
      platform_net_revenue_bps INTEGER NOT NULL CHECK (platform_net_revenue_bps BETWEEN 0 AND 10000),
      platform_tax_component_bps INTEGER NOT NULL CHECK (platform_tax_component_bps BETWEEN 0 AND 10000),
      author_share_bps INTEGER NOT NULL CHECK (author_share_bps BETWEEN 0 AND 10000),
      public_platform_share_bps INTEGER NOT NULL CHECK (public_platform_share_bps BETWEEN 0 AND 10000),
      currency CHAR(3) NOT NULL DEFAULT 'UAH' CHECK (currency = 'UAH'),
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (source_event_id, book_id),
      CHECK (platform_net_kopiykas + platform_tax_kopiykas + author_kopiykas = gross_kopiykas),
      CHECK (platform_net_revenue_bps + platform_tax_component_bps = public_platform_share_bps),
      CHECK (public_platform_share_bps + author_share_bps = 10000),
      CHECK (
        (source_event_type = 'PaidSale'
          AND gross_kopiykas > 0
          AND platform_net_kopiykas >= 0
          AND platform_tax_kopiykas >= 0
          AND author_kopiykas >= 0
          AND related_accrual_event_id IS NULL
          AND paid_sale_id IS NOT NULL)
        OR
        (source_event_type = 'RefundApproved'
          AND gross_kopiykas < 0
          AND platform_net_kopiykas <= 0
          AND platform_tax_kopiykas <= 0
          AND author_kopiykas <= 0
          AND related_accrual_event_id IS NOT NULL
          AND paid_sale_id IS NOT NULL)
        OR
        (source_event_type = 'UpdateFeeAccrued'
          AND gross_kopiykas < 0
          AND platform_net_kopiykas = 0
          AND platform_tax_kopiykas = 0
          AND author_kopiykas = gross_kopiykas
          AND related_accrual_event_id IS NULL
          AND paid_sale_id IS NULL)
      )
    )
  `,
  `
    CREATE INDEX reward_accrual_author_period_idx
      ON reward_accrual_events (author_user_id, occurred_at, id)
  `,
  `
    CREATE INDEX reward_accrual_book_period_idx
      ON reward_accrual_events (book_id, occurred_at, id)
  `,
  `
    CREATE TABLE reward_payout_rows (
      id UUID PRIMARY KEY,
      period_start DATE NOT NULL CHECK (period_start = date_trunc('month', period_start)::date),
      author_user_id UUID NOT NULL REFERENCES author_profiles(user_id),
      previous_carried_row_id UUID REFERENCES reward_payout_rows(id),
      reward_model TEXT CHECK (reward_model IS NULL OR reward_model IN ('fop', 'royalty')),
      founder_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
      sales_count INTEGER NOT NULL CHECK (sales_count >= 0),
      gross_sales_kopiykas BIGINT NOT NULL,
      platform_net_kopiykas BIGINT NOT NULL,
      platform_tax_kopiykas BIGINT NOT NULL,
      author_accrual_kopiykas BIGINT NOT NULL,
      carried_in_kopiykas BIGINT NOT NULL DEFAULT 0,
      amount_due_kopiykas BIGINT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('awaiting_details', 'carried', 'awaiting_payment', 'paid')),
      generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_by_manager_user_id UUID REFERENCES users(id),
      confirmed_at TIMESTAMPTZ,
      UNIQUE (period_start, author_user_id),
      UNIQUE (previous_carried_row_id),
      CHECK (amount_due_kopiykas = author_accrual_kopiykas + carried_in_kopiykas),
      CHECK (
        (status = 'paid' AND confirmed_by_manager_user_id IS NOT NULL AND confirmed_at IS NOT NULL)
        OR (status <> 'paid' AND confirmed_by_manager_user_id IS NULL AND confirmed_at IS NULL)
      ),
      CHECK (status NOT IN ('awaiting_payment', 'paid') OR amount_due_kopiykas >= 10000),
      CHECK (status <> 'carried' OR amount_due_kopiykas < 10000)
    )
  `,
  `
    CREATE INDEX reward_payout_rows_period_status_idx
      ON reward_payout_rows (period_start DESC, status, author_user_id)
  `,
  `
    CREATE TABLE reward_payout_book_rows (
      id UUID PRIMARY KEY,
      payout_row_id UUID NOT NULL REFERENCES reward_payout_rows(id) ON DELETE CASCADE,
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      sales_count INTEGER NOT NULL CHECK (sales_count >= 0),
      gross_sales_kopiykas BIGINT NOT NULL,
      author_accrual_kopiykas BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (payout_row_id, book_id)
    )
  `,
  `
    CREATE TABLE reward_audit_events (
      id UUID PRIMARY KEY,
      actor_user_id UUID REFERENCES users(id),
      author_user_id UUID REFERENCES author_profiles(user_id),
      event_type TEXT NOT NULL
        CHECK (event_type IN ('payout_details_saved', 'payout_confirmed', 'founder_assigned')),
      aggregate_id TEXT NOT NULL CHECK (length(btrim(aggregate_id)) BETWEEN 1 AND 240),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE FUNCTION reject_reward_immutable_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'reward financial and audit records are append-only';
    END;
    $$
  `,
  `
    CREATE FUNCTION protect_reward_payout_row()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reward payout rows are immutable';
      END IF;
      IF OLD.status = 'awaiting_payment'
        AND NEW.status = 'paid'
        AND NEW.confirmed_by_manager_user_id IS NOT NULL
        AND NEW.confirmed_at IS NOT NULL
        AND (to_jsonb(NEW) - ARRAY['status', 'confirmed_by_manager_user_id', 'confirmed_at']) =
            (to_jsonb(OLD) - ARRAY['status', 'confirmed_by_manager_user_id', 'confirmed_at'])
      THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'awaiting_details'
        AND NEW.status = 'awaiting_payment'
        AND OLD.reward_model IS NULL
        AND NEW.reward_model IN ('fop', 'royalty')
        AND NEW.amount_due_kopiykas >= 10000
        AND (to_jsonb(NEW) - ARRAY['status', 'reward_model']) =
            (to_jsonb(OLD) - ARRAY['status', 'reward_model'])
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'reward payout snapshot is immutable';
    END;
    $$
  `,
  `
    CREATE TRIGGER reward_allocation_rules_immutable
      BEFORE UPDATE OR DELETE ON reward_allocation_rules
      FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_mutation()
  `,
  `
    CREATE TRIGGER reward_founder_assignment_events_immutable
      BEFORE UPDATE OR DELETE ON reward_founder_assignment_events
      FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_mutation()
  `,
  `
    CREATE TRIGGER reward_source_event_consumptions_immutable
      BEFORE UPDATE OR DELETE ON reward_source_event_consumptions
      FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_mutation()
  `,
  `
    CREATE TRIGGER reward_accrual_events_immutable
      BEFORE UPDATE OR DELETE ON reward_accrual_events
      FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_mutation()
  `,
  `
    CREATE TRIGGER reward_payout_rows_protected
      BEFORE UPDATE OR DELETE ON reward_payout_rows
      FOR EACH ROW EXECUTE FUNCTION protect_reward_payout_row()
  `,
  `
    CREATE TRIGGER reward_payout_book_rows_immutable
      BEFORE UPDATE OR DELETE ON reward_payout_book_rows
      FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_mutation()
  `,
  `
    CREATE TRIGGER reward_audit_events_immutable
      BEFORE UPDATE OR DELETE ON reward_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_reward_immutable_mutation()
  `,
] as const;

const downStatements = [
  "DROP TRIGGER IF EXISTS reward_audit_events_immutable ON reward_audit_events",
  "DROP TRIGGER IF EXISTS reward_payout_book_rows_immutable ON reward_payout_book_rows",
  "DROP TRIGGER IF EXISTS reward_payout_rows_protected ON reward_payout_rows",
  "DROP TRIGGER IF EXISTS reward_accrual_events_immutable ON reward_accrual_events",
  "DROP TRIGGER IF EXISTS reward_source_event_consumptions_immutable ON reward_source_event_consumptions",
  "DROP TRIGGER IF EXISTS reward_founder_assignment_events_immutable ON reward_founder_assignment_events",
  "DROP TRIGGER IF EXISTS reward_allocation_rules_immutable ON reward_allocation_rules",
  "DROP FUNCTION IF EXISTS protect_reward_payout_row()",
  "DROP FUNCTION IF EXISTS reject_reward_immutable_mutation()",
  "DROP TABLE IF EXISTS reward_audit_events",
  "DROP TABLE IF EXISTS reward_payout_book_rows",
  "DROP TABLE IF EXISTS reward_payout_rows",
  "DROP TABLE IF EXISTS reward_accrual_events",
  "DROP TABLE IF EXISTS reward_source_event_consumptions",
  "DROP TABLE IF EXISTS reward_founder_assignment_events",
  "DROP TABLE IF EXISTS reward_founder_state",
  "DROP TABLE IF EXISTS reward_allocation_rules",
  "ALTER TABLE author_payout_details DROP COLUMN IF EXISTS details_revision",
  "ALTER TABLE author_payout_details DROP COLUMN IF EXISTS reward_model",
] as const;

export const rewardsPayoutsMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: REWARDS_PAYOUTS_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  down: (connection) => runStatements(connection, downStatements),
  id: REWARDS_PAYOUTS_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
};
