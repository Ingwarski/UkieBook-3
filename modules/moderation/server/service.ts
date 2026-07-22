import "server-only";

import { randomUUID } from "node:crypto";

import type { JsonObject } from "../../platform/envelopes";
import type { DomainTransaction } from "../../platform/transaction";
import { withDomainTransaction } from "../../platform/transaction";
import type { SqlDatabase, SqlExecutor } from "../../platform/sql-port";
import type { PreviewDocument } from "../../publishing/types";
import type { PrivateObjectStorage } from "../../publishing/storage/private-object-storage";
import {
  AiModerationProviderError,
  type AiModerationAdapter,
} from "../adapter";
import {
  MODERATION_JOB_TYPE,
  MODERATION_JOB_VERSION,
  MODERATION_POLICY_VERSION,
  MODERATION_QUEUE,
  MODERATION_SCHEMA_VERSION,
  REASON_CATEGORY_COPY_VERSION,
  REASON_CATEGORY_LABELS,
  REASON_CATEGORY_OPTIONS,
  REMOVAL_GROUND_OPTIONS,
  isReasonCategoryCode,
  isRemovalGround,
  reasonCategoryOption,
  type AiModerationResult,
  type AuthorBookManagementReadModel,
  type ManagerModerationQueueItem,
  type ManagerModerationQueueReadModel,
  type ModerationDecisionAction,
  type ModerationInternalSignal,
  type ModerationScreeningInput,
  type ModerationSubjectType,
  type ReasonCategoryCode,
  type RemovalGround,
} from "../types";
import {
  findModerationBookCase,
  listPendingModerationBookCases,
  pendingModerationCounts,
  type StoredModerationBookCase,
} from "./repository";

export class ModerationInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModerationInputError";
    this.code = code;
  }
}

export class ModerationConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModerationConflictError";
    this.code = code;
  }
}

interface BookSubmittedPayload extends JsonObject {
  readonly authorId: string;
  readonly bookId: string;
  readonly bookVersionId: string;
  readonly versionNumber: number;
}

interface CatalogProjectionInput {
  readonly sampleTitle: string;
  readonly sampleBlocks: readonly { readonly kind: "paragraph"; readonly text: string }[];
}

export interface ManagerDecisionBase {
  readonly caseId: string;
  readonly managerUserId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

export interface RejectModerationCaseInput extends ManagerDecisionBase {
  readonly reasonCategoryCode?: ReasonCategoryCode;
}

export interface RemovePublishedBookInput extends ManagerDecisionBase {
  readonly removalGround: RemovalGround;
  readonly confirmed: true;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const internalSignalCodePattern = /^[a-z0-9][a-z0-9_.-]{0,79}$/u;

function requireUuid(value: string, field: string): string {
  if (!uuidPattern.test(value)) {
    throw new ModerationInputError("INVALID_IDENTIFIER", `${field}: некоректний ідентифікатор.`);
  }
  return value;
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) {
    throw new ModerationInputError("IDEMPOTENCY_KEY", "Некоректний ключ операції.");
  }
  return normalized;
}

function parseBookSubmittedPayload(payload: unknown): BookSubmittedPayload {
  const value = typeof payload === "string" ? JSON.parse(payload) as unknown : payload;
  if (
    typeof value !== "object" ||
    value === null ||
    !("authorId" in value) ||
    !("bookId" in value) ||
    !("bookVersionId" in value) ||
    !("versionNumber" in value) ||
    typeof value.authorId !== "string" ||
    typeof value.bookId !== "string" ||
    typeof value.bookVersionId !== "string" ||
    typeof value.versionNumber !== "number" ||
    !Number.isSafeInteger(value.versionNumber) ||
    value.versionNumber <= 0
  ) {
    throw new Error("BookSubmitted payload is invalid");
  }
  requireUuid(value.authorId, "authorId");
  requireUuid(value.bookId, "bookId");
  requireUuid(value.bookVersionId, "bookVersionId");
  return value as BookSubmittedPayload;
}

function normalizeInternalSignals(
  signals: readonly ModerationInternalSignal[],
): ModerationInternalSignal[] {
  const normalized = signals.slice(0, 16).flatMap((signal): ModerationInternalSignal[] => {
    const code = signal.code.trim().toLocaleLowerCase("en-US");
    const label = signal.label.replace(/\s+/gu, " ").trim().slice(0, 160);
    if (
      !internalSignalCodePattern.test(code) ||
      !label ||
      !["info", "warning", "critical"].includes(signal.severity)
    ) {
      return [];
    }
    return [{ code, label, severity: signal.severity }];
  });
  return normalized;
}

function validatedAiResult(result: AiModerationResult): AiModerationResult {
  if (result.result === "clear") return result;
  const signals = normalizeInternalSignals(result.signals);
  if (signals.length === 0) {
    throw new AiModerationProviderError("INVALID_PROVIDER_RESPONSE");
  }
  return { ...result, signals };
}

async function readPreview(
  storage: PrivateObjectStorage,
  storageKey: string,
): Promise<PreviewDocument> {
  const bytes = await storage.read(storageKey);
  const parsed = JSON.parse(bytes.toString("utf8")) as PreviewDocument;
  if (
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.sections) ||
    parsed.sections.length === 0
  ) {
    throw new ModerationConflictError(
      "PREVIEW_INVALID",
      "Збережений попередній перегляд має непідтримуваний формат.",
    );
  }
  return parsed;
}

