import { createHash } from "node:crypto";

import type { Migration } from "./types";
import { runStatements } from "./types";
import { MODERATION_PUBLICATION_MIGRATION_ID } from "../../modules/platform/schema-revision";

const upStatements = [
  `
    ALTER TABLE publishing_books
      DROP CONSTRAINT publishing_books_status_check
  `,
  `
    ALTER TABLE publishing_books
      ADD CONSTRAINT publishing_books_status_check CHECK (
        status IN ('draft', 'submitted', 'manual_review', 'rejected', 'published', 'unavailable')
      ),
      ADD COLUMN rejection_reason_code TEXT,
      ADD COLUMN rejection_reason_copy_version INTEGER,
      ADD CONSTRAINT publishing_books_rejection_reason_pair CHECK (
        (rejection_reason_code IS NULL AND rejection_reason_copy_version IS NULL)
        OR
        (rejection_reason_code IS NOT NULL AND rejection_reason_copy_version > 0)
      )
  `,
  `
    CREATE TABLE moderation_reason_categories (
      code TEXT NOT NULL CHECK (
        code IN (
          'content_restriction',
          'spam',
          'technical_issue',
          'rights_confirmation_required',
          'platform_requirements',
          'legal_restriction'
        )
      ),
      copy_version INTEGER NOT NULL CHECK (copy_version > 0),
      author_label VARCHAR(160) NOT NULL CHECK (length(btrim(author_label)) BETWEEN 2 AND 160),
      PRIMARY KEY (code, copy_version)
    )
  `,
  `
    INSERT INTO moderation_reason_categories (code, copy_version, author_label)
    VALUES
      ('content_restriction', 1, 'Обмеження щодо вмісту'),
      ('spam', 1, 'Ознаки спаму'),
      ('technical_issue', 1, 'Технічна проблема видання'),
      ('rights_confirmation_required', 1, 'Потрібне підтвердження прав'),
      ('platform_requirements', 1, 'Невідповідність вимогам платформи'),
      ('legal_restriction', 1, 'Правове обмеження')
  `,
  `
    CREATE TABLE moderation_cases (
      id UUID PRIMARY KEY,
      subject_type TEXT NOT NULL CHECK (subject_type IN ('book', 'book_update', 'review')),
      subject_id UUID NOT NULL,
      subject_version_id UUID NOT NULL,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('submission', 'post_publication_risk')),
      source_event_id UUID REFERENCES outbox_events(id),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
      status TEXT NOT NULL CHECK (
        status IN (
          'screening_pending',
          'manual_review_pending',
          'cleared',
          'approved',
          'rejected',
          'removed'
        )
      ),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (source_event_id),
      CHECK (
        subject_type <> 'book'
        OR trigger_type <> 'submission'
        OR source_event_id IS NOT NULL
      )
    )
  `,
  `
    CREATE UNIQUE INDEX moderation_submission_subject_idx
      ON moderation_cases (subject_type, subject_id, subject_version_id)
      WHERE trigger_type = 'submission'
  `,
  `
    CREATE INDEX moderation_cases_queue_idx
      ON moderation_cases (status, subject_type, created_at, id)
  `,
  `
    CREATE TABLE moderation_book_subjects (
      case_id UUID PRIMARY KEY REFERENCES moderation_cases(id) ON DELETE CASCADE,
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      book_version_id UUID NOT NULL REFERENCES publishing_book_versions(id),
      UNIQUE (case_id, book_id, book_version_id)
    )
  `,
  `
    CREATE INDEX moderation_book_subjects_book_idx
      ON moderation_book_subjects (book_id, book_version_id, case_id)
  `,
  `
    CREATE TABLE moderation_screening_runs (
      id UUID PRIMARY KEY,
      case_id UUID NOT NULL REFERENCES moderation_cases(id),
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      adapter_id TEXT NOT NULL CHECK (length(btrim(adapter_id)) > 0),
      policy_version INTEGER NOT NULL CHECK (policy_version > 0),
      result TEXT NOT NULL CHECK (result IN ('clear', 'flagged', 'provider_error')),
      internal_signals JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(internal_signals) = 'array'),
      provider_request_id TEXT,
      failure_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (case_id, attempt),
      CHECK (
        (result = 'provider_error' AND failure_code IS NOT NULL)
        OR (result <> 'provider_error' AND failure_code IS NULL)
      )
    )
  `,
  `
    CREATE TABLE moderation_decisions (
      id UUID PRIMARY KEY,
      case_id UUID NOT NULL UNIQUE REFERENCES moderation_cases(id),
      manager_user_id UUID NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK (
        action IN (
          'approve_publication',
          'reject_publication',
          'keep_published',
          'remove_publication',
          'approve_update',
          'reject_update',
          'publish_review',
          'do_not_publish_review'
        )
      ),
      reason_category_code TEXT,
      reason_copy_version INTEGER,
      removal_ground TEXT CHECK (
        removal_ground IS NULL OR removal_ground IN (
          'legal_violation',
          'copyright_violation',
          'platform_rules_violation'
        )
      ),
      case_revision INTEGER NOT NULL CHECK (case_revision > 0),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
      decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reason_category_code, reason_copy_version)
        REFERENCES moderation_reason_categories (code, copy_version),
      CHECK (
        (
          action IN ('reject_publication', 'reject_update')
          AND reason_category_code IS NOT NULL
          AND removal_ground IS NULL
        )
        OR
        (
          action = 'remove_publication'
          AND reason_category_code IS NULL
          AND reason_copy_version IS NULL
          AND removal_ground IS NOT NULL
        )
        OR
        (
          action NOT IN ('reject_publication', 'reject_update', 'remove_publication')
          AND reason_category_code IS NULL
          AND reason_copy_version IS NULL
          AND removal_ground IS NULL
        )
      )
    )
  `,
  `
    CREATE TABLE book_publications (
      book_id UUID PRIMARY KEY REFERENCES publishing_books(id),
      active_book_version_id UUID NOT NULL UNIQUE REFERENCES publishing_book_versions(id),
      state TEXT NOT NULL CHECK (state IN ('published', 'unavailable')),
      activation_case_id UUID NOT NULL REFERENCES moderation_cases(id),
      removal_decision_id UUID UNIQUE REFERENCES moderation_decisions(id),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      activated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      removed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (state = 'published' AND removal_decision_id IS NULL AND removed_at IS NULL)
        OR
        (state = 'unavailable' AND removal_decision_id IS NOT NULL AND removed_at IS NOT NULL)
      )
    )
  `,
  `
    CREATE TABLE publication_audit_events (
      id UUID PRIMARY KEY,
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      book_version_id UUID NOT NULL REFERENCES publishing_book_versions(id),
      case_id UUID NOT NULL REFERENCES moderation_cases(id),
      decision_id UUID REFERENCES moderation_decisions(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('activated', 'removed')),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'manager')),
      actor_user_id UUID REFERENCES users(id),
      reason_category_code TEXT,
      reason_copy_version INTEGER,
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reason_category_code, reason_copy_version)
        REFERENCES moderation_reason_categories (code, copy_version),
      CHECK (
        (actor_type = 'system' AND actor_user_id IS NULL)
        OR (actor_type = 'manager' AND actor_user_id IS NOT NULL)
      ),
      CHECK (event_type = 'removed' OR reason_category_code IS NULL)
    )
  `,
  `
    ALTER TABLE catalog_book_read_models
      ADD COLUMN source_book_version_id UUID REFERENCES publishing_book_versions(id),
      ADD COLUMN source_event_id UUID REFERENCES outbox_events(id),
      ADD COLUMN projection_revision INTEGER CHECK (
        projection_revision IS NULL OR projection_revision > 0
      ),
      ADD CONSTRAINT catalog_projection_provenance_pair CHECK (
        (source_book_version_id IS NULL AND source_event_id IS NULL AND projection_revision IS NULL)
        OR
        (source_book_version_id IS NOT NULL AND source_event_id IS NOT NULL AND projection_revision IS NOT NULL)
      )
  `,
  `
    CREATE SEQUENCE catalog_publication_rank_seq AS INTEGER MINVALUE 1
  `,
  `
    SELECT setval(
      'catalog_publication_rank_seq',
      GREATEST(COALESCE(MAX(catalog_rank), 0) + 1, 1),
      FALSE
    )
    FROM catalog_book_read_models
  `,
  `
    CREATE FUNCTION reject_moderation_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'moderation audit record is immutable';
    END;
    $$
  `,
  `
    CREATE TRIGGER moderation_reason_categories_immutable
      BEFORE UPDATE OR DELETE ON moderation_reason_categories
      FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation()
  `,
  `
    CREATE TRIGGER moderation_screening_runs_immutable
      BEFORE UPDATE OR DELETE ON moderation_screening_runs
      FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation()
  `,
  `
    CREATE TRIGGER moderation_decisions_immutable
      BEFORE UPDATE OR DELETE ON moderation_decisions
      FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation()
  `,
  `
    CREATE TRIGGER publication_audit_events_immutable
      BEFORE UPDATE OR DELETE ON publication_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation()
  `,
] as const;

