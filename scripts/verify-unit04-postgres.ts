import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  DeterministicFakeAiModerationAdapter,
  UnavailableAiModerationAdapter,
} from "../modules/moderation/adapter";
import {
  approveModerationCase,
  createPostPublicationRiskCase,
  createRelatedModerationCase,
  doNotPublishReviewModerationCase,
  loadAuthorBookManagement,
  relayBookSubmittedEvents,
  rejectModerationCase,
  removePublishedBook,
} from "../modules/moderation/server/service";
import { createModerationScreeningHandler } from "../modules/moderation/server/worker";
import { MODERATION_JOB_TYPE } from "../modules/moderation/types";
import { PLATFORM_SCHEMA_REVISION } from "../modules/platform/schema-revision";
import type { SqlExecutor } from "../modules/platform/sql-port";
import { LocalPrivateObjectStorage } from "../modules/publishing/storage/private-object-storage";
import type { PublishingPrivateObjectKind } from "../modules/publishing/types";
import { runWorkerOnce } from "../workers/worker";
import { requireDedicatedUnit04DatabaseUrl } from "./unit04-database-guard";

const databaseUrl = requireDedicatedUnit04DatabaseUrl(
  process.env.UNIT04_DATABASE_URL,
);
const internalSignalSentinel =
  process.env.UNIT04_INTERNAL_SIGNAL_SENTINEL ?? "unit04-private-ai-signal";
const artifactRoot = path.resolve(".data/unit04-postgres-proof");
await rm(artifactRoot, { force: true, recursive: true });
const storage = new LocalPrivateObjectStorage(artifactRoot);
const database = openPostgresDatabase(databaseUrl);
const authorId = "40404040-4040-4040-8040-404040409001";
const managerId = "40404040-4040-4040-8040-404040409002";

interface ProofBook {
  readonly bookId: string;
  readonly bookVersionId: string;
  readonly eventId: string;
}

const objectMedia: Readonly<
  Record<
    "manuscript" | "cover" | "preview" | "epub" | "mobi",
    { readonly extension: string; readonly mediaType: string }
  >
> = {
  cover: { extension: "png", mediaType: "image/png" },
  epub: { extension: "epub", mediaType: "application/epub+zip" },
  manuscript: { extension: "txt", mediaType: "text/plain; charset=utf-8" },
  mobi: { extension: "mobi", mediaType: "application/x-mobipocket-ebook" },
  preview: { extension: "json", mediaType: "application/json" },
};