function catalogProjection(
  preview: PreviewDocument,
  sampleSectionIndex: number,
): CatalogProjectionInput {
  const section = preview.sections[sampleSectionIndex];
  if (!section) {
    throw new ModerationConflictError(
      "SAMPLE_INVALID",
      "Безкоштовний фрагмент не відповідає поданій версії.",
    );
  }
  return {
    sampleBlocks: section.blocks.flatMap((block) =>
      block.kind === "paragraph" && block.text.trim()
        ? [{ kind: "paragraph" as const, text: block.text }]
        : [],
    ),
    sampleTitle: section.heading.slice(0, 160),
  };
}

async function artifactHashes(
  executor: SqlExecutor,
  moderationCase: StoredModerationBookCase,
): Promise<string[]> {
  const result = await executor.query<{ sha256: string }>(
    `
      SELECT object.sha256
      FROM publishing_book_versions version
      CROSS JOIN LATERAL unnest(ARRAY[
        version.manuscript_object_id,
        version.cover_object_id,
        version.preview_object_id,
        version.epub_object_id,
        version.mobi_object_id
      ]) AS object_ref(id)
      JOIN publishing_private_objects object ON object.id = object_ref.id
      WHERE version.id = $1
      ORDER BY object.sha256
    `,
    [moderationCase.bookVersionId],
  );
  return result.rows.map((row) => row.sha256);
}

function screeningText(preview: PreviewDocument): string {
  return preview.sections
    .flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) => block.kind === "paragraph" ? [block.text] : []),
    ])
    .join("\n")
    .slice(0, 500_000);
}

