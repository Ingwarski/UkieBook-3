import { readFile } from "node:fs/promises";
import path from "node:path";

import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import { withSqlTransaction, type SqlExecutor } from "../modules/platform/sql-port";
import { LocalPrivateObjectStorage } from "../modules/publishing/storage/private-object-storage";
import type { PublishingPrivateObjectKind } from "../modules/publishing/types";
import {
  UNIT04_FIXTURE_IDS,
  UNIT04_FIXTURE_TITLES,
} from "../tests/fixtures/moderation/unit04-fixtures";
import { requireDedicatedUnit04DatabaseUrl } from "./unit04-database-guard";

if (process.env.APP_ENV === "production") {
  throw new Error("UNIT-04 browser fixtures cannot be seeded in production");
}
if (process.env.UNIT04_ALLOW_FIXTURE_SEED !== "1") {
  throw new Error("Set UNIT04_ALLOW_FIXTURE_SEED=1 to acknowledge fixture seeding");
}

const databaseUrl = requireDedicatedUnit04DatabaseUrl(
  process.env.UNIT04_DATABASE_URL,
);
const storageRoot = path.resolve(
  process.env.UNIT04_PRIVATE_OBJECT_ROOT ??
    process.env.PRIVATE_OBJECT_ROOT ??
    ".data/unit04-e2e-private",
);
const storage = new LocalPrivateObjectStorage(storageRoot);
const database = openPostgresDatabase(databaseUrl);

type FixtureName = keyof typeof UNIT04_FIXTURE_IDS.books;

const fixtureNames = [
  "submitted",
  "manual",
  "rejected",
  "published",
  "removed",
  "update",
  "review",
  "providerError",
] as const satisfies readonly FixtureName[];

const coverFiles: Readonly<Record<FixtureName, string>> = {
  manual: "misto-na-vodi.png",
  providerError: "khroniky-stepu.png",
  published: "piznie-lito.png",
  rejected: "tini-nad-lymanom.png",
  removed: "kryzhani-maky.png",
  review: "sad-kamianykh-ptakhiv.png",
  submitted: "lysty-z-poltavy.png",
  update: "piznie-lito.png",
};

const bookStatuses: Readonly<Record<FixtureName, string>> = {
  manual: "manual_review",
  providerError: "manual_review",
  published: "published",
  rejected: "rejected",
  removed: "unavailable",
  review: "manual_review",
  submitted: "submitted",
  update: "manual_review",
};

const mediaTypes: Readonly<
  Record<PublishingPrivateObjectKind, { readonly extension: string; readonly mediaType: string }>
> = {
  cover: { extension: "png", mediaType: "image/png" },
  epub: { extension: "epub", mediaType: "application/epub+zip" },
  illustration: { extension: "png", mediaType: "image/png" },
  manuscript: { extension: "txt", mediaType: "text/plain; charset=utf-8" },
  mobi: { extension: "mobi", mediaType: "application/x-mobipocket-ebook" },
  normalized: { extension: "json", mediaType: "application/json" },
  preview: { extension: "json", mediaType: "application/json" },
};

function fixtureUuid(group: number, index: number): string {
  return `40404040-4040-4040-8040-${String(group * 100 + index).padStart(12, "0")}`;
}

function sourceEventId(index: number): string {
  return fixtureUuid(70, index);
}

function activationCaseId(index: number): string {
  return fixtureUuid(60, index);
}

function objectId(bookIndex: number, kindIndex: number): string {
  return fixtureUuid(40 + bookIndex, kindIndex);
}

