import { createHash } from "node:crypto";

import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import { withSqlTransaction, type SqlExecutor } from "../modules/platform/sql-port";
import {
  UNIT05_FIXTURE_BOOKS,
  UNIT05_FIXTURE_IDS,
} from "../tests/fixtures/commerce/unit05-fixtures";
import { requireDedicatedUnit05DatabaseUrl } from "./unit05-database-guard";

if (process.env.APP_ENV === "production") {
  throw new Error("UNIT-05 browser fixtures cannot be seeded in production");
}
if (process.env.UNIT05_ALLOW_FIXTURE_SEED !== "1") {
  throw new Error("Set UNIT05_ALLOW_FIXTURE_SEED=1 to acknowledge fixture seeding");
}

const databaseUrl = requireDedicatedUnit05DatabaseUrl(
  process.env.UNIT05_DATABASE_URL,
);
const database = openPostgresDatabase(databaseUrl);
type FixtureName = keyof typeof UNIT05_FIXTURE_IDS.books;
const fixtureNames = [
  "discounted",
  "fullPrice",
  "unavailable",
] as const satisfies readonly FixtureName[];
const objectKinds = [
  ["manuscript", "text/plain; charset=utf-8"],
  ["cover", "image/png"],
  ["preview", "application/json"],
  ["epub", "application/epub+zip"],
  ["mobi", "application/x-mobipocket-ebook"],
] as const;

function objectId(bookIndex: number, objectIndex: number): string {
  return `50505050-5050-4050-8050-${String(505050506000 + bookIndex * 10 + objectIndex).padStart(12, "0")}`;
}

function lifecycleId(bookIndex: number, offset: number): string {
  return `50505050-5050-4050-8050-${String(505050507000 + bookIndex * 10 + offset).padStart(12, "0")}`;
}