async function requireManager(executor: SqlExecutor, managerUserId: string): Promise<void> {
  const result = await executor.query<{ allowed: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = $1 AND role = 'manager'
      ) AS allowed
    `,
    [requireUuid(managerUserId, "managerUserId")],
  );
  if (!result.rows[0]?.allowed) {
    throw new ModerationInputError("MANAGER_REQUIRED", "Потрібна роль Менеджера.");
  }
}

export async function relayBookSubmittedEvents(
  database: SqlDatabase,
  options: { readonly limit?: number } = {},
): Promise<readonly string[]> {
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ModerationInputError("LIMIT", "Некоректний ліміт обробки.");
  }
  const caseIds: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const caseId = await withDomainTransaction(database, async (transaction) => {
      const eventResult = await transaction.connection.query<{
        correlation_id: string;
        id: string;
        payload: unknown;
      }>(`
        SELECT id, correlation_id, payload
        FROM outbox_events
        WHERE event_type = 'BookSubmitted'
          AND event_version = 1
          AND published_at IS NULL
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const event = eventResult.rows[0];
      if (!event) return null;
      const payload = parseBookSubmittedPayload(event.payload);
      const version = await transaction.connection.query<{ id: string }>(
        `
          SELECT version.id
          FROM publishing_book_versions version
          WHERE version.id = $1
            AND version.book_id = $2
            AND version.author_id = $3
            AND version.version_number = $4
        `,
        [payload.bookVersionId, payload.bookId, payload.authorId, payload.versionNumber],
      );
      if (!version.rows[0]) throw new Error("BookSubmitted does not match an immutable BookVersion");

      const idempotencyKey = `moderation.book-submitted:${event.id}`;
      const inserted = await transaction.connection.query<{ id: string }>(
        `
          INSERT INTO moderation_cases (
            id, subject_type, subject_id, subject_version_id, trigger_type,
            source_event_id, idempotency_key, status
          ) VALUES ($1, 'book', $2, $3, 'submission', $4, $5, 'screening_pending')
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
        [randomUUID(), payload.bookId, payload.bookVersionId, event.id, idempotencyKey],
      );
      let resolvedCaseId = inserted.rows[0]?.id;
      if (!resolvedCaseId) {
        const existing = await transaction.connection.query<{ id: string }>(
          "SELECT id FROM moderation_cases WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        resolvedCaseId = existing.rows[0]?.id;
      }
      if (!resolvedCaseId) throw new Error("Unable to recover moderation case");
      await transaction.connection.query(
        `
          INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (case_id) DO NOTHING
        `,
        [resolvedCaseId, payload.bookId, payload.bookVersionId],
      );
      await transaction.enqueue({
        correlationId: event.correlation_id,
        idempotencyKey: `moderation.screen:${resolvedCaseId}`,
        jobType: MODERATION_JOB_TYPE,
        jobVersion: MODERATION_JOB_VERSION,
        maxAttempts: 5,
        payload: { caseId: resolvedCaseId, schemaVersion: MODERATION_SCHEMA_VERSION },
        queue: MODERATION_QUEUE,
      });
      await transaction.connection.query(
        `
          UPDATE outbox_events
          SET published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
              publish_attempts = publish_attempts + 1,
              last_error = NULL
          WHERE id = $1
        `,
        [event.id],
      );
      return resolvedCaseId;
    });
    if (!caseId) break;
    caseIds.push(caseId);
  }
  return caseIds;
}

async function emitManualReviewRequested(
  transaction: DomainTransaction,
  moderationCase: StoredModerationBookCase,
): Promise<void> {
  await transaction.emit({
    aggregateId: moderationCase.id,
    aggregateType: "ModerationCase",
    correlationId: moderationCase.id,
    eventType: "ModerationManualReviewRequested",
    eventVersion: 1,
    idempotencyKey: `moderation.manual-review:${moderationCase.id}`,
    payload: {
      caseId: moderationCase.id,
      subjectId: moderationCase.subjectId,
      subjectType: moderationCase.subjectType,
      subjectVersionId: moderationCase.subjectVersionId,
    },
    topic: "moderation.manual-review-requested.v1",
  });
}

async function activatePublication(
  transaction: DomainTransaction,
  moderationCase: StoredModerationBookCase,
  projection: CatalogProjectionInput,
  actor: {
    readonly type: "manager" | "system";
    readonly userId: string | null;
    readonly decisionId: string | null;
  },
): Promise<void> {
  const activationEvent = await transaction.emit({
    aggregateId: moderationCase.bookId,
    aggregateType: "Book",
    correlationId: moderationCase.id,
    eventType: "PublicationActivated",
    eventVersion: 1,
    idempotencyKey: `publication.activated:${moderationCase.bookVersionId}`,
    payload: {
      bookId: moderationCase.bookId,
      bookVersionId: moderationCase.bookVersionId,
      caseId: moderationCase.id,
    },
    topic: "publication.activated.v1",
  });
  await transaction.connection.query(
    `
      INSERT INTO book_publications (
        book_id, active_book_version_id, state, activation_case_id,
        removal_decision_id, revision, activated_at, removed_at, updated_at
      ) VALUES ($1, $2, 'published', $3, NULL, 1, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT (book_id) DO UPDATE
      SET active_book_version_id = EXCLUDED.active_book_version_id,
          state = 'published',
          activation_case_id = EXCLUDED.activation_case_id,
          removal_decision_id = NULL,
          revision = book_publications.revision + 1,
          activated_at = CURRENT_TIMESTAMP,
          removed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
    `,
    [moderationCase.bookId, moderationCase.bookVersionId, moderationCase.id],
  );
  await transaction.connection.query(
    `
      INSERT INTO publication_audit_events (
        id, book_id, book_version_id, case_id, decision_id, event_type,
        actor_type, actor_user_id, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, 'activated', $6, $7, $8)
      ON CONFLICT (idempotency_key) DO NOTHING
    `,
    [
      randomUUID(),
      moderationCase.bookId,
      moderationCase.bookVersionId,
      moderationCase.id,
      actor.decisionId,
      actor.type,
      actor.userId,
      `publication.audit.activated:${moderationCase.bookVersionId}`,
    ],
  );
  await transaction.connection.query(
    `
      INSERT INTO catalog_book_read_models (
        book_id, title, author_public_id, author_public_name, genre_slug,
        description, sample_title, sample_blocks, cover_path, cover_theme,
        base_price_kopiykas, availability, catalog_rank, rating_count,
        published_at, updated_at, source_book_version_id, source_event_id,
        projection_revision
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
        $9, 'violet', $10, 'published', nextval('catalog_publication_rank_seq'),
        0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $11, $12, 1
      )
      ON CONFLICT (book_id) DO UPDATE
      SET title = EXCLUDED.title,
          author_public_id = EXCLUDED.author_public_id,
          author_public_name = EXCLUDED.author_public_name,
          genre_slug = EXCLUDED.genre_slug,
          description = EXCLUDED.description,
          sample_title = EXCLUDED.sample_title,
          sample_blocks = EXCLUDED.sample_blocks,
          cover_path = EXCLUDED.cover_path,
          cover_theme = EXCLUDED.cover_theme,
          base_price_kopiykas = EXCLUDED.base_price_kopiykas,
          availability = 'published',
          updated_at = CURRENT_TIMESTAMP,
          source_book_version_id = EXCLUDED.source_book_version_id,
          source_event_id = EXCLUDED.source_event_id,
          projection_revision = COALESCE(catalog_book_read_models.projection_revision, 0) + 1
    `,
    [
      moderationCase.bookId,
      moderationCase.title,
      moderationCase.authorId,
      moderationCase.authorPublicName,
      moderationCase.genreSlug,
      moderationCase.description,
      projection.sampleTitle,
      JSON.stringify(projection.sampleBlocks),
      `/books/covers/${moderationCase.bookId}`,
      moderationCase.basePriceKopiykas,
      moderationCase.bookVersionId,
      activationEvent.id,
    ],
  );
  await transaction.connection.query(
    `
      UPDATE publishing_books
      SET status = 'published',
          rejection_category = NULL,
          rejection_reason_code = NULL,
          rejection_reason_copy_version = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [moderationCase.bookId],
  );
}

export async function screenModerationCase(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  adapter: AiModerationAdapter,
  caseId: string,
): Promise<"already_processed" | "manual_review_pending" | "published"> {
  requireUuid(caseId, "caseId");
  const initial = await findModerationBookCase(database, caseId);
  if (!initial) throw new ModerationInputError("CASE_NOT_FOUND", "Випадок не знайдено.");
  if (initial.status !== "screening_pending") return "already_processed";
  const preview = await readPreview(storage, initial.previewStorageKey);
  const screeningInput: ModerationScreeningInput = {
    artifactHashes: await artifactHashes(database, initial),
    bookId: initial.bookId,
    bookVersionId: initial.bookVersionId,
    caseId: initial.id,
    description: initial.description,
    policyVersion: MODERATION_POLICY_VERSION,
    schemaVersion: MODERATION_SCHEMA_VERSION,
    text: screeningText(preview),
    title: initial.title,
  };
  let result: AiModerationResult | null = null;
  let failureCode: string | null = null;
  try {
    result = validatedAiResult(await adapter.screen(screeningInput));
  } catch (error) {
    failureCode = error instanceof AiModerationProviderError
      ? error.code.slice(0, 120)
      : "PROVIDER_ERROR";
  }
  return withDomainTransaction(database, async (transaction) => {
    const current = await findModerationBookCase(transaction.connection, caseId, {
      forUpdate: true,
    });
    if (!current) throw new ModerationInputError("CASE_NOT_FOUND", "Випадок не знайдено.");
    if (current.status !== "screening_pending") return "already_processed";
    const attemptResult = await transaction.connection.query<{ next_attempt: number }>(
      `
        SELECT COALESCE(MAX(attempt) + 1, 1)::int AS next_attempt
        FROM moderation_screening_runs
        WHERE case_id = $1
      `,
      [caseId],
    );
    const attempt = attemptResult.rows[0]?.next_attempt ?? 1;
    const safeFailSignals: ModerationInternalSignal[] = [{
      code: "provider_unavailable",
      label: "Сервіс ШІ недоступний — потрібна ручна перевірка",
      severity: "warning",
    }];
    const screeningResult = result?.result ?? "provider_error";
    const signals = result?.result === "flagged" ? result.signals : safeFailSignals;
    await transaction.connection.query(
      `
        INSERT INTO moderation_screening_runs (
          id, case_id, attempt, adapter_id, policy_version, result,
          internal_signals, provider_request_id, failure_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      `,
      [
        randomUUID(),
        caseId,
        attempt,
        adapter.adapterId.slice(0, 160),
        MODERATION_POLICY_VERSION,
        screeningResult,
        JSON.stringify(screeningResult === "clear" ? [] : signals),
        result?.providerRequestId?.slice(0, 240) ?? null,
        screeningResult === "provider_error" ? (failureCode ?? "PROVIDER_ERROR") : null,
      ],
    );
    if (screeningResult === "clear") {
      await transaction.connection.query(
        `
          UPDATE moderation_cases
          SET status = 'cleared', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [caseId],
      );
      await activatePublication(
        transaction,
        current,
        catalogProjection(preview, current.sampleSectionIndex),
        { decisionId: null, type: "system", userId: null },
      );
      return "published";
    }
    await transaction.connection.query(
      `
        UPDATE moderation_cases
        SET status = 'manual_review_pending', revision = revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [caseId],
    );
    if (!current.isPublished) {
      await transaction.connection.query(
        "UPDATE publishing_books SET status = 'manual_review', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [current.bookId],
      );
    }
    await emitManualReviewRequested(transaction, current);
    return "manual_review_pending";
  });
}

async function existingDecision(
  executor: SqlExecutor,
  caseId: string,
): Promise<null | {
  readonly action: ModerationDecisionAction;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly managerUserId: string;
}> {
  const result = await executor.query<{
    action: ModerationDecisionAction;
    id: string;
    idempotency_key: string;
    manager_user_id: string;
  }>(
    "SELECT id, action, idempotency_key, manager_user_id FROM moderation_decisions WHERE case_id = $1",
    [caseId],
  );
  const row = result.rows[0];
  return row
    ? {
        action: row.action,
        id: row.id,
        idempotencyKey: row.idempotency_key,
        managerUserId: row.manager_user_id,
      }
    : null;
}

async function insertDecision(
  executor: SqlExecutor,
  moderationCase: StoredModerationBookCase,
  input: ManagerDecisionBase,
  action: ModerationDecisionAction,
  options: {
    readonly reasonCategoryCode?: ReasonCategoryCode;
    readonly removalGround?: RemovalGround;
  } = {},
): Promise<{ readonly id: string; readonly repeated: boolean }> {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const present = await existingDecision(executor, moderationCase.id);
  if (present) {
    if (
      present.action === action &&
      present.idempotencyKey === idempotencyKey &&
      present.managerUserId === input.managerUserId
    ) {
      return { id: present.id, repeated: true };
    }
    throw new ModerationConflictError("ALREADY_DECIDED", "Рішення вже зафіксовано.");
  }
  if (moderationCase.status !== "manual_review_pending") {
    throw new ModerationConflictError("CASE_NOT_PENDING", "Випадок уже не очікує рішення.");
  }
  if (moderationCase.revision !== input.expectedRevision) {
    throw new ModerationConflictError("STALE_CASE", "Стан перевірки змінився. Оновіть сторінку.");
  }
  const id = randomUUID();
  await executor.query(
    `
      INSERT INTO moderation_decisions (
        id, case_id, manager_user_id, action, reason_category_code,
        reason_copy_version, removal_ground, case_revision, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      moderationCase.id,
      input.managerUserId,
      action,
      options.reasonCategoryCode ?? null,
      options.reasonCategoryCode ? REASON_CATEGORY_COPY_VERSION : null,
      options.removalGround ?? null,
      moderationCase.revision,
      idempotencyKey,
    ],
  );
  return { id, repeated: false };
}

async function emitDecision(
  transaction: DomainTransaction,
  moderationCase: StoredModerationBookCase,
  input: ManagerDecisionBase,
  decisionId: string,
  action: ModerationDecisionAction,
  reasonCategoryCode?: ReasonCategoryCode,
): Promise<void> {
  await transaction.emit({
    aggregateId: moderationCase.id,
    aggregateType: "ModerationCase",
    correlationId: moderationCase.id,
    eventType: "ModerationDecisionRecorded",
    eventVersion: 1,
    idempotencyKey: `moderation.decision:${decisionId}`,
    payload: {
      action,
      caseId: moderationCase.id,
      decisionId,
      managerUserId: input.managerUserId,
      reasonCategoryCode: reasonCategoryCode ?? null,
      subjectId: moderationCase.subjectId,
      subjectType: moderationCase.subjectType,
      subjectVersionId: moderationCase.subjectVersionId,
    },
    topic: "moderation.decision-recorded.v1",
  });
}

export async function approveModerationCase(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: ManagerDecisionBase,
): Promise<void> {
  const initial = await findModerationBookCase(database, requireUuid(input.caseId, "caseId"));
  if (!initial) throw new ModerationInputError("CASE_NOT_FOUND", "Випадок не знайдено.");
  const projection = initial.subjectType === "book" && initial.triggerType === "submission"
    ? catalogProjection(
        await readPreview(storage, initial.previewStorageKey),
        initial.sampleSectionIndex,
      )
    : null;
  await withDomainTransaction(database, async (transaction) => {
    await requireManager(transaction.connection, input.managerUserId);
    const current = await findModerationBookCase(transaction.connection, input.caseId, {
      forUpdate: true,
    });
    if (!current) throw new ModerationInputError("CASE_NOT_FOUND", "Випадок не знайдено.");
    const action: ModerationDecisionAction = current.subjectType === "book_update"
      ? "approve_update"
      : current.subjectType === "review"
        ? "publish_review"
        : current.triggerType === "post_publication_risk"
          ? "keep_published"
          : "approve_publication";
    if (action === "keep_published" && !current.isPublished) {
      throw new ModerationInputError("ACTION_NOT_ALLOWED", "Книжка не опублікована.");
    }
    const decision = await insertDecision(
      transaction.connection,
      current,
      input,
      action,
    );
    if (decision.repeated) return;
    await transaction.connection.query(
      "UPDATE moderation_cases SET status = 'approved', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [current.id],
    );
    await emitDecision(transaction, current, input, decision.id, action);
    if (action === "approve_publication") {
      if (!projection) throw new Error("Book publication projection is missing");
      await activatePublication(transaction, current, projection, {
        decisionId: decision.id,
        type: "manager",
        userId: input.managerUserId,
      });
    }
  });
}

export async function rejectModerationCase(
  database: SqlDatabase,
  input: RejectModerationCaseInput,
): Promise<void> {
  await withDomainTransaction(database, async (transaction) => {
    await requireManager(transaction.connection, input.managerUserId);
    const current = await findModerationBookCase(
      transaction.connection,
      requireUuid(input.caseId, "caseId"),
      { forUpdate: true },
    );
    if (!current) throw new ModerationInputError("CASE_NOT_FOUND", "Випадок не знайдено.");
    if (current.subjectType === "book" && current.triggerType !== "submission") {
      throw new ModerationInputError(
        "ACTION_NOT_ALLOWED",
        "Для опублікованої Книжки оберіть окрему дію.",
      );
    }
    const action: ModerationDecisionAction = current.subjectType === "book_update"
      ? "reject_update"
      : current.subjectType === "review"
        ? "do_not_publish_review"
        : "reject_publication";
    const needsReason = action === "reject_publication" || action === "reject_update";
    if (needsReason && !isReasonCategoryCode(input.reasonCategoryCode)) {
      throw new ModerationInputError("REASON_CATEGORY", "Оберіть Категорію причини.");
    }
    if (!needsReason && input.reasonCategoryCode !== undefined) {
      throw new ModerationInputError(
        "REASON_NOT_SUPPORTED",
        "Для відгуку Категорія причини не підтримується.",
      );
    }
    const decision = await insertDecision(transaction.connection, current, input, action, {
      reasonCategoryCode: needsReason ? input.reasonCategoryCode : undefined,
    });
    if (decision.repeated) return;
    await transaction.connection.query(
      "UPDATE moderation_cases SET status = 'rejected', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [current.id],
    );
    if (action === "reject_publication") {
      const reasonCategoryCode = input.reasonCategoryCode!;
      await transaction.connection.query(
        `
          UPDATE publishing_books
          SET status = 'rejected', rejection_category = $1,
              rejection_reason_code = $2, rejection_reason_copy_version = $3,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `,
        [
          REASON_CATEGORY_LABELS[reasonCategoryCode],
          reasonCategoryCode,
          REASON_CATEGORY_COPY_VERSION,
          current.bookId,
        ],
      );
    }
    await emitDecision(
      transaction,
      current,
      input,
      decision.id,
      action,
      needsReason ? input.reasonCategoryCode : undefined,
    );
  });
}

export function doNotPublishReviewModerationCase(
  database: SqlDatabase,
  input: ManagerDecisionBase,
): Promise<void> {
  return rejectModerationCase(database, input);
}

export async function keepPublishedModerationCase(
  database: SqlDatabase,
  input: ManagerDecisionBase,
): Promise<void> {
  await withDomainTransaction(database, async (transaction) => {
    await requireManager(transaction.connection, input.managerUserId);
    const current = await findModerationBookCase(
      transaction.connection,
      requireUuid(input.caseId, "caseId"),
      { forUpdate: true },
    );
    if (
      !current ||
      current.subjectType !== "book" ||
      current.triggerType !== "post_publication_risk" ||
      !current.isPublished
    ) {
      throw new ModerationInputError("ACTION_NOT_ALLOWED", "Ця дія не підходить для випадку.");
    }
    const decision = await insertDecision(transaction.connection, current, input, "keep_published");
    if (decision.repeated) return;
    await transaction.connection.query(
      "UPDATE moderation_cases SET status = 'approved', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [current.id],
    );
    await emitDecision(transaction, current, input, decision.id, "keep_published");
  });
}

export async function removePublishedBook(
  database: SqlDatabase,
  input: RemovePublishedBookInput,
): Promise<void> {
  if (input.confirmed !== true) {
    throw new ModerationInputError("CONFIRMATION_REQUIRED", "Підтвердьте прибирання Книжки.");
  }
  if (!isRemovalGround(input.removalGround)) {
    throw new ModerationInputError("REMOVAL_GROUND", "Оберіть підставу прибирання.");
  }
  await withDomainTransaction(database, async (transaction) => {
    await requireManager(transaction.connection, input.managerUserId);
    const current = await findModerationBookCase(
      transaction.connection,
      requireUuid(input.caseId, "caseId"),
      { forUpdate: true },
    );
    if (
      !current ||
      current.subjectType !== "book" ||
      current.triggerType !== "post_publication_risk" ||
      !current.isPublished
    ) {
      throw new ModerationInputError("ACTION_NOT_ALLOWED", "Ця дія не підходить для випадку.");
    }
    const decision = await insertDecision(
      transaction.connection,
      current,
      input,
      "remove_publication",
      {
        removalGround: input.removalGround,
      },
    );
    if (decision.repeated) return;
    await transaction.connection.query(
      "UPDATE moderation_cases SET status = 'removed', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [current.id],
    );
    const removalEvent = await transaction.emit({
      aggregateId: current.bookId,
      aggregateType: "Book",
      correlationId: current.id,
      eventType: "PublicationRemoved",
      eventVersion: 1,
      idempotencyKey: `publication.removed:${decision.id}`,
      payload: {
        bookId: current.bookId,
        bookVersionId: current.bookVersionId,
        caseId: current.id,
        decisionId: decision.id,
      },
      topic: "publication.removed.v1",
    });
    const publication = await transaction.connection.query<{ revision: number }>(
      `
        UPDATE book_publications
        SET state = 'unavailable', removal_decision_id = $1,
            revision = revision + 1, removed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE book_id = $2 AND active_book_version_id = $3 AND state = 'published'
        RETURNING revision
      `,
      [decision.id, current.bookId, current.bookVersionId],
    );
    if (!publication.rows[0]) {
      throw new ModerationConflictError("NOT_PUBLISHED", "Книжка вже недоступна.");
    }
    await transaction.connection.query(
      `
        INSERT INTO publication_audit_events (
          id, book_id, book_version_id, case_id, decision_id, event_type,
          actor_type, actor_user_id, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, 'removed', 'manager', $6, $7)
      `,
      [
        randomUUID(),
        current.bookId,
        current.bookVersionId,
        current.id,
        decision.id,
        input.managerUserId,
        `publication.audit.removed:${decision.id}`,
      ],
    );
    await transaction.connection.query(
      `
        UPDATE catalog_book_read_models
        SET availability = 'unavailable', source_event_id = $1,
            projection_revision = COALESCE(projection_revision, 0) + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE book_id = $2 AND source_book_version_id = $3
      `,
      [removalEvent.id, current.bookId, current.bookVersionId],
    );
    await transaction.connection.query(
      `
        UPDATE publishing_books
        SET status = 'unavailable', rejection_category = NULL,
            rejection_reason_code = NULL, rejection_reason_copy_version = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [current.bookId],
    );
    await emitDecision(
      transaction,
      current,
      input,
      decision.id,
      "remove_publication",
    );
  });
}

