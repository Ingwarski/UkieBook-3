import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../db/migrate";
import { migrations } from "../db/migrations";
import { openPostgresDatabase } from "../db/postgres";
import {
  CATALOG_BOOK_FIXTURES,
  CATALOG_FEATURED_SHELF_IDS,
  CATALOG_FEATURED_TILE_IDS,
  CATALOG_GENRE_FIXTURES,
} from "../modules/catalog/fixtures";
import { CATALOG_PAGE_SIZE } from "../modules/catalog/query";
import { formatUah, presentPrice } from "../modules/catalog/price";
import type { CatalogQuery } from "../modules/catalog/types";
import {
  CATALOG_READ_MODEL_MIGRATION_ID,
  IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
  PLATFORM_FOUNDATION_MIGRATION_ID,
} from "../modules/platform/schema-revision";
import type { SqlDatabase, SqlRow } from "../modules/platform/sql-port";
import { withSqlTransaction } from "../modules/platform/sql-port";

const databaseUrl = process.env.REAL_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("REAL_DATABASE_URL is required for the UNIT-02 PostgreSQL proof");
}

const EXPECTED_DATABASE_NAME = "ukiebook_unit02";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
let parsedDatabaseUrl: URL;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error("REAL_DATABASE_URL must be a valid PostgreSQL URL");
}
const databaseName = decodeURIComponent(
  parsedDatabaseUrl.pathname.replace(/^\//u, ""),
);
if (
  parsedDatabaseUrl.search ||
  parsedDatabaseUrl.hash ||
  !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
  !LOOPBACK_HOSTS.has(parsedDatabaseUrl.hostname) ||
  databaseName !== EXPECTED_DATABASE_NAME ||
  !parsedDatabaseUrl.username ||
  !parsedDatabaseUrl.password
) {
  throw new Error(
    `REAL_DATABASE_URL must use dedicated credentials for the exact loopback database ${EXPECTED_DATABASE_NAME}`,
  );
}

const verifiedDatabaseUrl = databaseUrl;
const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR)
  : undefined;
const implementationRevision =
  process.env.APP_REVISION ?? process.env.IMPLEMENTATION_REVISION ?? "working-tree";
const FIXED_NOW = new Date("2026-07-22T10:00:00.000Z");
const AVAILABLE_BOOK_ID = "44444444-4444-4444-8444-444444444444";
const UNAVAILABLE_BOOK_ID = "77777777-7777-4777-8777-777777777777";
const EXPECTED_MIGRATION_IDS = [
  PLATFORM_FOUNDATION_MIGRATION_ID,
  IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
  CATALOG_READ_MODEL_MIGRATION_ID,
] as const;
const PRE_CATALOG_TABLES = [
  "author_payout_details",
  "author_profiles",
  "durable_jobs",
  "identity_audit_events",
  "oauth_accounts",
  "oauth_flows",
  "outbox_events",
  "sessions",
  "user_roles",
  "users",
] as const;
const CATALOG_TABLES = [
  "catalog_book_read_models",
  "catalog_featured_slots",
  "catalog_genres",
  "catalog_review_read_models",
] as const;
const ALL_APPLICATION_TABLES = [...PRE_CATALOG_TABLES, ...CATALOG_TABLES].sort();
const defaultQuery: CatalogQuery = {
  discountedOnly: false,
  genre: null,
  page: 1,
  q: null,
  sort: "featured",
};

interface DatabaseIdentity extends SqlRow {
  database_name: string;
}

interface CountRow extends SqlRow {
  count: number;
}

interface SeedSnapshot {
  readonly books: number;
  readonly digestSha256: string;
  readonly featuredSlots: number;
  readonly genres: number;
  readonly reviews: number;
}

interface ProcessResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

function redactSecrets(value: string): string {
  let redacted = value.replaceAll(verifiedDatabaseUrl, "<redacted-database-url>");
  for (const secret of [parsedDatabaseUrl.username, parsedDatabaseUrl.password]) {
    if (secret) redacted = redacted.replaceAll(secret, "<redacted>");
  }
  return redacted;
}

async function runProcess(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...arguments_], {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code: code ?? 1,
        stderr: redactSecrets(stderr),
        stdout: redactSecrets(stdout),
      });
    });
  });
}