async function insertOutboxEvent(
  executor: SqlExecutor,
  input: {
    readonly id: string;
    readonly eventType: string;
    readonly bookId: string;
    readonly bookVersionId: string;
    readonly authorId?: string;
    readonly published?: boolean;
  },
): Promise<void> {
  const payload = input.eventType === "BookSubmitted"
    ? {
        authorId: input.authorId ?? UNIT04_FIXTURE_IDS.authorUserId,
        bookId: input.bookId,
        bookVersionId: input.bookVersionId,
        versionNumber: 1,
      }
    : {
        bookId: input.bookId,
        bookVersionId: input.bookVersionId,
      };
  await executor.query(
    `
      INSERT INTO outbox_events (
        id, topic, event_type, event_version, aggregate_type, aggregate_id,
        payload, idempotency_key, correlation_id, occurred_at, published_at,
        publish_attempts
      ) VALUES (
        $1, $2, $3, 1, 'Book', $4, $5::jsonb, $6, $7,
        CURRENT_TIMESTAMP, $8, $9
      )
    `,
    [
      input.id,
      `unit04.fixture.${input.eventType.toLocaleLowerCase("en-US")}.v1`,
      input.eventType,
      input.bookId,
      JSON.stringify(payload),
      `unit04-fixture-event:${input.id}`,
      input.bookId,
      input.published === false ? null : new Date("2026-07-01T10:00:00.000Z"),
      input.published === false ? 0 : 1,
    ],
  );
}

async function insertPrivateObject(
  executor: SqlExecutor,
  input: {
    readonly bytes: Buffer;
    readonly id: string;
    readonly kind: "manuscript" | "cover" | "preview" | "epub" | "mobi";
    readonly originalName: string;
  },
): Promise<void> {
  const media = mediaTypes[input.kind];
  const stored = await storage.putImmutable({
    bytes: input.bytes,
    extension: media.extension,
    kind: input.kind,
    ownerUserId: UNIT04_FIXTURE_IDS.authorUserId,
  });
  await executor.query(
    `
      INSERT INTO publishing_private_objects (
        id, owner_user_id, object_kind, storage_key, sha256, byte_length,
        media_type, original_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      input.id,
      UNIT04_FIXTURE_IDS.authorUserId,
      input.kind,
      stored.storageKey,
      stored.sha256,
      stored.byteLength,
      media.mediaType,
      input.originalName,
    ],
  );
}

async function seedBookArtifactsAndVersion(
  executor: SqlExecutor,
  name: FixtureName,
  index: number,
): Promise<void> {
  const bookId = UNIT04_FIXTURE_IDS.books[name];
  const versionId = UNIT04_FIXTURE_IDS.versions[name];
  const title = UNIT04_FIXTURE_TITLES[name];
  const coverBytes = await readFile(
    path.resolve("public/books/covers/final", coverFiles[name]),
  );
  const preview = Buffer.from(
    JSON.stringify({
      authorPublicName: "Олена Вітрова",
      schemaVersion: 1,
      sections: [
        {
          blocks: [
            {
              kind: "paragraph",
              text: `Уривок із книжки «${title}». Тиша лягла на місто, а ранкове світло вже торкалося води.`,
            },
            {
              kind: "paragraph",
              text: "Це стабільний тестовий фрагмент для перевірки модерації та публікації.",
            },
          ],
          heading: "Розділ перший",
        },
      ],
      title,
    }),
  );
  const ids = {
    cover: objectId(index, 2),
    epub: objectId(index, 4),
    manuscript: objectId(index, 1),
    mobi: objectId(index, 5),
    preview: objectId(index, 3),
  };
  await insertPrivateObject(executor, {
    bytes: Buffer.from(`# ${title}\n\nТестовий рукопис UNIT-04 №${index}.`),
    id: ids.manuscript,
    kind: "manuscript",
    originalName: `${name}.txt`,
  });
  await insertPrivateObject(executor, {
    bytes: Buffer.concat([coverBytes, Buffer.from(`\nunit04-${name}`)]),
    id: ids.cover,
    kind: "cover",
    originalName: `${name}.png`,
  });
  await insertPrivateObject(executor, {
    bytes: preview,
    id: ids.preview,
    kind: "preview",
    originalName: `${name}-preview.json`,
  });
  await insertPrivateObject(executor, {
    bytes: Buffer.from(`UNIT04 EPUB fixture ${name}`),
    id: ids.epub,
    kind: "epub",
    originalName: `${name}.epub`,
  });
  await insertPrivateObject(executor, {
    bytes: Buffer.from(`UNIT04 MOBI fixture ${name}`),
    id: ids.mobi,
    kind: "mobi",
    originalName: `${name}.mobi`,
  });
  await executor.query(
    `
      INSERT INTO publishing_books (
        id, author_id, title, status, rejection_category,
        rejection_reason_code, rejection_reason_copy_version,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    `,
    [
      bookId,
      UNIT04_FIXTURE_IDS.authorUserId,
      title,
      bookStatuses[name],
      name === "rejected"
        ? "Невідповідність вимогам платформи"
        : null,
      name === "rejected"
        ? "platform_requirements"
        : null,
      name === "rejected" ? 1 : null,
      new Date(`2026-07-${String(index).padStart(2, "0")}T09:00:00.000Z`),
    ],
  );
  await executor.query(
    `
      INSERT INTO publishing_book_versions (
        id, book_id, version_number, author_id, manuscript_object_id,
        cover_object_id, preview_object_id, epub_object_id, mobi_object_id,
        title, description, genre_slug, base_price_kopiykas,
        sample_section_index, status, submitted_at
      ) VALUES (
        $1, $2, 1, $3, $4, $5, $6, $7, $8,
        $9, $10, 'proza', $11, 0, 'submitted', $12
      )
    `,
    [
      versionId,
      bookId,
      UNIT04_FIXTURE_IDS.authorUserId,
      ids.manuscript,
      ids.cover,
      ids.preview,
      ids.epub,
      ids.mobi,
      title,
      `Реалістичний тестовий опис книжки «${title}» для перевірки життєвого циклу публікації.`,
      15_900 + index * 1_000,
      new Date(`2026-07-${String(index).padStart(2, "0")}T10:00:00.000Z`),
    ],
  );
}

