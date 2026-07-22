import { createHash } from "node:crypto";

import type { Migration } from "./types";
import { runStatements } from "./types";
import { PUBLISHING_PIPELINE_MIGRATION_ID } from "../../modules/platform/schema-revision";

const upStatements = [
  `
    CREATE TABLE publishing_private_objects (
      id UUID PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id),
      object_kind TEXT NOT NULL CHECK (
        object_kind IN ('manuscript', 'illustration', 'cover', 'normalized', 'preview', 'epub', 'mobi')
      ),
      storage_key TEXT NOT NULL UNIQUE CHECK (length(btrim(storage_key)) > 0),
      sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      byte_length BIGINT NOT NULL CHECK (byte_length > 0),
      media_type TEXT NOT NULL CHECK (length(btrim(media_type)) > 0),
      original_name TEXT CHECK (original_name IS NULL OR length(btrim(original_name)) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX publishing_private_objects_owner_idx
      ON publishing_private_objects (owner_user_id, created_at, id)
  `,
  `
    CREATE TABLE publishing_books (
      id UUID PRIMARY KEY,
      author_id UUID NOT NULL REFERENCES author_profiles(user_id),
      title VARCHAR(240) NOT NULL DEFAULT 'Нова книжка'
        CHECK (length(btrim(title)) BETWEEN 1 AND 240),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'submitted', 'manual_review', 'rejected', 'published')
      ),
      rejection_category TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX publishing_books_author_idx
      ON publishing_books (author_id, updated_at DESC, id)
  `,
  `
    CREATE TABLE publishing_book_drafts (
      id UUID PRIMARY KEY,
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 6),
      source_type TEXT CHECK (source_type IN ('txt', 'docx', 'google_docs')),
      source_reference TEXT,
      manuscript_object_id UUID REFERENCES publishing_private_objects(id),
      title VARCHAR(240) NOT NULL DEFAULT 'Нова книжка'
        CHECK (length(btrim(title)) BETWEEN 1 AND 240),
      description TEXT NOT NULL DEFAULT '',
      genre_slug VARCHAR(64) REFERENCES catalog_genres(slug),
      base_price_kopiykas INTEGER CHECK (base_price_kopiykas BETWEEN 0 AND 100000000),
      sample_section_index INTEGER CHECK (sample_section_index >= 0),
      sample_preview_artifact_id UUID,
      cover_mode TEXT NOT NULL DEFAULT 'fallback' CHECK (cover_mode IN ('uploaded', 'fallback')),
      cover_object_id UUID REFERENCES publishing_private_objects(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'converting', 'conversion_failed', 'ready', 'submitted')
      ),
      conversion_failure_code TEXT,
      conversion_failure_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (book_id, revision),
      CHECK (
        (status = 'conversion_failed' AND conversion_failure_code IS NOT NULL)
        OR (status <> 'conversion_failed' AND conversion_failure_code IS NULL AND conversion_failure_message IS NULL)
      )
    )
  `,
  `
    CREATE UNIQUE INDEX publishing_one_open_draft_per_book_idx
      ON publishing_book_drafts (book_id)
      WHERE status <> 'submitted'
  `,
  `
    CREATE INDEX publishing_drafts_status_idx
      ON publishing_book_drafts (status, updated_at, id)
  `,
  `
    CREATE TABLE publishing_draft_illustrations (
      id UUID PRIMARY KEY,
      draft_id UUID NOT NULL REFERENCES publishing_book_drafts(id) ON DELETE CASCADE,
      object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      anchor_label VARCHAR(160) NOT NULL,
      UNIQUE (draft_id, ordinal),
      UNIQUE (draft_id, object_id)
    )
  `,
  `
    CREATE TABLE publishing_conversion_runs (
      id UUID PRIMARY KEY,
      draft_id UUID NOT NULL REFERENCES publishing_book_drafts(id),
      draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
      input_sha256 CHAR(64) NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
      pipeline_version INTEGER NOT NULL CHECK (pipeline_version > 0),
      adapter_id TEXT NOT NULL CHECK (length(btrim(adapter_id)) > 0),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      normalized_object_id UUID REFERENCES publishing_private_objects(id),
      failure_code TEXT,
      failure_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      CHECK (
        (status = 'failed' AND failure_code IS NOT NULL)
        OR (status <> 'failed' AND failure_code IS NULL AND failure_message IS NULL)
      )
    )
  `,
  `
    CREATE INDEX publishing_conversion_runs_queue_idx
      ON publishing_conversion_runs (status, created_at, id)
  `,
  `
    CREATE TABLE publishing_preview_artifacts (
      id UUID PRIMARY KEY,
      draft_id UUID NOT NULL REFERENCES publishing_book_drafts(id),
      conversion_run_id UUID NOT NULL UNIQUE REFERENCES publishing_conversion_runs(id),
      preview_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      epub_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      mobi_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, draft_id)
    )
  `,
  `
    ALTER TABLE publishing_book_drafts
      ADD CONSTRAINT publishing_draft_sample_artifact_fk
      FOREIGN KEY (sample_preview_artifact_id, id)
      REFERENCES publishing_preview_artifacts (id, draft_id)
  `,
  `
    CREATE INDEX publishing_previews_by_draft_idx
      ON publishing_preview_artifacts (draft_id, created_at DESC, id)
  `,
  `
    CREATE TABLE publishing_book_versions (
      id UUID PRIMARY KEY,
      book_id UUID NOT NULL REFERENCES publishing_books(id),
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      author_id UUID NOT NULL REFERENCES author_profiles(user_id),
      manuscript_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      cover_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      preview_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      epub_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      mobi_object_id UUID NOT NULL REFERENCES publishing_private_objects(id),
      title VARCHAR(240) NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
      description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
      genre_slug VARCHAR(64) NOT NULL REFERENCES catalog_genres(slug),
      base_price_kopiykas INTEGER NOT NULL CHECK (base_price_kopiykas BETWEEN 0 AND 100000000),
      sample_section_index INTEGER NOT NULL CHECK (sample_section_index >= 0),
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status = 'submitted'),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (book_id, version_number)
    )
  `,
  `
    CREATE TABLE publishing_rights_declarations (
      id UUID PRIMARY KEY,
      book_version_id UUID NOT NULL REFERENCES publishing_book_versions(id),
      author_id UUID NOT NULL REFERENCES author_profiles(user_id),
      declaration_type TEXT NOT NULL CHECK (
        declaration_type IN ('rights', 'five_year_license')
      ),
      copy_version INTEGER NOT NULL CHECK (copy_version > 0),
      confirmed BOOLEAN NOT NULL CHECK (confirmed),
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (book_version_id, declaration_type)
    )
  `,
  `
    CREATE FUNCTION reject_publishing_immutable_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'publishing artifact is immutable';
    END;
    $$
  `,
  `
    CREATE TRIGGER publishing_private_objects_immutable
      BEFORE UPDATE OR DELETE ON publishing_private_objects
      FOR EACH ROW EXECUTE FUNCTION reject_publishing_immutable_mutation()
  `,
  `
    CREATE TRIGGER publishing_preview_artifacts_immutable
      BEFORE UPDATE OR DELETE ON publishing_preview_artifacts
      FOR EACH ROW EXECUTE FUNCTION reject_publishing_immutable_mutation()
  `,
  `
    CREATE TRIGGER publishing_book_versions_immutable
      BEFORE UPDATE OR DELETE ON publishing_book_versions
      FOR EACH ROW EXECUTE FUNCTION reject_publishing_immutable_mutation()
  `,
  `
    CREATE TRIGGER publishing_rights_declarations_immutable
      BEFORE UPDATE OR DELETE ON publishing_rights_declarations
      FOR EACH ROW EXECUTE FUNCTION reject_publishing_immutable_mutation()
  `,
] as const;