async function seedBook(
  executor: SqlExecutor,
  name: FixtureName,
  index: number,
): Promise<void> {
  const fixture = UNIT05_FIXTURE_BOOKS[name];
  const bookId = UNIT05_FIXTURE_IDS.books[name];
  const versionId = UNIT05_FIXTURE_IDS.versions[name];
  const objects: string[] = [];

  for (const [objectIndex, [kind, mediaType]] of objectKinds.entries()) {
    const id = objectId(index, objectIndex + 1);
    const bytes = Buffer.from(`UNIT-05 ${name} ${kind}`);
    objects.push(id);
    await executor.query(
      `
        INSERT INTO publishing_private_objects (
          id, owner_user_id, object_kind, storage_key, sha256, byte_length,
          media_type, original_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        id,
        UNIT05_FIXTURE_IDS.authorUserId,
        kind,
        `unit05/${name}/${kind}`,
        createHash("sha256").update(bytes).digest("hex"),
        bytes.byteLength,
        mediaType,
        `${name}.${kind}`,
      ],
    );
  }

  await executor.query(
    `
      INSERT INTO publishing_books (id, author_id, title, status)
      VALUES ($1, $2, $3, $4)
    `,
    [
      bookId,
      UNIT05_FIXTURE_IDS.authorUserId,
      fixture.title,
      name === "unavailable" ? "unavailable" : "published",
    ],
  );

  await executor.query(
    `
      INSERT INTO publishing_book_versions (
        id, book_id, version_number, author_id, manuscript_object_id,
        cover_object_id, preview_object_id, epub_object_id, mobi_object_id,
        title, description, genre_slug, base_price_kopiykas,
        sample_section_index, status
      ) VALUES (
        $1, $2, 1, $3, $4, $5, $6, $7, $8,
        $9, $10, 'proza', $11, 0, 'submitted'
      )
    `,
    [
      versionId,
      bookId,
      UNIT05_FIXTURE_IDS.authorUserId,
      objects[0],
      objects[1],
      objects[2],
      objects[3],
      objects[4],
      fixture.title,
      `Тестовий опис книжки «${fixture.title}» для UNIT-05.`,
      fixture.basePriceKopiykas,
    ],
  );

  let projectionEventId: string | null = null;
  if (name !== "unavailable") {
    const submissionEventId = lifecycleId(index, 1);
    const moderationCaseId = lifecycleId(index, 2);
    projectionEventId = lifecycleId(index, 3);
    await executor.query(
      `
        INSERT INTO outbox_events (
          id, topic, event_type, event_version, aggregate_type, aggregate_id,
          payload, idempotency_key, correlation_id, occurred_at, published_at,
          publish_attempts
        ) VALUES (
          $1, 'book.submitted.v1', 'BookSubmitted', 1, 'Book', $2,
          $3::jsonb, $4, $2, $5, $5, 1
        )
      `,
      [
        submissionEventId,
        bookId,
        JSON.stringify({
          authorId: UNIT05_FIXTURE_IDS.authorUserId,
          bookId,
          bookVersionId: versionId,
          versionNumber: 1,
        }),
        `unit05-fixture-submitted:${bookId}`,
        new Date("2026-07-01T09:00:00.000Z"),
      ],
    );
    await executor.query(
      `
        INSERT INTO moderation_cases (
          id, subject_type, subject_id, subject_version_id, trigger_type,
          source_event_id, idempotency_key, status, created_at, updated_at
        ) VALUES (
          $1, 'book', $2, $3, 'submission', $4, $5, 'approved', $6, $6
        )
      `,
      [
        moderationCaseId,
        bookId,
        versionId,
        submissionEventId,
        `unit05-fixture-moderation:${bookId}`,
        new Date("2026-07-01T09:30:00.000Z"),
      ],
    );
    await executor.query(
      `
        INSERT INTO moderation_book_subjects (
          case_id, book_id, book_version_id
        ) VALUES ($1, $2, $3)
      `,
      [moderationCaseId, bookId, versionId],
    );
    await executor.query(
      `
        INSERT INTO book_publications (
          book_id, active_book_version_id, state, activation_case_id,
          revision, activated_at, updated_at
        ) VALUES ($1, $2, 'published', $3, 1, $4, $4)
      `,
      [
        bookId,
        versionId,
        moderationCaseId,
        new Date("2026-07-01T10:00:00.000Z"),
      ],
    );
    await executor.query(
      `
        INSERT INTO outbox_events (
          id, topic, event_type, event_version, aggregate_type, aggregate_id,
          payload, idempotency_key, correlation_id, occurred_at, published_at,
          publish_attempts
        ) VALUES (
          $1, 'catalog.book-published.v1', 'BookPublished', 1, 'Book', $2,
          $3::jsonb, $4, $2, $5, $5, 1
        )
      `,
      [
        projectionEventId,
        bookId,
        JSON.stringify({ bookId, bookVersionId: versionId }),
        `unit05-fixture-published:${bookId}`,
        new Date("2026-07-01T10:00:00.000Z"),
      ],
    );
    await executor.query(
      `
        INSERT INTO publication_audit_events (
          id, book_id, book_version_id, case_id, event_type, actor_type,
          idempotency_key, created_at
        ) VALUES ($1, $2, $3, $4, 'activated', 'system', $5, $6)
      `,
      [
        lifecycleId(index, 4),
        bookId,
        versionId,
        moderationCaseId,
        `unit05-fixture-activated:${bookId}`,
        new Date("2026-07-01T10:00:00.000Z"),
      ],
    );
  }

  await executor.query(
    `
      INSERT INTO catalog_book_read_models (
        book_id, title, author_public_id, author_public_name, genre_slug,
        description, sample_title, sample_blocks, cover_path, cover_theme,
        base_price_kopiykas, discount_price_kopiykas, discount_starts_at,
        discount_ends_at, availability, catalog_rank, rating_count,
        published_at, updated_at, source_book_version_id, source_event_id,
        projection_revision
      ) VALUES (
        $1, $2, $3, $4, 'proza', $5, 'Розділ перший', $6::jsonb,
        $7, $8, $9, $10, $11, $12, $13, $14, 0, $15, $15, $16, $17, $18
      )
    `,
    [
      bookId,
      fixture.title,
      UNIT05_FIXTURE_IDS.authorUserId,
      fixture.author,
      `Тестовий опис книжки «${fixture.title}» для кошика.`,
      JSON.stringify([
        {
          kind: "paragraph",
          text: `Фрагмент книжки «${fixture.title}».`,
        },
      ]),
      fixture.coverPath,
      index === 1 ? "coral" : index === 2 ? "cobalt" : "violet",
      fixture.basePriceKopiykas,
      name === "discounted" ? fixture.actualPriceKopiykas : null,
      name === "discounted"
        ? new Date("2026-01-01T00:00:00.000Z")
        : null,
      name === "discounted"
        ? new Date("2030-01-01T00:00:00.000Z")
        : null,
      name === "unavailable" ? "unavailable" : "published",
      100 + index,
      new Date("2026-07-01T10:00:00.000Z"),
      name === "unavailable" ? null : versionId,
      projectionEventId,
      name === "unavailable" ? null : 1,
    ],
  );
}

try {
  await applyMigrations(database);
  await withSqlTransaction(database, async (connection) => {
    await connection.query(
      `
        INSERT INTO catalog_genres (slug, label) VALUES
          ('proza', 'Проза'),
          ('fantastyka', 'Фантастика'),
          ('dityacha', 'Дитяча література'),
          ('eseistyka', 'Есеїстика')
        ON CONFLICT (slug) DO NOTHING
      `,
    );
    await connection.query(
      `
        INSERT INTO users (
          id, private_email, private_email_verified, private_display_name
        ) VALUES
          ($1, 'author-unit05@example.invalid', TRUE, 'Олена Вітрова'),
          ($2, 'private-google@simulator.test', TRUE, 'Google Private Simulator')
      `,
      [UNIT05_FIXTURE_IDS.authorUserId, UNIT05_FIXTURE_IDS.buyerUserId],
    );
    await connection.query(
      `
        INSERT INTO oauth_accounts (
          id, user_id, provider, provider_subject, provider_email,
          provider_email_verified, provider_display_name
        ) VALUES (
          '50505050-5050-4050-8050-505050505010',
          $1,
          'google',
          'google-simulated-subject',
          'private-google@simulator.test',
          TRUE,
          'Google Private Simulator'
        )
      `,
      [UNIT05_FIXTURE_IDS.buyerUserId],
    );
    await connection.query(
      `
        INSERT INTO user_roles (user_id, role) VALUES
          ($1, 'buyer'),
          ($2, 'buyer'),
          ($2, 'author')
      `,
      [UNIT05_FIXTURE_IDS.buyerUserId, UNIT05_FIXTURE_IDS.authorUserId],
    );
    await connection.query(
      `
        INSERT INTO author_profiles (user_id, public_name)
        VALUES ($1, 'Олена Вітрова')
      `,
      [UNIT05_FIXTURE_IDS.authorUserId],
    );

    for (const [index, name] of fixtureNames.entries()) {
      await seedBook(connection, name, index + 1);
    }
  });
  process.stdout.write(
    `${JSON.stringify({
      books: fixtureNames.length,
      buyer: UNIT05_FIXTURE_IDS.buyerUserId,
      status: "passed",
    })}\n`,
  );
} finally {
  await database.close?.();
}
