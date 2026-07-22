import "server-only";

import type { SqlExecutor } from "../../platform/sql-port";
import { CATALOG_PAGE_SIZE } from "../query";
import { presentPrice } from "../price";
import {
  CATALOG_READ_MODEL_SCHEMA_VERSION,
  type BookCatalogReadModel,
  type BookPageReadModel,
  type CatalogBookSummary,
  type CatalogQuery,
  type CoverTheme,
} from "../types";

const REVIEW_PAGE_SIZE = 3;

interface BookRow extends Record<string, unknown> {
  book_id: string;
  title: string;
  author_public_id: string;
  author_public_name: string;
  genre_slug: string;
  genre_label: string;
  cover_path: string;
  cover_theme: CoverTheme;
  base_price_kopiykas: number;
  discount_price_kopiykas: number | null;
  discount_starts_at: Date | string | null;
  discount_ends_at: Date | string | null;
  rating_average: number | string | null;
  rating_count: number;
}
interface BookPageRow extends BookRow {
  availability: "published" | "unavailable";
  description: string;
  sample_title: string;
  sample_blocks:
    | readonly { readonly kind: "heading" | "paragraph"; readonly text: string }[]
    | string;
}

function summaryFromRow(row: BookRow, asOf: Date): CatalogBookSummary {
  return {
    author: {
      id: row.author_public_id,
      publicName: row.author_public_name,
    },
    cover: {
      alt: `${row.title} — ${row.author_public_name}`,
      src: row.cover_path,
      theme: row.cover_theme,
    },
    genre: {
      name: row.genre_label,
      slug: row.genre_slug,
    },
    id: row.book_id,
    price: presentPrice(
      {
        basePriceKopiykas: row.base_price_kopiykas,
        discountEndsAt: row.discount_ends_at,
        discountPriceKopiykas: row.discount_price_kopiykas,
        discountStartsAt: row.discount_starts_at,
      },
      asOf,
    ),
    rating: {
      average: row.rating_average === null ? null : Number(row.rating_average),
      count: row.rating_count,
    },
    title: row.title,
  };
}

const bookColumns = `
  b.book_id,
  b.title,
  b.author_public_id,
  b.author_public_name,
  b.genre_slug,
  g.label AS genre_label,
  b.cover_path,
  b.cover_theme,
  b.base_price_kopiykas,
  b.discount_price_kopiykas,
  b.discount_starts_at,
  b.discount_ends_at,
  b.rating_average,
  b.rating_count
`;

const publicFilter = `
  b.availability = 'published'
  AND (
    $2::text IS NULL
    OR strpos(lower(b.title || ' ' || b.author_public_name), lower($2::text)) > 0
  )
  AND ($3::text IS NULL OR b.genre_slug = $3::text)
  AND (
    NOT $4::boolean
    OR (
      b.discount_price_kopiykas IS NOT NULL
      AND $1::timestamptz >= b.discount_starts_at
      AND $1::timestamptz < b.discount_ends_at
    )
  )
`;

const sortSql: Record<CatalogQuery["sort"], string> = {
  featured: "b.catalog_rank ASC, b.book_id ASC",
  price_asc: `
    CASE
      WHEN b.discount_price_kopiykas IS NOT NULL
        AND $1::timestamptz >= b.discount_starts_at
        AND $1::timestamptz < b.discount_ends_at
      THEN b.discount_price_kopiykas
      ELSE b.base_price_kopiykas
    END ASC,
    b.book_id ASC
  `,
  price_desc: `
    CASE
      WHEN b.discount_price_kopiykas IS NOT NULL
        AND $1::timestamptz >= b.discount_starts_at
        AND $1::timestamptz < b.discount_ends_at
      THEN b.discount_price_kopiykas
      ELSE b.base_price_kopiykas
    END DESC,
    b.book_id ASC
  `,
  title: "lower(b.title) ASC, b.book_id ASC",
};

