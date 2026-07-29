import { openPostgresDatabase } from "../db/postgres";
import {
  CATALOG_BOOK_FIXTURES,
  CATALOG_FEATURED_SHELF_IDS,
  CATALOG_FEATURED_TILE_IDS,
} from "../modules/catalog/fixtures";
import { UNIT06_FIXTURE_IDS } from "../tests/fixtures/library/unit06-fixtures";
import { seedCatalogFixtures } from "./seed-unit02-catalog";
import { requireDedicatedUnit06DatabaseUrl } from "./unit06-database-guard";

if (process.env.APP_ENV !== "test") {
  throw new Error("Local preview fixtures require APP_ENV=test");
}
if (process.env.LOCAL_PREVIEW_ALLOW_FIXTURE_SEED !== "1") {
  throw new Error(
    "Set LOCAL_PREVIEW_ALLOW_FIXTURE_SEED=1 to acknowledge local preview fixture seeding",
  );
}

const database = openPostgresDatabase(
  requireDedicatedUnit06DatabaseUrl(process.env.UNIT06_DATABASE_URL),
);

try {
  const catalogSeed = await seedCatalogFixtures(database);
  const expectedPublishedBooks =
    CATALOG_BOOK_FIXTURES.filter(
      ({ availability }) => availability === "published",
    ).length + 1;

  const dataset = await database.query<{
    catalog_books: number;
    entitlements: number;
    featured_shelf: number;
    featured_tiles: number;
    published_books: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::integer FROM catalog_book_read_models) AS catalog_books,
        (
          SELECT COUNT(*)::integer
          FROM catalog_book_read_models
          WHERE availability = 'published'
        ) AS published_books,
        (
          SELECT COUNT(*)::integer
          FROM catalog_featured_slots
          WHERE section = 'shelf'
        ) AS featured_shelf,
        (
          SELECT COUNT(*)::integer
          FROM catalog_featured_slots
          WHERE section = 'tile'
        ) AS featured_tiles,
        (
          SELECT COUNT(*)::integer
          FROM library_entitlements
          WHERE book_id = $1
        ) AS entitlements
    `,
    [UNIT06_FIXTURE_IDS.bookId],
  );
  const snapshot = dataset.rows[0];
  const expected = {
    catalog_books: CATALOG_BOOK_FIXTURES.length + 1,
    entitlements: 1,
    featured_shelf: CATALOG_FEATURED_SHELF_IDS.length,
    featured_tiles: CATALOG_FEATURED_TILE_IDS.length,
    published_books: expectedPublishedBooks,
  };

  if (
    !snapshot ||
    Object.entries(expected).some(
      ([key, value]) =>
        snapshot[key as keyof typeof snapshot] !== value,
    )
  ) {
    throw new Error(
      `Combined local preview dataset is incomplete: ${JSON.stringify({
        expected,
        received: snapshot ?? null,
      })}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      catalog_seed: catalogSeed,
      dataset: snapshot,
      status: "ready",
    })}\n`,
  );
} finally {
  await database.close?.();
}