async function runSeed(input: {
  readonly allow: boolean;
  readonly appEnv: "production" | "test";
}): Promise<ProcessResult> {
  return runProcess(
    process.execPath,
    ["--import", "tsx", "scripts/seed-unit02-catalog.ts"],
    {
      ...process.env,
      APP_ENV: input.appEnv,
      DATABASE_URL: verifiedDatabaseUrl,
      UNIT02_ALLOW_FIXTURE_SEED: input.allow ? "1" : "0",
      UNIT02_REACT_SERVER_PROOF: "1",
    },
  );
}

async function writeEvidence(relativePath: string, value: unknown): Promise<void> {
  if (!evidenceRoot) return;
  const target = path.join(evidenceRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function applicationTables(database: SqlDatabase): Promise<string[]> {
  const result = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> 'schema_migrations'
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function tableCounts(
  database: SqlDatabase,
  tables: readonly (typeof PRE_CATALOG_TABLES)[number][],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await database.query<CountRow>(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0]?.count ?? -1;
  }
  return counts;
}

async function seedSnapshot(database: SqlDatabase): Promise<SeedSnapshot> {
  const [books, genres, featuredSlots, reviews] = await Promise.all([
    database.query<SqlRow>(`
      SELECT
        book_id, title, author_public_id, author_public_name, genre_slug,
        description, sample_title, sample_blocks::text AS sample_blocks,
        cover_path, cover_theme, base_price_kopiykas, discount_price_kopiykas,
        discount_starts_at, discount_ends_at, availability, catalog_rank,
        rating_average::text AS rating_average, rating_count, published_at
      FROM catalog_book_read_models
      ORDER BY book_id
    `),
    database.query<SqlRow>(
      "SELECT slug, label FROM catalog_genres ORDER BY slug",
    ),
    database.query<SqlRow>(`
      SELECT section, position, book_id
      FROM catalog_featured_slots
      ORDER BY section, position, book_id
    `),
    database.query<SqlRow>(`
      SELECT
        review_id, book_id, reviewer_public_name, rating, review_text, published_at
      FROM catalog_review_read_models
      ORDER BY review_id
    `),
  ]);
  const canonical = JSON.stringify({
    books: books.rows,
    featuredSlots: featuredSlots.rows,
    genres: genres.rows,
    reviews: reviews.rows,
  });
  return {
    books: books.rows.length,
    digestSha256: createHash("sha256").update(canonical).digest("hex"),
    featuredSlots: featuredSlots.rows.length,
    genres: genres.rows.length,
    reviews: reviews.rows.length,
  };
}

async function proveMigrationRoundtrip(database: SqlDatabase) {
  await applyMigrations(database, migrations);
  const current = await listAppliedMigrations(database);
  assert.deepEqual(
    current.map((migration) => migration.id),
    EXPECTED_MIGRATION_IDS,
    "UNIT-02 requires the exact current migration chain",
  );
  assert.deepEqual(
    await applicationTables(database),
    ALL_APPLICATION_TABLES,
    "Refusing to mutate an unexpected table set in the dedicated UNIT-02 database",
  );

  const earlierCountsBefore = await tableCounts(database, PRE_CATALOG_TABLES);
  let catalogMigrationRestored = false;
  let roundtripError: unknown;
  try {
    const rolledBack = await rollbackLatestMigration(database, migrations);
    assert.deepEqual(rolledBack, {
      direction: "down",
      id: CATALOG_READ_MODEL_MIGRATION_ID,
    });
    assert.deepEqual(
      (await listAppliedMigrations(database)).map((migration) => migration.id),
      EXPECTED_MIGRATION_IDS.slice(0, 2),
    );
    assert.deepEqual(await applicationTables(database), [...PRE_CATALOG_TABLES].sort());
    assert.deepEqual(
      await tableCounts(database, PRE_CATALOG_TABLES),
      earlierCountsBefore,
      "Catalog rollback changed UNIT-00/UNIT-01 rows",
    );

    const reapplied = await applyMigrations(database, migrations);
    assert.deepEqual(reapplied, [
      { direction: "up", id: CATALOG_READ_MODEL_MIGRATION_ID },
    ]);
    catalogMigrationRestored = true;
  } catch (error) {
    roundtripError = error;
  } finally {
    if (!catalogMigrationRestored) {
      try {
        await applyMigrations(database, migrations);
        catalogMigrationRestored = true;
      } catch (cleanupError) {
        if (roundtripError) {
          throw new AggregateError(
            [roundtripError, cleanupError],
            "UNIT-02 catalog migration proof and restoration both failed",
          );
        }
        throw cleanupError;
      }
    }
  }
  if (roundtripError) throw roundtripError;

  assert.deepEqual(
    (await listAppliedMigrations(database)).map((migration) => migration.id),
    EXPECTED_MIGRATION_IDS,
  );
  assert.deepEqual(await applicationTables(database), ALL_APPLICATION_TABLES);
  assert.deepEqual(await tableCounts(database, PRE_CATALOG_TABLES), earlierCountsBefore);
  return {
    earlier_migration_ids_preserved: EXPECTED_MIGRATION_IDS.slice(0, 2),
    earlier_row_counts_preserved: earlierCountsBefore,
    migration_id: CATALOG_READ_MODEL_MIGRATION_ID,
    reversible_down_up: true,
  };
}

async function proveSeed(database: SqlDatabase) {
  const productionAttempt = await runSeed({ allow: true, appEnv: "production" });
  assert.notEqual(productionAttempt.code, 0, "Production fixture seeding was not refused");
  const unacknowledgedAttempt = await runSeed({ allow: false, appEnv: "test" });
  assert.notEqual(
    unacknowledgedAttempt.code,
    0,
    "Unacknowledged UNIT-02 fixture seeding was not refused",
  );

  const firstSeed = await runSeed({ allow: true, appEnv: "test" });
  assert.equal(firstSeed.code, 0, "Acknowledged UNIT-02 fixture seed failed");
  const first = await seedSnapshot(database);
  assert.deepEqual(first, {
    books: CATALOG_BOOK_FIXTURES.length,
    digestSha256: first.digestSha256,
    featuredSlots:
      CATALOG_FEATURED_SHELF_IDS.length + CATALOG_FEATURED_TILE_IDS.length,
    genres: CATALOG_GENRE_FIXTURES.length,
    reviews: 6,
  });

  const secondSeed = await runSeed({ allow: true, appEnv: "test" });
  assert.equal(secondSeed.code, 0, "Second deterministic fixture seed failed");
  const second = await seedSnapshot(database);
  assert.deepEqual(second, first, "Repeated UNIT-02 fixture seeding changed public data");
  return {
    acknowledged_seed: true,
    deterministic_digest_sha256: second.digestSha256,
    fixture_counts: {
      books: second.books,
      featured_slots: second.featuredSlots,
      genres: second.genres,
      reviews: second.reviews,
    },
    production_guard: "passed",
    explicit_acknowledgement_guard: "passed",
  };
}

async function proveDatabasePriceBoundary(database: SqlDatabase): Promise<void> {
  const types = await database.query<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_book_read_models'
      AND column_name IN ('base_price_kopiykas', 'discount_price_kopiykas')
    ORDER BY column_name
  `);
  assert.deepEqual(types.rows, [
    { column_name: "base_price_kopiykas", data_type: "integer" },
    { column_name: "discount_price_kopiykas", data_type: "integer" },
  ]);

  await assert.rejects(
    withSqlTransaction(database, async (connection) => {
      await connection.query(
        `
          INSERT INTO catalog_book_read_models (
            book_id, title, author_public_id, author_public_name, genre_slug,
            description, sample_title, sample_blocks, cover_path, cover_theme,
            base_price_kopiykas, discount_price_kopiykas, discount_starts_at,
            discount_ends_at, availability, catalog_rank
          ) VALUES (
            '88888888-8888-4888-8888-888888888888', 'Invalid discount',
            'a8888888-8888-4888-8888-888888888888', 'Boundary Proof', 'proza',
            'Boundary proof row', 'Fragment', '[]'::jsonb,
            '/books/covers/final/misto-na-vodi.png', 'cobalt',
            10000, 10000, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z',
            'published', 999
          )
        `,
      );
    }),
    /check constraint/iu,
  );
}

async function proveCatalogBehavior(database: SqlDatabase) {
  const { findBookPage, searchCatalog } = await import(
    "../modules/catalog/server/repository"
  );

  const firstPage = await searchCatalog(database, defaultQuery, FIXED_NOW);
  assert.deepEqual(firstPage.pagination, {
    page: 1,
    pageSize: CATALOG_PAGE_SIZE,
    totalItems: 6,
    totalPages: 2,
  });
  assert.deepEqual(
    firstPage.results.map((book) => book.title),
    ["Сад камʼяних птахів", "Пізнє літо", "Хроніки степу", "Місто на воді"],
  );

  const secondPage = await searchCatalog(
    database,
    { ...defaultQuery, page: 10_000 },
    FIXED_NOW,
  );
  assert.equal(secondPage.pagination.page, 2, "Out-of-range catalog page was not clamped");
  assert.deepEqual(
    secondPage.results.map((book) => book.title),
    ["Листи з Полтави", "Крижані маки"],
  );

  const titleSearch = await searchCatalog(
    database,
    { ...defaultQuery, q: "камʼяних" },
    FIXED_NOW,
  );
  assert.deepEqual(titleSearch.results.map((book) => book.id), [AVAILABLE_BOOK_ID]);
  const authorSearch = await searchCatalog(
    database,
    { ...defaultQuery, q: "Ірина Верес" },
    FIXED_NOW,
  );
  assert.deepEqual(authorSearch.results.map((book) => book.id), [AVAILABLE_BOOK_ID]);
  const genreFilter = await searchCatalog(
    database,
    { ...defaultQuery, genre: "proza" },
    FIXED_NOW,
  );
  assert.deepEqual(
    genreFilter.results.map((book) => book.title),
    ["Сад камʼяних птахів", "Місто на воді"],
  );
  const discountFilter = await searchCatalog(
    database,
    { ...defaultQuery, discountedOnly: true },
    FIXED_NOW,
  );
  assert.deepEqual(
    discountFilter.results.map((book) => book.title),
    ["Сад камʼяних птахів", "Листи з Полтави"],
  );

  const ascending = await searchCatalog(
    database,
    { ...defaultQuery, sort: "price_asc" },
    FIXED_NOW,
  );
  assert.deepEqual(
    ascending.results.map((book) => book.price.actualPriceKopiykas),
    [13_500, 15_300, 19_500, 21_000],
  );
  const descending = await searchCatalog(
    database,
    { ...defaultQuery, sort: "price_desc" },
    FIXED_NOW,
  );
  assert.deepEqual(
    descending.results.map((book) => book.price.actualPriceKopiykas),
    [26_500, 22_000, 21_000, 19_500],
  );

  const ratingConsistency = await database.query<{
    book_id: string;
    rating_average: string | null;
    rating_count: number;
    review_average: string | null;
    review_count: number;
  }>(`
    SELECT
      books.book_id,
      books.rating_average::text AS rating_average,
      books.rating_count,
      ROUND(AVG(reviews.rating)::numeric, 1)::text AS review_average,
      COUNT(reviews.review_id)::int AS review_count
    FROM catalog_book_read_models AS books
    LEFT JOIN catalog_review_read_models AS reviews
      ON reviews.book_id = books.book_id
    GROUP BY books.book_id, books.rating_average, books.rating_count
    ORDER BY books.book_id
  `);
  for (const row of ratingConsistency.rows) {
    assert.equal(
      row.rating_count,
      row.review_count,
      `Rating count drifted from public reviews for ${row.book_id}`,
    );
    assert.equal(
      row.rating_average === null ? null : Number(row.rating_average),
      row.review_average === null ? null : Number(row.review_average),
      `Rating average drifted from public reviews for ${row.book_id}`,
    );
  }

  const available = await findBookPage(database, AVAILABLE_BOOK_ID, {
    asOf: FIXED_NOW,
    reviewsPage: 2,
  });
  assert.equal(available?.availability, "available");
  assert.deepEqual(available?.reviews, {
    items: available?.reviews.items,
    page: 2,
    totalItems: 5,
    totalPages: 2,
  });
  assert.equal(available?.reviews.items.length, 2);
  assert.deepEqual(Object.keys(available?.author ?? {}).sort(), ["id", "publicName"]);

  const unavailableSearch = await searchCatalog(
    database,
    { ...defaultQuery, q: "Тіні над лиманом" },
    FIXED_NOW,
  );
  assert.equal(unavailableSearch.pagination.totalItems, 0);
  assert.ok(
    !firstPage.featuredShelf.some((book) => book.id === UNAVAILABLE_BOOK_ID) &&
      !firstPage.featuredTiles.some((book) => book.id === UNAVAILABLE_BOOK_ID),
  );
  const unavailable = await findBookPage(database, UNAVAILABLE_BOOK_ID, {
    asOf: FIXED_NOW,
    reviewsPage: 1,
  });
  assert.deepEqual(
    unavailable && {
      availability: unavailable.availability,
      freeSampleBlocks: unavailable.freeSample.blocks.length,
      price: unavailable.price,
    },
    { availability: "unavailable", freeSampleBlocks: 0, price: null },
  );

  const publicPayload = JSON.stringify({
    available,
    catalog: firstPage,
    unavailable,
  });
  assert.doesNotMatch(publicPayload, /email|oauth|password|payout|session|moderation/iu);

  const fixturePrice = CATALOG_BOOK_FIXTURES.find(
    (book) => book.id === AVAILABLE_BOOK_ID,
  );
  assert.ok(fixturePrice);
  const priceInput = {
    basePriceKopiykas: fixturePrice.basePriceKopiykas,
    discountEndsAt: fixturePrice.discountEndsAt,
    discountPriceKopiykas: fixturePrice.discountPriceKopiykas,
    discountStartsAt: fixturePrice.discountStartsAt,
  };
  assert.equal(
    presentPrice(priceInput, new Date("2025-12-31T23:59:59.999Z"))
      .actualPriceKopiykas,
    25_000,
  );
  assert.deepEqual(
    presentPrice(priceInput, new Date("2026-01-01T00:00:00.000Z")),
    {
      actualPriceKopiykas: 21_000,
      basePriceKopiykas: 25_000,
      currency: "UAH",
      discount: {
        endsAt: "2027-01-01T00:00:00.000Z",
        label: "−16%",
        startsAt: "2026-01-01T00:00:00.000Z",
      },
      formattedActualPrice: "210 грн",
      formattedBasePrice: "250 грн",
    },
  );
  assert.equal(
    presentPrice(priceInput, new Date("2027-01-01T00:00:00.000Z"))
      .actualPriceKopiykas,
    25_000,
  );
  assert.equal(formatUah(21_050), "210,50 грн");
  assert.throws(() => formatUah(21.5), /safe integer/iu);
  await proveDatabasePriceBoundary(database);

  return {
    catalog: {
      page_size: CATALOG_PAGE_SIZE,
      public_books: firstPage.pagination.totalItems,
      total_pages: firstPage.pagination.totalPages,
    },
    filters: ["author", "discount", "genre", "title"],
    money: {
      active_discount_kopiykas: 21_000,
      currency: "UAH",
      discount_end_exclusive: true,
      discount_start_inclusive: true,
      integer_kopiykas_enforced: true,
    },
    public_separation: {
      available_author_fields: Object.keys(available.author).sort(),
      unavailable_excluded_from_catalog: true,
      unavailable_page_has_no_price_or_sample: true,
    },
    rating_review_consistency: {
      books_checked: ratingConsistency.rows.length,
      status: "passed",
    },
    sort_modes: ["featured", "price_asc", "price_desc"],
  };
}

async function runProof(): Promise<void> {
  const database = openPostgresDatabase(verifiedDatabaseUrl);
  let proofError: unknown;
  let closeError: unknown;
  try {
    const identity = await database.query<DatabaseIdentity>(`
      SELECT current_database() AS database_name
    `);
    assert.equal(
      identity.rows[0]?.database_name,
      EXPECTED_DATABASE_NAME,
      `Refusing UNIT-02 proof outside ${EXPECTED_DATABASE_NAME}`,
    );
    const migrationRoundtrip = await proveMigrationRoundtrip(database);
    const seed = await proveSeed(database);
    const behavior = await proveCatalogBehavior(database);
    const proof = {
      behavior,
      implementation_revision: implementationRevision,
      migration_roundtrip: migrationRoundtrip,
      seed,
      verified_at: new Date().toISOString(),
    };
    await writeEvidence("evidence/database/unit02-postgres-proof.json", proof);
    console.log(
      JSON.stringify(
        {
          database: EXPECTED_DATABASE_NAME,
          evidence_written: Boolean(evidenceRoot),
          migrations: EXPECTED_MIGRATION_IDS,
          public_books: behavior.catalog.public_books,
          seed_digest_sha256: seed.deterministic_digest_sha256,
          status: "passed",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    proofError = error;
  }
  try {
    await database.close?.();
  } catch (error) {
    closeError = error;
  }
  if (proofError && closeError) {
    throw new AggregateError(
      [proofError, closeError],
      "UNIT-02 PostgreSQL proof and connection cleanup both failed",
    );
  }
  if (proofError) throw proofError;
  if (closeError) throw closeError;
}

async function entrypoint(): Promise<void> {
  if (process.env.UNIT02_REACT_SERVER_PROOF !== "1") {
    const child = await runProcess(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
      ],
      { ...process.env, UNIT02_REACT_SERVER_PROOF: "1" },
    );
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.code !== 0) process.exitCode = child.code;
    return;
  }
  await runProof();
}

try {
  await entrypoint();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`UNIT-02 PostgreSQL proof failed: ${redactSecrets(message)}`);
  process.exitCode = 1;
}