export async function searchCatalog(
  executor: SqlExecutor,
  query: CatalogQuery,
  asOf: Date,
): Promise<BookCatalogReadModel> {
  const sharedParameters = [
    asOf.toISOString(),
    query.q,
    query.genre,
    query.discountedOnly,
  ] as const;
  const [countResult, genresResult, featuredResult] = await Promise.all([
    executor.query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM catalog_book_read_models b
        WHERE ${publicFilter}
      `,
      sharedParameters,
    ),
    executor.query<{ label: string; slug: string }>(
      "SELECT slug, label FROM catalog_genres ORDER BY label, slug",
    ),
    executor.query<BookRow & { position: number; section: "shelf" | "tile" }>(
      `
        SELECT ${bookColumns}, slots.section, slots.position
        FROM catalog_featured_slots slots
        JOIN catalog_book_read_models b ON b.book_id = slots.book_id
        JOIN catalog_genres g ON g.slug = b.genre_slug
        WHERE b.availability = 'published'
        ORDER BY slots.section, slots.position
      `,
    ),
  ]);

  const totalItems = countResult.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / CATALOG_PAGE_SIZE));
  const page = Math.min(query.page, totalPages);
  const result = await executor.query<BookRow>(
    `
      SELECT ${bookColumns}
      FROM catalog_book_read_models b
      JOIN catalog_genres g ON g.slug = b.genre_slug
      WHERE ${publicFilter}
      ORDER BY ${sortSql[query.sort]}
      LIMIT $5 OFFSET $6
    `,
    [...sharedParameters, CATALOG_PAGE_SIZE, (page - 1) * CATALOG_PAGE_SIZE],
  );

  const featured = featuredResult.rows.map((row) => ({
    model: summaryFromRow(row, asOf),
    section: row.section,
  }));
  return {
    featuredShelf: featured
      .filter((entry) => entry.section === "shelf")
      .map((entry) => entry.model),
    featuredTiles: featured
      .filter((entry) => entry.section === "tile")
      .map((entry) => entry.model),
    genres: genresResult.rows.map((genre) => ({
      name: genre.label,
      slug: genre.slug,
    })),
    pagination: {
      page,
      pageSize: CATALOG_PAGE_SIZE,
      totalItems,
      totalPages,
    },
    query: { ...query, page },
    results: result.rows.map((row) => summaryFromRow(row, asOf)),
    schemaVersion: CATALOG_READ_MODEL_SCHEMA_VERSION,
  };
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function sampleBlocks(row: BookPageRow): BookPageReadModel["freeSample"]["blocks"] {
  const value =
    typeof row.sample_blocks === "string"
      ? (JSON.parse(row.sample_blocks) as unknown)
      : row.sample_blocks;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (block): block is { kind: "heading" | "paragraph"; text: string } =>
      typeof block === "object" &&
      block !== null &&
      (block.kind === "heading" || block.kind === "paragraph") &&
      typeof block.text === "string",
  );
}

export async function findBookPage(
  executor: SqlExecutor,
  bookId: string,
  options: { readonly asOf: Date; readonly reviewsPage: number },
): Promise<BookPageReadModel | null> {
  if (!validUuid(bookId)) return null;
  const bookResult = await executor.query<BookPageRow>(
    `
      SELECT
        ${bookColumns},
        b.availability,
        b.description,
        b.sample_title,
        b.sample_blocks
      FROM catalog_book_read_models b
      JOIN catalog_genres g ON g.slug = b.genre_slug
      WHERE b.book_id = $1
    `,
    [bookId],
  );
  const row = bookResult.rows[0];
  if (!row) return null;

  const reviewCount = await executor.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM catalog_review_read_models WHERE book_id = $1",
    [bookId],
  );
  const totalItems = reviewCount.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / REVIEW_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.reviewsPage), totalPages);
  const reviews = await executor.query<{
    published_at: Date | string;
    rating: number;
    review_id: string;
    review_text: string;
    reviewer_public_name: string;
  }>(
    `
      SELECT review_id, reviewer_public_name, rating, review_text, published_at
      FROM catalog_review_read_models
      WHERE book_id = $1
      ORDER BY published_at DESC, review_id
      LIMIT $2 OFFSET $3
    `,
    [bookId, REVIEW_PAGE_SIZE, (page - 1) * REVIEW_PAGE_SIZE],
  );
  const available = row.availability === "published";

  return {
    author: { id: row.author_public_id, publicName: row.author_public_name },
    availability: available ? "available" : "unavailable",
    cover: {
      alt: `${row.title} — ${row.author_public_name}`,
      src: row.cover_path,
      theme: row.cover_theme,
    },
    description: row.description,
    freeSample: {
      blocks: available ? sampleBlocks(row) : [],
      title: row.sample_title,
    },
    genre: { name: row.genre_label, slug: row.genre_slug },
    id: row.book_id,
    price: available
      ? presentPrice(
          {
            basePriceKopiykas: row.base_price_kopiykas,
            discountEndsAt: row.discount_ends_at,
            discountPriceKopiykas: row.discount_price_kopiykas,
            discountStartsAt: row.discount_starts_at,
          },
          options.asOf,
        )
      : null,
    rating: {
      average: row.rating_average === null ? null : Number(row.rating_average),
      count: row.rating_count,
    },
    reviews: {
      items: reviews.rows.map((review) => ({
        id: review.review_id,
        publishedAt: new Date(review.published_at).toISOString(),
        rating: review.rating,
        reviewerName: review.reviewer_public_name,
        text: review.review_text,
      })),
      page,
      totalItems,
      totalPages,
    },
    schemaVersion: CATALOG_READ_MODEL_SCHEMA_VERSION,
    title: row.title,
  };
}