const downStatements = [
  "DROP TRIGGER IF EXISTS publishing_rights_declarations_immutable ON publishing_rights_declarations",
  "DROP TRIGGER IF EXISTS publishing_book_versions_immutable ON publishing_book_versions",
  "DROP TRIGGER IF EXISTS publishing_preview_artifacts_immutable ON publishing_preview_artifacts",
  "DROP TRIGGER IF EXISTS publishing_private_objects_immutable ON publishing_private_objects",
  "DROP FUNCTION IF EXISTS reject_publishing_immutable_mutation()",
  "ALTER TABLE publishing_book_drafts DROP CONSTRAINT IF EXISTS publishing_draft_sample_artifact_fk",
  "DROP TABLE IF EXISTS publishing_rights_declarations",
  "DROP TABLE IF EXISTS publishing_book_versions",
  "DROP TABLE IF EXISTS publishing_preview_artifacts",
  "DROP TABLE IF EXISTS publishing_conversion_runs",
  "DROP TABLE IF EXISTS publishing_draft_illustrations",
  "DROP TABLE IF EXISTS publishing_book_drafts",
  "DROP TABLE IF EXISTS publishing_books",
  "DROP TABLE IF EXISTS publishing_private_objects",
] as const;

export const publishingPipelineMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: PUBLISHING_PIPELINE_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  down: (connection) => runStatements(connection, downStatements),
  id: PUBLISHING_PIPELINE_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
};
