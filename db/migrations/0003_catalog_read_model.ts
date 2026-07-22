import { createHash } from "node:crypto";

import type { Migration } from "./types";
import { runStatements } from "./types";
import { CATALOG_READ_MODEL_MIGRATION_ID } from "../../modules/platform/schema-revision";

const upStatements = [
  `
    CREATE TABLE catalog_genres (
      slug VARCHAR(64) PRIMARY KEY
        CHECK (slug ~ '^[a-z0-9-]+$'),
      label VARCHAR(80) NOT NULL UNIQUE
        CHECK (length(btrim(label)) BETWEEN 2 AND 80)
    )
  `,
  `
    CREATE TABLE catalog_book_read_models (
      book_id UUID PRIMARY KEY,
      title VARCHAR(240) NOT NULL
        CHECK (length(btrim(title)) BETWEEN 1 AND 240),
      author_public_id UUID NOT NULL,
      author_public_name VARCHAR(120) NOT NULL
        CHECK (length(btrim(author_public_name)) BETWEEN 2 AND 120),
      genre_slug VARCHAR(64) NOT NULL REFERENCES catalog_genres(slug),
      description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
      sample_title VARCHAR(160) NOT NULL,
      sample_blocks JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(sample_blocks) = 'array'),
      cover_path TEXT NOT NULL CHECK (cover_path LIKE '/books/covers/%'),
      cover_theme TEXT NOT NULL
        CHECK (cover_theme IN ('teal', 'mustard', 'cobalt', 'coral', 'violet', 'indigo')),
      base_price_kopiykas INTEGER NOT NULL CHECK (base_price_kopiykas >= 0),
      discount_price_kopiykas INTEGER,
      discount_starts_at TIMESTAMPTZ,
      discount_ends_at TIMESTAMPTZ,
      availability TEXT NOT NULL DEFAULT 'published'
        CHECK (availability IN ('published', 'unavailable')),
      catalog_rank INTEGER NOT NULL CHECK (catalog_rank > 0),
      rating_average NUMERIC(2,1)
        CHECK (rating_average IS NULL OR rating_average BETWEEN 1 AND 5),
      rating_count INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
      published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (discount_price_kopiykas IS NULL AND discount_starts_at IS NULL AND discount_ends_at IS NULL)
        OR
        (
          discount_price_kopiykas IS NOT NULL
          AND discount_starts_at IS NOT NULL
          AND discount_ends_at IS NOT NULL
          AND discount_price_kopiykas >= 0
          AND discount_price_kopiykas < base_price_kopiykas
          AND discount_ends_at > discount_starts_at
        )
      )
    )
  `,
  `
    CREATE INDEX catalog_books_browse_idx
      ON catalog_book_read_models (availability, catalog_rank, book_id)
  `,
  `
    CREATE INDEX catalog_books_genre_idx
      ON catalog_book_read_models (genre_slug, availability, catalog_rank, book_id)
  `,
  `
    CREATE INDEX catalog_books_discount_idx
      ON catalog_book_read_models (discount_starts_at, discount_ends_at, book_id)
      WHERE availability = 'published' AND discount_price_kopiykas IS NOT NULL
  `,
  `
    CREATE TABLE catalog_featured_slots (
      section TEXT NOT NULL CHECK (section IN ('shelf', 'tile')),
      position INTEGER NOT NULL CHECK (position > 0),
      book_id UUID NOT NULL REFERENCES catalog_book_read_models(book_id) ON DELETE CASCADE,
      PRIMARY KEY (section, position),
      UNIQUE (section, book_id)
    )
  `,
  `
    CREATE TABLE catalog_review_read_models (
      review_id UUID PRIMARY KEY,
      book_id UUID NOT NULL REFERENCES catalog_book_read_models(book_id) ON DELETE CASCADE,
      reviewer_public_name VARCHAR(80) NOT NULL
        CHECK (length(btrim(reviewer_public_name)) BETWEEN 2 AND 80),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      review_text TEXT NOT NULL CHECK (length(btrim(review_text)) BETWEEN 2 AND 3000),
      published_at TIMESTAMPTZ NOT NULL
    )
  `,
  `
    CREATE INDEX catalog_reviews_book_idx
      ON catalog_review_read_models (book_id, published_at DESC, review_id)
  `,
] as const;

const downStatements = [
  "DROP TABLE IF EXISTS catalog_review_read_models",
  "DROP TABLE IF EXISTS catalog_featured_slots",
  "DROP TABLE IF EXISTS catalog_book_read_models",
  "DROP TABLE IF EXISTS catalog_genres",
] as const;

export const catalogReadModelMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: CATALOG_READ_MODEL_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  down: (connection) => runStatements(connection, downStatements),
  id: CATALOG_READ_MODEL_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
};