export async function createPostPublicationRiskCase(
  database: SqlDatabase,
  input: {
    readonly bookId: string;
    readonly idempotencyKey: string;
    readonly signals: readonly ModerationInternalSignal[];
  },
): Promise<string> {
  const signals = normalizeInternalSignals(input.signals);
  if (signals.length === 0) {
    throw new ModerationInputError("SIGNALS_REQUIRED", "Потрібен структурований сигнал ризику.");
  }
  return withDomainTransaction(database, async (transaction) => {
    const publication = await transaction.connection.query<{
      active_book_version_id: string;
    }>(
      `
        SELECT active_book_version_id
        FROM book_publications
        WHERE book_id = $1 AND state = 'published'
        FOR UPDATE
      `,
      [requireUuid(input.bookId, "bookId")],
    );
    const activeVersionId = publication.rows[0]?.active_book_version_id;
    if (!activeVersionId) {
      throw new ModerationConflictError("NOT_PUBLISHED", "Книжка не опублікована.");
    }
    const idempotencyKey = `moderation.published-risk:${requireIdempotencyKey(input.idempotencyKey)}`;
    const inserted = await transaction.connection.query<{ id: string }>(
      `
        INSERT INTO moderation_cases (
          id, subject_type, subject_id, subject_version_id, trigger_type,
          idempotency_key, status
        ) VALUES ($1, 'book', $2, $3, 'post_publication_risk', $4, 'manual_review_pending')
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [randomUUID(), input.bookId, activeVersionId, idempotencyKey],
    );
    let caseId = inserted.rows[0]?.id;
    if (!caseId) {
      const existing = await transaction.connection.query<{ id: string }>(
        "SELECT id FROM moderation_cases WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      caseId = existing.rows[0]?.id;
    }
    if (!caseId) throw new Error("Unable to recover published-risk moderation case");
    if (inserted.rows[0]) {
      await transaction.connection.query(
        "INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id) VALUES ($1, $2, $3)",
        [caseId, input.bookId, activeVersionId],
      );
      await transaction.connection.query(
        `
          INSERT INTO moderation_screening_runs (
            id, case_id, attempt, adapter_id, policy_version, result, internal_signals
          ) VALUES ($1, $2, 1, 'published-risk-report-v1', $3, 'flagged', $4::jsonb)
        `,
        [randomUUID(), caseId, MODERATION_POLICY_VERSION, JSON.stringify(signals)],
      );
      const created = await findModerationBookCase(transaction.connection, caseId);
      if (!created) throw new Error("Unable to load published-risk moderation case");
      await emitManualReviewRequested(transaction, created);
    }
    return caseId;
  });
}

/**
 * Typed ingress seam for UNIT-06/UNIT-08. Those owning units provide the
 * Review/BookUpdate identifier while moderation keeps only immutable Book
 * context and emits a decision event; it never mutates their future tables.
 */
export async function createRelatedModerationCase(
  database: SqlDatabase,
  input: {
    readonly subjectType: "book_update" | "review";
    readonly subjectId: string;
    readonly bookId: string;
    readonly bookVersionId: string;
    readonly idempotencyKey: string;
    readonly signals: readonly ModerationInternalSignal[];
  },
): Promise<string> {
  const signals = normalizeInternalSignals(input.signals);
  if (signals.length === 0) {
    throw new ModerationInputError("SIGNALS_REQUIRED", "Потрібен структурований сигнал ризику.");
  }
  return withDomainTransaction(database, async (transaction) => {
    const version = await transaction.connection.query<{ id: string }>(
      `
        SELECT id FROM publishing_book_versions
        WHERE id = $1 AND book_id = $2
      `,
      [requireUuid(input.bookVersionId, "bookVersionId"), requireUuid(input.bookId, "bookId")],
    );
    if (!version.rows[0]) {
      throw new ModerationInputError("VERSION_NOT_FOUND", "Версію Книжки не знайдено.");
    }
    const idempotencyKey = `moderation.related:${requireIdempotencyKey(input.idempotencyKey)}`;
    const inserted = await transaction.connection.query<{ id: string }>(
      `
        INSERT INTO moderation_cases (
          id, subject_type, subject_id, subject_version_id, trigger_type,
          idempotency_key, status
        ) VALUES ($1, $2, $3, $3, 'submission', $4, 'manual_review_pending')
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [randomUUID(), input.subjectType, requireUuid(input.subjectId, "subjectId"), idempotencyKey],
    );
    let caseId = inserted.rows[0]?.id;
    if (!caseId) {
      const existing = await transaction.connection.query<{ id: string }>(
        "SELECT id FROM moderation_cases WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      caseId = existing.rows[0]?.id;
    }
    if (!caseId) throw new Error("Unable to recover related moderation case");
    if (inserted.rows[0]) {
      await transaction.connection.query(
        "INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id) VALUES ($1, $2, $3)",
        [caseId, input.bookId, input.bookVersionId],
      );
      await transaction.connection.query(
        `
          INSERT INTO moderation_screening_runs (
            id, case_id, attempt, adapter_id, policy_version, result, internal_signals
          ) VALUES ($1, $2, 1, 'related-subject-ingress-v1', $3, 'flagged', $4::jsonb)
        `,
        [randomUUID(), caseId, MODERATION_POLICY_VERSION, JSON.stringify(signals)],
      );
      const created = await findModerationBookCase(transaction.connection, caseId);
      if (!created) throw new Error("Unable to load related moderation case");
      await emitManualReviewRequested(transaction, created);
    }
    return caseId;
  });
}

function managerQueueItem(moderationCase: StoredModerationBookCase): ManagerModerationQueueItem {
  const safeFail = moderationCase.screeningResult === "provider_error";
  const aiSignal = safeFail
    ? "Сервіс ШІ недоступний — потрібна ручна перевірка"
    : moderationCase.internalSignals.map((signal) => signal.label).join(" · ") || "Потрібна ручна перевірка";
  return {
    aiSignal,
    authorPublicName: moderationCase.authorPublicName,
    coverUrl: `/api/admin/moderation/cases/${moderationCase.id}/objects/${moderationCase.coverObjectId}`,
    id: moderationCase.id,
    isPublished: moderationCase.isPublished,
    revision: moderationCase.revision,
    safeFail,
    status: "manual_review_pending",
    subjectType: moderationCase.subjectType,
    submittedAt: moderationCase.submittedAt,
    title: moderationCase.title,
  };
}

function previewFragment(preview: PreviewDocument): string {
  return preview.sections
    .flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) => block.kind === "paragraph" ? [block.text] : []),
    ])
    .join("\n\n")
    .slice(0, 1_600);
}