async function insertObject(
  executor: SqlExecutor,
  kind: keyof typeof objectMedia,
  bytes: Buffer,
  label: string,
): Promise<string> {
  const id = randomUUID();
  const media = objectMedia[kind];
  const stored = await storage.putImmutable({
    bytes,
    extension: media.extension,
    kind: kind as PublishingPrivateObjectKind,
    ownerUserId: authorId,
  });
  await executor.query(
    `
      INSERT INTO publishing_private_objects (
        id, owner_user_id, object_kind, storage_key, sha256, byte_length,
        media_type, original_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      id,
      authorId,
      kind,
      stored.storageKey,
      stored.sha256,
      stored.byteLength,
      media.mediaType,
      `${label}.${media.extension}`,
    ],
  );
  return id;
}

async function createProofBook(label: string, index: number): Promise<ProofBook> {
  const bookId = randomUUID();
  const bookVersionId = randomUUID();
  const eventId = randomUUID();
  const title = `UNIT-04 ${label}`;
  const preview = Buffer.from(
    JSON.stringify({
      authorPublicName: "Олена Вітрова",
      schemaVersion: 1,
      sections: [
        {
          blocks: [
            { kind: "paragraph", text: `Доказовий фрагмент ${label}.` },
            { kind: "paragraph", text: "Другий абзац не змінює авторського змісту." },
          ],
          heading: "Розділ перший",
        },
      ],
      title,
    }),
  );
  const coverSource = await readFile(
    path.resolve("public/books/covers/final/kryzhani-maky.png"),
  );
  const manuscriptObjectId = await insertObject(
    database,
    "manuscript",
    Buffer.from(`${title}\n\nУнікальний рукопис ${index}.`),
    `${label}-manuscript`,
  );
  const coverObjectId = await insertObject(
    database,
    "cover",
    Buffer.concat([coverSource, Buffer.from(`\nunit04-proof-${index}`)]),
    `${label}-cover`,
  );
  const previewObjectId = await insertObject(
    database,
    "preview",
    preview,
    `${label}-preview`,
  );
  const epubObjectId = await insertObject(
    database,
    "epub",
    Buffer.from(`UNIT04 EPUB proof ${index}`),
    `${label}-epub`,
  );
  const mobiObjectId = await insertObject(
    database,
    "mobi",
    Buffer.from(`UNIT04 MOBI proof ${index}`),
    `${label}-mobi`,
  );
  await database.query(
    "INSERT INTO publishing_books (id, author_id, title, status) VALUES ($1, $2, $3, 'submitted')",
    [bookId, authorId, title],
  );
  await database.query(
    `
      INSERT INTO publishing_book_versions (
        id, book_id, version_number, author_id, manuscript_object_id,
        cover_object_id, preview_object_id, epub_object_id, mobi_object_id,
        title, description, genre_slug, base_price_kopiykas,
        sample_section_index, status
      ) VALUES (
        $1, $2, 1, $3, $4, $5, $6, $7, $8,
        $9, $10, 'proza', 19900, 0, 'submitted'
      )
    `,
    [
      bookVersionId,
      bookId,
      authorId,
      manuscriptObjectId,
      coverObjectId,
      previewObjectId,
      epubObjectId,
      mobiObjectId,
      title,
      `Опис доказової книжки ${label}.`,
    ],
  );
  await database.query(
    `
      INSERT INTO outbox_events (
        id, topic, event_type, event_version, aggregate_type, aggregate_id,
        payload, idempotency_key, correlation_id, occurred_at
      ) VALUES (
        $1, 'book.submitted.v1', 'BookSubmitted', 1, 'Book', $2,
        $3::jsonb, $4, $2, CURRENT_TIMESTAMP
      )
    `,
    [
      eventId,
      bookId,
      JSON.stringify({ authorId, bookId, bookVersionId, versionNumber: 1 }),
      `unit04-proof-submitted:${bookId}`,
    ],
  );
  return { bookId, bookVersionId, eventId };
}

async function relayOne(book: ProofBook): Promise<string> {
  const relayed = await relayBookSubmittedEvents(database, { limit: 1 });
  assert.equal(relayed.length, 1);
  const moderationCase = await database.query<{ id: string }>(
    "SELECT id FROM moderation_cases WHERE source_event_id = $1",
    [book.eventId],
  );
  assert.equal(moderationCase.rows.length, 1);
  assert.equal(relayed[0], moderationCase.rows[0]!.id);
  return moderationCase.rows[0]!.id;
}

async function screenNext(
  adapter: DeterministicFakeAiModerationAdapter | UnavailableAiModerationAdapter,
): Promise<void> {
  const handled = await runWorkerOnce({
    database,
    handlers: {
      [MODERATION_JOB_TYPE]: createModerationScreeningHandler({
        adapter,
        database,
        storage,
      }),
    },
    leaseSeconds: 30,
    queue: "publishing",
    retryDelayMs: 0,
    workerId: `unit04-postgres-proof-${randomUUID()}`,
  });
  assert.equal(handled, true);
}

async function caseRevision(caseId: string): Promise<number> {
  const result = await database.query<{ revision: number }>(
    "SELECT revision FROM moderation_cases WHERE id = $1",
    [caseId],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0]!.revision;
}

async function seedPrincipals(): Promise<void> {
  await database.query(
    `
      INSERT INTO users (id, private_email) VALUES
        ($1, 'unit04-author@example.invalid'),
        ($2, 'unit04-manager@example.invalid')
    `,
    [authorId, managerId],
  );
  await database.query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'author'), ($2, 'manager')",
    [authorId, managerId],
  );
  await database.query(
    "INSERT INTO author_profiles (user_id, public_name) VALUES ($1, 'Олена Вітрова')",
    [authorId],
  );
  await database.query(
    "INSERT INTO catalog_genres (slug, label) VALUES ('proza', 'Проза')",
  );
}

async function assertImmutableMutation(
  statement: string,
  parameters: readonly unknown[],
): Promise<void> {
  await assert.rejects(database.query(statement, parameters), /immutable/u);
}

try {
  await database.query("DROP SCHEMA public CASCADE");
  await database.query("CREATE SCHEMA public");
  const applied = await applyMigrations(database);
  assert.equal(applied.at(-1)?.id, PLATFORM_SCHEMA_REVISION);
  assert.equal((await listAppliedMigrations(database)).length, 5);
  assert.deepEqual(await rollbackLatestMigration(database), {
    direction: "down",
    id: PLATFORM_SCHEMA_REVISION,
  });
  assert.deepEqual(await applyMigrations(database), [
    { direction: "up", id: PLATFORM_SCHEMA_REVISION },
  ]);
  await seedPrincipals();

  const safeBook = await createProofBook("safe-clear", 1);
  const safeCaseId = await relayOne(safeBook);
  assert.deepEqual(await relayBookSubmittedEvents(database, { limit: 5 }), []);
  const idempotency = await database.query<{
    cases: number;
    jobs: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM moderation_cases WHERE source_event_id = $1) AS cases,
        (SELECT COUNT(*)::int FROM durable_jobs WHERE idempotency_key = $2) AS jobs
    `,
    [safeBook.eventId, `moderation.screen:${safeCaseId}`],
  );
  assert.deepEqual(idempotency.rows[0], { cases: 1, jobs: 1 });
  await screenNext(new DeterministicFakeAiModerationAdapter(() => ({ result: "clear" })));
  const safePublished = await database.query<{
    active_book_version_id: string;
    availability: string;
    book_status: string;
    case_status: string;
    source_book_version_id: string;
  }>(
    `
      SELECT publication.active_book_version_id,
             catalog.source_book_version_id, catalog.availability,
             book.status AS book_status, moderation.status AS case_status
      FROM book_publications publication
      JOIN catalog_book_read_models catalog ON catalog.book_id = publication.book_id
      JOIN publishing_books book ON book.id = publication.book_id
      JOIN moderation_cases moderation ON moderation.id = publication.activation_case_id
      WHERE publication.book_id = $1
    `,
    [safeBook.bookId],
  );
  assert.deepEqual(safePublished.rows[0], {
    active_book_version_id: safeBook.bookVersionId,
    availability: "published",
    book_status: "published",
    case_status: "cleared",
    source_book_version_id: safeBook.bookVersionId,
  });

  const riskyBook = await createProofBook("manual-approval", 2);
  const riskyCaseId = await relayOne(riskyBook);
  await screenNext(
    new DeterministicFakeAiModerationAdapter(() => ({
      providerRequestId: "proof-risk-request",
      result: "flagged",
      signals: [
        {
          code: "manual_review_required",
          label: internalSignalSentinel,
          severity: "critical",
        },
      ],
    })),
  );
  const riskyState = await database.query<{ book_status: string; case_status: string }>(
    `
      SELECT book.status AS book_status, moderation.status AS case_status
      FROM moderation_cases moderation
      JOIN moderation_book_subjects subject ON subject.case_id = moderation.id
      JOIN publishing_books book ON book.id = subject.book_id
      WHERE moderation.id = $1
    `,
    [riskyCaseId],
  );
  assert.deepEqual(riskyState.rows[0], {
    book_status: "manual_review",
    case_status: "manual_review_pending",
  });
  await assert.rejects(
    approveModerationCase(database, storage, {
      caseId: riskyCaseId,
      expectedRevision: await caseRevision(riskyCaseId),
      idempotencyKey: "proof-author-cannot-approve",
      managerUserId: authorId,
    }),
    /роль Менеджера/u,
  );
  const deniedDecision = await database.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM moderation_decisions WHERE case_id = $1",
    [riskyCaseId],
  );
  assert.equal(deniedDecision.rows[0]?.count, 0);
  await approveModerationCase(database, storage, {
    caseId: riskyCaseId,
    expectedRevision: await caseRevision(riskyCaseId),
    idempotencyKey: "proof-approve-risky-book",
    managerUserId: managerId,
  });
  const approved = await database.query<{ action: string; state: string }>(
    `
      SELECT decision.action, publication.state
      FROM moderation_decisions decision
      JOIN moderation_book_subjects subject ON subject.case_id = decision.case_id
      JOIN book_publications publication ON publication.book_id = subject.book_id
      WHERE decision.case_id = $1
    `,
    [riskyCaseId],
  );
  assert.deepEqual(approved.rows[0], {
    action: "approve_publication",
    state: "published",
  });

  const outageBook = await createProofBook("provider-outage", 3);
  const outageCaseId = await relayOne(outageBook);
  await screenNext(new UnavailableAiModerationAdapter());
  const outage = await database.query<{
    case_status: string;
    failure_code: string;
    result: string;
  }>(
    `
      SELECT moderation.status AS case_status, screening.result,
             screening.failure_code
      FROM moderation_cases moderation
      JOIN moderation_screening_runs screening ON screening.case_id = moderation.id
      WHERE moderation.id = $1
    `,
    [outageCaseId],
  );
  assert.deepEqual(outage.rows[0], {
    case_status: "manual_review_pending",
    failure_code: "PROVIDER_UNAVAILABLE",
    result: "provider_error",
  });

  const rejectedBook = await createProofBook("reason-only", 4);
  const rejectedCaseId = await relayOne(rejectedBook);
  await screenNext(
    new DeterministicFakeAiModerationAdapter(() => ({
      result: "flagged",
      signals: [
        { code: "private_signal", label: internalSignalSentinel, severity: "warning" },
      ],
    })),
  );
  await assert.rejects(
    rejectModerationCase(database, {
      caseId: rejectedCaseId,
      expectedRevision: await caseRevision(rejectedCaseId),
      idempotencyKey: "proof-reject-without-category",
      managerUserId: managerId,
    }),
    /Категорію причини/u,
  );
  await rejectModerationCase(database, {
    caseId: rejectedCaseId,
    expectedRevision: await caseRevision(rejectedCaseId),
    idempotencyKey: "proof-reject-with-category",
    managerUserId: managerId,
    reasonCategoryCode: "platform_requirements",
  });
  const authorReason = await loadAuthorBookManagement(
    database,
    authorId,
    rejectedBook.bookId,
  );
  assert.equal(authorReason?.reasonCategory?.code, "platform_requirements");
  assert.equal(JSON.stringify(authorReason).includes(internalSignalSentinel), false);
  const disclosed = await database.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM outbox_events
      WHERE payload::text LIKE $1
    `,
    [`%${internalSignalSentinel}%`],
  );
  assert.equal(disclosed.rows[0]?.count, 0);

  const publicationBeforeRelated = await database.query<{
    active_book_version_id: string;
    projection_revision: number;
  }>(
    `
      SELECT publication.active_book_version_id, catalog.projection_revision
      FROM book_publications publication
      JOIN catalog_book_read_models catalog ON catalog.book_id = publication.book_id
      WHERE publication.book_id = $1
    `,
    [riskyBook.bookId],
  );
  const updateSubjectId = randomUUID();
  const updateApproveCaseId = await createRelatedModerationCase(database, {
    bookId: riskyBook.bookId,
    bookVersionId: riskyBook.bookVersionId,
    idempotencyKey: "proof-update-approve",
    signals: [{ code: "update_signal", label: "Update signal", severity: "warning" }],
    subjectId: updateSubjectId,
    subjectType: "book_update",
  });
  await approveModerationCase(database, storage, {
    caseId: updateApproveCaseId,
    expectedRevision: await caseRevision(updateApproveCaseId),
    idempotencyKey: "proof-update-approve-decision",
    managerUserId: managerId,
  });
  const publicationAfterRelated = await database.query<{
    active_book_version_id: string;
    projection_revision: number;
  }>(
    `
      SELECT publication.active_book_version_id, catalog.projection_revision
      FROM book_publications publication
      JOIN catalog_book_read_models catalog ON catalog.book_id = publication.book_id
      WHERE publication.book_id = $1
    `,
    [riskyBook.bookId],
  );
  assert.deepEqual(publicationAfterRelated.rows[0], publicationBeforeRelated.rows[0]);
  const updateRejectCaseId = await createRelatedModerationCase(database, {
    bookId: outageBook.bookId,
    bookVersionId: outageBook.bookVersionId,
    idempotencyKey: "proof-update-reject",
    signals: [{ code: "update_signal", label: "Update signal", severity: "warning" }],
    subjectId: randomUUID(),
    subjectType: "book_update",
  });
  await assert.rejects(
    rejectModerationCase(database, {
      caseId: updateRejectCaseId,
      expectedRevision: await caseRevision(updateRejectCaseId),
      idempotencyKey: "proof-update-reject-no-reason",
      managerUserId: managerId,
    }),
    /Категорію причини/u,
  );
  await rejectModerationCase(database, {
    caseId: updateRejectCaseId,
    expectedRevision: await caseRevision(updateRejectCaseId),
    idempotencyKey: "proof-update-reject-reason",
    managerUserId: managerId,
    reasonCategoryCode: "technical_issue",
  });
  const updateActions = await database.query<{ action: string }>(
    "SELECT action FROM moderation_decisions WHERE case_id = ANY($1::uuid[]) ORDER BY action",
    [[updateApproveCaseId, updateRejectCaseId]],
  );
  assert.deepEqual(updateActions.rows.map(({ action }) => action), [
    "approve_update",
    "reject_update",
  ]);

  const reviewSubjectId = randomUUID();
  const reviewCaseId = await createRelatedModerationCase(database, {
    bookId: safeBook.bookId,
    bookVersionId: safeBook.bookVersionId,
    idempotencyKey: "proof-review-reject",
    signals: [{ code: "review_signal", label: "Review signal", severity: "warning" }],
    subjectId: reviewSubjectId,
    subjectType: "review",
  });
  await doNotPublishReviewModerationCase(database, {
    caseId: reviewCaseId,
    expectedRevision: await caseRevision(reviewCaseId),
    idempotencyKey: "proof-review-direct-reject",
    managerUserId: managerId,
  });
  const reviewDecision = await database.query<{
    action: string;
    reason_category_code: string | null;
    subject_id: string;
  }>(
    `
      SELECT decision.action, decision.reason_category_code,
             moderation.subject_id
      FROM moderation_decisions decision
      JOIN moderation_cases moderation ON moderation.id = decision.case_id
      WHERE decision.case_id = $1
    `,
    [reviewCaseId],
  );
  assert.deepEqual(reviewDecision.rows[0], {
    action: "do_not_publish_review",
    reason_category_code: null,
    subject_id: reviewSubjectId,
  });

  const concurrencyCaseId = await createRelatedModerationCase(database, {
    bookId: safeBook.bookId,
    bookVersionId: safeBook.bookVersionId,
    idempotencyKey: "proof-concurrency",
    signals: [{ code: "concurrency", label: "Concurrency", severity: "warning" }],
    subjectId: randomUUID(),
    subjectType: "review",
  });
  const concurrencyRevision = await caseRevision(concurrencyCaseId);
  const competing = await Promise.allSettled([
    approveModerationCase(database, storage, {
      caseId: concurrencyCaseId,
      expectedRevision: concurrencyRevision,
      idempotencyKey: "proof-concurrency-approve",
      managerUserId: managerId,
    }),
    doNotPublishReviewModerationCase(database, {
      caseId: concurrencyCaseId,
      expectedRevision: concurrencyRevision,
      idempotencyKey: "proof-concurrency-reject",
      managerUserId: managerId,
    }),
  ]);
  assert.equal(competing.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(competing.filter(({ status }) => status === "rejected").length, 1);
  const concurrencyCount = await database.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM moderation_decisions WHERE case_id = $1",
    [concurrencyCaseId],
  );
  assert.equal(concurrencyCount.rows[0]?.count, 1);

  const removalCaseId = await createPostPublicationRiskCase(database, {
    bookId: riskyBook.bookId,
    idempotencyKey: "proof-post-publication-risk",
    signals: [{ code: "legal_risk", label: "Legal risk", severity: "critical" }],
  });
  await assert.rejects(
    removePublishedBook(database, {
      caseId: removalCaseId,
      confirmed: false as true,
      expectedRevision: await caseRevision(removalCaseId),
      idempotencyKey: "proof-removal-unconfirmed",
      managerUserId: managerId,
      removalGround: "platform_rules_violation",
    }),
    /Підтвердьте/u,
  );
  await removePublishedBook(database, {
    caseId: removalCaseId,
    confirmed: true,
    expectedRevision: await caseRevision(removalCaseId),
    idempotencyKey: "proof-removal-confirmed",
    managerUserId: managerId,
    removalGround: "platform_rules_violation",
  });
  const removed = await database.query<{
    audit_actor: string;
    availability: string;
    book_status: string;
    removal_ground: string;
    state: string;
  }>(
    `
      SELECT publication.state, catalog.availability,
             book.status AS book_status, decision.removal_ground,
             audit.actor_type AS audit_actor
      FROM book_publications publication
      JOIN catalog_book_read_models catalog ON catalog.book_id = publication.book_id
      JOIN publishing_books book ON book.id = publication.book_id
      JOIN moderation_decisions decision ON decision.id = publication.removal_decision_id
      JOIN publication_audit_events audit ON audit.decision_id = decision.id
      WHERE publication.book_id = $1 AND audit.event_type = 'removed'
    `,
    [riskyBook.bookId],
  );
  assert.deepEqual(removed.rows[0], {
    audit_actor: "manager",
    availability: "unavailable",
    book_status: "unavailable",
    removal_ground: "platform_rules_violation",
    state: "unavailable",
  });

  const screeningId = await database.query<{ id: string }>(
    "SELECT id FROM moderation_screening_runs ORDER BY created_at LIMIT 1",
  );
  const decisionId = await database.query<{ id: string }>(
    "SELECT id FROM moderation_decisions ORDER BY decided_at LIMIT 1",
  );
  const auditId = await database.query<{ id: string }>(
    "SELECT id FROM publication_audit_events ORDER BY created_at LIMIT 1",
  );
  assert.ok(screeningId.rows[0]?.id);
  assert.ok(decisionId.rows[0]?.id);
  assert.ok(auditId.rows[0]?.id);
  await assertImmutableMutation(
    "UPDATE moderation_screening_runs SET adapter_id = 'mutated' WHERE id = $1",
    [screeningId.rows[0]!.id],
  );
  await assertImmutableMutation(
    "UPDATE moderation_decisions SET idempotency_key = 'mutated' WHERE id = $1",
    [decisionId.rows[0]!.id],
  );
  await assertImmutableMutation(
    "DELETE FROM publication_audit_events WHERE id = $1",
    [auditId.rows[0]!.id],
  );
  await assertImmutableMutation(
    "UPDATE moderation_reason_categories SET author_label = 'mutated' WHERE code = 'spam' AND copy_version = 1",
    [],
  );

  process.stdout.write(
    `${JSON.stringify({
      active_version_invariant: "passed",
      ai_outage_safe_fail: "passed",
      append_only_audit: "passed",
      author_decision_denied: "passed",
      book_approval: "passed",
      book_rejection_reason_only: "passed",
      book_submitted_idempotency: "passed",
      catalog_activation: "passed",
      decision_concurrency: "passed",
      internal_signal_non_disclosure: "passed",
      migration_roundtrip: "passed",
      removal_unavailable: "passed",
      review_decision_contract: "passed",
      risky_manual_routing: "passed",
      safe_auto_publication: "passed",
      schema_revision: PLATFORM_SCHEMA_REVISION,
      status: "passed",
      update_decision_contract: "passed",
    })}\n`,
  );
} finally {
  await database.close?.();
  await rm(artifactRoot, { force: true, recursive: true });
}