async function seedPendingCase(
  executor: SqlExecutor,
  input: {
    readonly caseId: string;
    readonly name: FixtureName;
    readonly index: number;
    readonly providerError?: boolean;
    readonly subjectType: "book" | "book_update" | "review";
    readonly triggerType?: "submission" | "post_publication_risk";
  },
): Promise<void> {
  const triggerType = input.triggerType ?? "submission";
  const eventId = triggerType === "submission" ? sourceEventId(input.index) : null;
  const bookId = UNIT04_FIXTURE_IDS.books[input.name];
  const versionId = UNIT04_FIXTURE_IDS.versions[input.name];
  if (eventId) {
    await insertOutboxEvent(executor, {
      authorId: UNIT04_FIXTURE_IDS.authorUserId,
      bookId,
      bookVersionId: versionId,
      eventType: "BookSubmitted",
      id: eventId,
    });
  }
  await executor.query(
    `
      INSERT INTO moderation_cases (
        id, subject_type, subject_id, subject_version_id, trigger_type,
        source_event_id, idempotency_key, status, revision, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual_review_pending', 2, $8, $8)
    `,
    [
      input.caseId,
      input.subjectType,
      bookId,
      versionId,
      triggerType,
      eventId,
      `unit04-fixture-case:${input.caseId}`,
      new Date(`2026-07-${String(10 + input.index).padStart(2, "0")}T10:00:00.000Z`),
    ],
  );
  await executor.query(
    `
      INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id)
      VALUES ($1, $2, $3)
    `,
    [input.caseId, bookId, versionId],
  );
  await executor.query(
    `
      INSERT INTO moderation_screening_runs (
        id, case_id, attempt, adapter_id, policy_version, result,
        internal_signals, provider_request_id, failure_code, created_at, completed_at
      ) VALUES ($1, $2, 1, $3, 1, $4, $5::jsonb, $6, $7, $8, $8)
    `,
    [
      fixtureUuid(80, input.index),
      input.caseId,
      input.providerError ? "unavailable-safe-fail-v1" : "deterministic-fixture-v1",
      input.providerError ? "provider_error" : "flagged",
      JSON.stringify(
        input.providerError
          ? [
              {
                code: "provider_unavailable",
                label: "Сервіс ШІ недоступний — потрібна ручна перевірка",
                severity: "warning",
              },
            ]
          : [
              {
                code: `unit04_signal_${input.index}`,
                label: input.triggerType === "post_publication_risk"
                  ? "Надійшов структурований сигнал після публікації"
                  : "Потрібна уважна ручна перевірка",
                severity: input.triggerType === "post_publication_risk" ? "critical" : "warning",
              },
            ],
      ),
      input.providerError ? null : `fixture-request-${input.index}`,
      input.providerError ? "PROVIDER_UNAVAILABLE" : null,
      new Date(`2026-07-${String(10 + input.index).padStart(2, "0")}T10:01:00.000Z`),
    ],
  );
}