export async function loadManagerModerationQueue(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  options: {
    readonly subjectType?: ModerationSubjectType | "all";
    readonly selectedCaseId?: string | null;
  } = {},
): Promise<ManagerModerationQueueReadModel> {
  const selectedType = options.subjectType ?? "all";
  const [counts, cases] = await Promise.all([
    pendingModerationCounts(database),
    listPendingModerationBookCases(database, selectedType),
  ]);
  const selectedId = options.selectedCaseId ?? cases[0]?.id ?? null;
  const selectedCase = selectedId
    ? await findModerationBookCase(database, requireUuid(selectedId, "selectedCaseId"))
    : null;
  const selected = selectedCase?.status === "manual_review_pending" &&
    (selectedType === "all" || selectedCase.subjectType === selectedType)
    ? {
        ...managerQueueItem(selectedCase),
        fragment: previewFragment(await readPreview(storage, selectedCase.previewStorageKey)),
        internalSignals: selectedCase.internalSignals,
      }
    : null;
  return {
    filters: { counts, selectedType },
    items: cases.map(managerQueueItem),
    reasonCategories: REASON_CATEGORY_OPTIONS,
    removalGrounds: REMOVAL_GROUND_OPTIONS,
    selected,
  };
}

export async function loadAuthorBookManagement(
  database: SqlDatabase,
  authorId: string,
  bookId: string,
): Promise<AuthorBookManagementReadModel | null> {
  const result = await database.query<{
    author_public_name: string;
    book_id: string;
    cover_object_id: string | null;
    publication_state: "published" | "unavailable" | null;
    rejection_reason_code: string | null;
    rejection_reason_copy_version: number | null;
    status: AuthorBookManagementReadModel["status"];
    title: string;
    updated_at: Date | string;
  }>(
    `
      SELECT book.id AS book_id, book.title, book.status,
             book.rejection_reason_code, book.rejection_reason_copy_version,
             book.updated_at, profile.public_name AS author_public_name,
             publication.state AS publication_state,
             COALESCE(publication_version.cover_object_id, latest_version.cover_object_id)
               AS cover_object_id
      FROM publishing_books book
      JOIN author_profiles profile ON profile.user_id = book.author_id
      LEFT JOIN book_publications publication ON publication.book_id = book.id
      LEFT JOIN publishing_book_versions publication_version
        ON publication_version.id = publication.active_book_version_id
      LEFT JOIN LATERAL (
        SELECT submitted_version.cover_object_id
        FROM publishing_book_versions submitted_version
        WHERE submitted_version.book_id = book.id
        ORDER BY submitted_version.version_number DESC
        LIMIT 1
      ) latest_version ON TRUE
      WHERE book.id = $1 AND book.author_id = $2
    `,
    [requireUuid(bookId, "bookId"), requireUuid(authorId, "authorId")],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!["submitted", "manual_review", "rejected", "published", "unavailable"].includes(row.status)) {
    return null;
  }
  const reasonCategory = row.rejection_reason_code && isReasonCategoryCode(row.rejection_reason_code)
    ? reasonCategoryOption(row.rejection_reason_code)
    : null;
  return {
    authorPublicName: row.author_public_name,
    availability: row.publication_state ?? "not_published",
    coverUrl: row.cover_object_id
      ? `/api/author/publishing/objects/${row.cover_object_id}`
      : null,
    id: row.book_id,
    publicHref: row.publication_state ? `/books/${row.book_id}` : null,
    reasonCategory,
    status: row.status,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function findManagerCaseObject(
  executor: SqlExecutor,
  caseId: string,
  objectId: string,
): Promise<null | {
  readonly byteLength: number;
  readonly id: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly storageKey: string;
}> {
  const result = await executor.query<{
    byte_length: number | string;
    id: string;
    media_type: string;
    object_kind: string;
    storage_key: string;
  }>(
    `
      SELECT object.id, object.object_kind, object.storage_key,
             object.media_type, object.byte_length
      FROM moderation_book_subjects subject
      JOIN publishing_book_versions version ON version.id = subject.book_version_id
      JOIN publishing_private_objects object ON object.id = $2
      WHERE subject.case_id = $1
        AND object.id = ANY(ARRAY[
          version.manuscript_object_id,
          version.cover_object_id,
          version.preview_object_id,
          version.epub_object_id,
          version.mobi_object_id
        ])
    `,
    [requireUuid(caseId, "caseId"), requireUuid(objectId, "objectId")],
  );
  const row = result.rows[0];
  return row
    ? {
        byteLength: Number(row.byte_length),
        id: row.id,
        kind: row.object_kind,
        mediaType: row.media_type,
        storageKey: row.storage_key,
      }
    : null;
}