const downStatements = [
  "DROP TRIGGER IF EXISTS publication_audit_events_immutable ON publication_audit_events",
  "DROP TRIGGER IF EXISTS moderation_decisions_immutable ON moderation_decisions",
  "DROP TRIGGER IF EXISTS moderation_screening_runs_immutable ON moderation_screening_runs",
  "DROP TRIGGER IF EXISTS moderation_reason_categories_immutable ON moderation_reason_categories",
  "DROP FUNCTION IF EXISTS reject_moderation_audit_mutation()",
  "DROP SEQUENCE IF EXISTS catalog_publication_rank_seq",
  "ALTER TABLE catalog_book_read_models DROP CONSTRAINT IF EXISTS catalog_projection_provenance_pair",
  "ALTER TABLE catalog_book_read_models DROP COLUMN IF EXISTS projection_revision",
  "ALTER TABLE catalog_book_read_models DROP COLUMN IF EXISTS source_event_id",
  "ALTER TABLE catalog_book_read_models DROP COLUMN IF EXISTS source_book_version_id",
  "DROP TABLE IF EXISTS publication_audit_events",
  "DROP TABLE IF EXISTS book_publications",
  "DROP TABLE IF EXISTS moderation_decisions",
  "DROP TABLE IF EXISTS moderation_screening_runs",
  "DROP TABLE IF EXISTS moderation_book_subjects",
  "DROP TABLE IF EXISTS moderation_cases",
  "DROP TABLE IF EXISTS moderation_reason_categories",
  "UPDATE publishing_books SET status = 'published' WHERE status = 'unavailable'",
  "ALTER TABLE publishing_books DROP CONSTRAINT IF EXISTS publishing_books_rejection_reason_pair",
  "ALTER TABLE publishing_books DROP COLUMN IF EXISTS rejection_reason_copy_version",
  "ALTER TABLE publishing_books DROP COLUMN IF EXISTS rejection_reason_code",
  "ALTER TABLE publishing_books DROP CONSTRAINT IF EXISTS publishing_books_status_check",
  `
    ALTER TABLE publishing_books
      ADD CONSTRAINT publishing_books_status_check CHECK (
        status IN ('draft', 'submitted', 'manual_review', 'rejected', 'published')
      )
  `,
] as const;

export const moderationPublicationMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: MODERATION_PUBLICATION_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  down: (connection) => runStatements(connection, downStatements),
  id: MODERATION_PUBLICATION_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
};