async function seedActivation(
  executor: SqlExecutor,
  name: "published" | "removed",
  index: number,
): Promise<void> {
  const bookId = UNIT04_FIXTURE_IDS.books[name];
  const versionId = UNIT04_FIXTURE_IDS.versions[name];
  const eventId = sourceEventId(20 + index);
  const caseId = activationCaseId(index);
  await insertOutboxEvent(executor, {
    bookId,
    bookVersionId: versionId,
    eventType: "PublicationActivated",
    id: eventId,
  });
  await executor.query(
    `
      INSERT INTO moderation_cases (
        id, subject_type, subject_id, subject_version_id, trigger_type,
        idempotency_key, status, revision
      ) VALUES ($1, 'book', $2, $3, 'post_publication_risk', $4, 'approved', 2)
    `,
    [caseId, bookId, versionId, `unit04-fixture-activation:${caseId}`],
  );
  await executor.query(
    "INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id) VALUES ($1, $2, $3)",
    [caseId, bookId, versionId],
  );

  let removalDecisionId: string | null = null;
  let projectionEventId = eventId;
  if (name === "removed") {
    const removalCaseId = fixtureUuid(61, index);
    const removalEventId = sourceEventId(30 + index);
    removalDecisionId = fixtureUuid(62, index);
    await executor.query(
      `
        INSERT INTO moderation_cases (
          id, subject_type, subject_id, subject_version_id, trigger_type,
          idempotency_key, status, revision
        ) VALUES ($1, 'book', $2, $3, 'post_publication_risk', $4, 'removed', 2)
      `,
      [removalCaseId, bookId, versionId, `unit04-fixture-removal:${removalCaseId}`],
    );
    await executor.query(
      "INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id) VALUES ($1, $2, $3)",
      [removalCaseId, bookId, versionId],
    );
    await executor.query(
      `
        INSERT INTO moderation_decisions (
          id, case_id, manager_user_id, action, removal_ground,
          case_revision, idempotency_key
        ) VALUES ($1, $2, $3, 'remove_publication',
                  'platform_rules_violation', 1, $4)
      `,
      [
        removalDecisionId,
        removalCaseId,
        UNIT04_FIXTURE_IDS.managerUserId,
        `unit04-fixture-decision:${removalDecisionId}`,
      ],
    );
    await insertOutboxEvent(executor, {
      bookId,
      bookVersionId: versionId,
      eventType: "PublicationRemoved",
      id: removalEventId,
    });
    await executor.query(
      `
        INSERT INTO publication_audit_events (
          id, book_id, book_version_id, case_id, decision_id, event_type,
          actor_type, actor_user_id, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, 'removed', 'manager', $6, $7)
      `,
      [
        fixtureUuid(63, index),
        bookId,
        versionId,
        removalCaseId,
        removalDecisionId,
        UNIT04_FIXTURE_IDS.managerUserId,
        `unit04-fixture-audit-removed:${bookId}`,
      ],
    );
    projectionEventId = removalEventId;
  }

  await executor.query(
    `
      INSERT INTO book_publications (
        book_id, active_book_version_id, state, activation_case_id,
        removal_decision_id, revision, activated_at, removed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      bookId,
      versionId,
      name === "published" ? "published" : "unavailable",
      caseId,
      removalDecisionId,
      name === "published" ? 1 : 2,
      new Date("2026-07-04T10:00:00.000Z"),
      name === "removed" ? new Date("2026-07-05T10:00:00.000Z") : null,
      new Date(name === "published" ? "2026-07-04T10:00:00.000Z" : "2026-07-05T10:00:00.000Z"),
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
      fixtureUuid(64, index),
      bookId,
      versionId,
      caseId,
      `unit04-fixture-audit-activated:${bookId}`,
      new Date("2026-07-04T10:00:00.000Z"),
    ],
  );
  await executor.query(
    `
      INSERT INTO catalog_book_read_models (
        book_id, title, author_public_id, author_public_name, genre_slug,
        description, sample_title, sample_blocks, cover_path, cover_theme,
        base_price_kopiykas, availability, catalog_rank, rating_count,
        published_at, updated_at, source_book_version_id, source_event_id,
        projection_revision
      ) VALUES (
        $1, $2, $3, 'Олена Вітрова', 'proza', $4, 'Розділ перший',
        $5::jsonb, $6, 'violet', 19900, $7, $8, 0, $9, $10, $11, $12, $13
      )
    `,
    [
      bookId,
      UNIT04_FIXTURE_TITLES[name],
      UNIT04_FIXTURE_IDS.authorUserId,
      `Реалістичний опис книжки «${UNIT04_FIXTURE_TITLES[name]}».`,
      JSON.stringify([
        { kind: "paragraph", text: "Тиша лягла на місто, а світло вже торкалося води." },
      ]),
      `/books/covers/${bookId}`,
      name === "published" ? "published" : "unavailable",
      90 + index,
      new Date("2026-07-04T10:00:00.000Z"),
      new Date(name === "published" ? "2026-07-04T10:00:00.000Z" : "2026-07-05T10:00:00.000Z"),
      versionId,
      projectionEventId,
      name === "published" ? 1 : 2,
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
        INSERT INTO users (id, private_email, private_email_verified, private_display_name)
        VALUES
          ($1, 'author-unit04@example.invalid', TRUE, 'Олена Вітрова'),
          ($2, 'manager-unit04@example.invalid', TRUE, 'Марія Модераторка')
      `,
      [UNIT04_FIXTURE_IDS.authorUserId, UNIT04_FIXTURE_IDS.managerUserId],
    );
    await connection.query(
      `
        INSERT INTO oauth_accounts (
          id, user_id, provider, provider_subject, provider_email,
          provider_email_verified, provider_display_name
        ) VALUES
          ($1, $2, 'facebook', 'facebook-simulated-subject',
           'author-unit04@example.invalid', TRUE, 'Олена Вітрова'),
          ($3, $4, 'google', 'google-simulated-subject',
           'manager-unit04@example.invalid', TRUE, 'Марія Модераторка')
      `,
      [
        fixtureUuid(10, 1),
        UNIT04_FIXTURE_IDS.authorUserId,
        fixtureUuid(10, 2),
        UNIT04_FIXTURE_IDS.managerUserId,
      ],
    );
    await connection.query(
      `
        INSERT INTO user_roles (user_id, role) VALUES
          ($1, 'buyer'), ($1, 'author'), ($2, 'manager')
      `,
      [UNIT04_FIXTURE_IDS.authorUserId, UNIT04_FIXTURE_IDS.managerUserId],
    );
    await connection.query(
      "INSERT INTO author_profiles (user_id, public_name) VALUES ($1, 'Олена Вітрова')",
      [UNIT04_FIXTURE_IDS.authorUserId],
    );

    for (const [index, name] of fixtureNames.entries()) {
      await seedBookArtifactsAndVersion(connection, name, index + 1);
    }
    await seedActivation(connection, "published", 1);
    await seedActivation(connection, "removed", 2);
    await seedPendingCase(connection, {
      caseId: UNIT04_FIXTURE_IDS.cases.manual,
      index: 1,
      name: "manual",
      subjectType: "book",
    });
    await seedPendingCase(connection, {
      caseId: UNIT04_FIXTURE_IDS.cases.update,
      index: 2,
      name: "update",
      subjectType: "book_update",
    });
    await seedPendingCase(connection, {
      caseId: UNIT04_FIXTURE_IDS.cases.review,
      index: 3,
      name: "review",
      subjectType: "review",
    });
    await seedPendingCase(connection, {
      caseId: UNIT04_FIXTURE_IDS.cases.providerError,
      index: 4,
      name: "providerError",
      providerError: true,
      subjectType: "book",
    });
    await seedPendingCase(connection, {
      caseId: UNIT04_FIXTURE_IDS.cases.removal,
      index: 5,
      name: "published",
      subjectType: "book",
      triggerType: "post_publication_risk",
    });
  });
  process.stdout.write(
    `${JSON.stringify({
      books: fixtureNames.length,
      manager_cases: Object.keys(UNIT04_FIXTURE_IDS.cases).length,
      status: "passed",
    })}\n`,
  );
} finally {
  await database.close?.();
}
