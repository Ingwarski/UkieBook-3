import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  CATALOG_BOOK_FIXTURES,
  CATALOG_FEATURED_SHELF_IDS,
  CATALOG_FEATURED_TILE_IDS,
  CATALOG_GENRE_FIXTURES,
} from "../modules/catalog/fixtures";
import { withSqlTransaction } from "../modules/platform/sql-port";
import { requireDedicatedUnit02DatabaseUrl } from "./unit02-database-guard";

const databaseUrl = requireDedicatedUnit02DatabaseUrl(process.env.DATABASE_URL);
if (process.env.APP_ENV === "production") {
  throw new Error("UNIT-02 catalog fixtures cannot be seeded in production");
}
if (process.env.UNIT02_ALLOW_FIXTURE_SEED !== "1") {
  throw new Error("Set UNIT02_ALLOW_FIXTURE_SEED=1 to acknowledge fixture seeding");
}

const reviews = [
  {
    bookId: "44444444-4444-4444-8444-444444444444",
    id: "90000000-0000-4000-8000-000000000001",
    name: "Олена К.",
    publishedAt: "2026-07-18T09:20:00.000Z",
    rating: 5,
    text: "Дуже атмосферна проза. Сад відчувається живим, а фінал хочеться перечитати ще раз.",
  },
  {
    bookId: "44444444-4444-4444-8444-444444444444",
    id: "90000000-0000-4000-8000-000000000002",
    name: "Марія",
    publishedAt: "2026-07-14T16:05:00.000Z",
    rating: 5,
    text: "Тиха й точна книжка про повернення. Особливо сподобався ритм коротких розділів.",
  },
  {
    bookId: "44444444-4444-4444-8444-444444444444",
    id: "90000000-0000-4000-8000-000000000003",
    name: "Іван Ч.",
    publishedAt: "2026-07-08T11:45:00.000Z",
    rating: 4,
    text: "Образи камʼяних птахів залишаються з читачем надовго. Хотілося б трохи більше про родину героїні.",
  },
  {
    bookId: "44444444-4444-4444-8444-444444444444",
    id: "90000000-0000-4000-8000-000000000004",
    name: "Наталя",
    publishedAt: "2026-06-29T08:30:00.000Z",
    rating: 5,
    text: "Прочитала за два вечори. Дуже виразна мова й справді красивий безкоштовний фрагмент.",
  },
  {
    bookId: "44444444-4444-4444-8444-444444444444",
    id: "90000000-0000-4000-8000-000000000005",
    name: "Роман",
    publishedAt: "2026-06-20T19:10:00.000Z",
    rating: 5,
    text: "Рідкісний баланс загадки й людяності. Рекомендую для повільного читання.",
  },
  {
    bookId: "11111111-1111-4111-8111-111111111111",
    id: "90000000-0000-4000-8000-000000000006",
    name: "Дарина",
    publishedAt: "2026-07-11T12:00:00.000Z",
    rating: 5,
    text: "Степ тут не декорація, а окремий герой. Дуже переконлива родинна історія.",
  },
] as const;

const database = openPostgresDatabase(databaseUrl);
try {
  await applyMigrations(database);
  await withSqlTransaction(database, async (connection) => {
    for (const genre of CATALOG_GENRE_FIXTURES) {
      await connection.query(
        `
          INSERT INTO catalog_genres (slug, label)
          VALUES ($1, $2)
          ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label
        `,
        [genre.slug, genre.label],
      );
    }

    for (const book of CATALOG_BOOK_FIXTURES) {
      await connection.query(
        `
          INSERT INTO catalog_book_read_models (
            book_id, title, author_public_id, author_public_name, genre_slug,
            description, sample_title, sample_blocks, cover_path, cover_theme,
            base_price_kopiykas, discount_price_kopiykas, discount_starts_at,
            discount_ends_at, availability, catalog_rank, rating_average,
            rating_count, published_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            '2026-06-01T09:00:00.000Z', CURRENT_TIMESTAMP
          )
          ON CONFLICT (book_id) DO UPDATE SET
            title = EXCLUDED.title,
            author_public_id = EXCLUDED.author_public_id,
            author_public_name = EXCLUDED.author_public_name,
            genre_slug = EXCLUDED.genre_slug,
            description = EXCLUDED.description,
            sample_title = EXCLUDED.sample_title,
            sample_blocks = EXCLUDED.sample_blocks,
            cover_path = EXCLUDED.cover_path,
            cover_theme = EXCLUDED.cover_theme,
            base_price_kopiykas = EXCLUDED.base_price_kopiykas,
            discount_price_kopiykas = EXCLUDED.discount_price_kopiykas,
            discount_starts_at = EXCLUDED.discount_starts_at,
            discount_ends_at = EXCLUDED.discount_ends_at,
            availability = EXCLUDED.availability,
            catalog_rank = EXCLUDED.catalog_rank,
            rating_average = EXCLUDED.rating_average,
            rating_count = EXCLUDED.rating_count,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          book.id,
          book.title,
          book.authorId,
          book.authorName,
          book.genreSlug,
          book.description,
          book.sampleTitle,
          JSON.stringify(book.sampleBlocks),
          book.coverPath,
          book.coverTheme,
          book.basePriceKopiykas,
          book.discountPriceKopiykas,
          book.discountStartsAt,
          book.discountEndsAt,
          book.availability,
          book.catalogRank,
          book.ratingAverage,
          book.ratingCount,
        ],
      );
    }

    for (const [section, ids] of [
      ["shelf", CATALOG_FEATURED_SHELF_IDS],
      ["tile", CATALOG_FEATURED_TILE_IDS],
    ] as const) {
      await connection.query("DELETE FROM catalog_featured_slots WHERE section = $1", [
        section,
      ]);
      for (const [index, id] of ids.entries()) {
        await connection.query(
          `
            INSERT INTO catalog_featured_slots (section, position, book_id)
            VALUES ($1, $2, $3)
          `,
          [section, index + 1, id],
        );
      }
    }

    for (const review of reviews) {
      await connection.query(
        `
          INSERT INTO catalog_review_read_models (
            review_id, book_id, reviewer_public_name, rating, review_text, published_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (review_id) DO UPDATE SET
            reviewer_public_name = EXCLUDED.reviewer_public_name,
            rating = EXCLUDED.rating,
            review_text = EXCLUDED.review_text,
            published_at = EXCLUDED.published_at
        `,
        [
          review.id,
          review.bookId,
          review.name,
          review.rating,
          review.text,
          review.publishedAt,
        ],
      );
    }
  });
  console.log(
    `Seeded ${CATALOG_BOOK_FIXTURES.length} catalog books and ${reviews.length} reviews.`,
  );
} finally {
  await database.close?.();
}
