import "server-only";

import type { SqlExecutor } from "../../platform/sql-port";
import type {
  BookLifecycleStatus,
  ModerationCaseStatus,
  ModerationInternalSignal,
  ModerationSubjectType,
  ModerationTriggerType,
} from "../types";

export interface StoredModerationBookCase {
  readonly id: string;
  readonly revision: number;
  readonly status: ModerationCaseStatus;
  readonly triggerType: ModerationTriggerType;
  readonly subjectType: ModerationSubjectType;
  readonly subjectId: string;
  readonly subjectVersionId: string;
  readonly sourceEventId: string | null;
  readonly bookId: string;
  readonly bookVersionId: string;
  readonly authorId: string;
  readonly authorPublicName: string;
  readonly title: string;
  readonly description: string;
  readonly genreSlug: string;
  readonly basePriceKopiykas: number;
  readonly sampleSectionIndex: number;
  readonly manuscriptObjectId: string;
  readonly coverObjectId: string;
  readonly coverStorageKey: string;
  readonly coverMediaType: string;
  readonly previewObjectId: string;
  readonly previewStorageKey: string;
  readonly submittedAt: string;
  readonly bookStatus: BookLifecycleStatus;
  readonly isPublished: boolean;
  readonly screeningResult: "clear" | "flagged" | "provider_error" | null;
  readonly internalSignals: readonly ModerationInternalSignal[];
}

interface ModerationBookCaseRow extends Record<string, unknown> {
  id: string;
  revision: number;
  status: ModerationCaseStatus;
  trigger_type: ModerationTriggerType;
  subject_type: ModerationSubjectType;
  subject_id: string;
  subject_version_id: string;
  source_event_id: string | null;
  book_id: string;
  book_version_id: string;
  author_id: string;
  author_public_name: string;
  title: string;
  description: string;
  genre_slug: string;
  base_price_kopiykas: number;
  sample_section_index: number;
  manuscript_object_id: string;
  cover_object_id: string;
  cover_storage_key: string;
  cover_media_type: string;
  preview_object_id: string;
  preview_storage_key: string;
  submitted_at: Date | string;
  book_status: BookLifecycleStatus;
  publication_state: "published" | "unavailable" | null;
  screening_result: "clear" | "flagged" | "provider_error" | null;
  internal_signals: unknown;
}

function internalSignals(value: unknown): ModerationInternalSignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ModerationInternalSignal[] => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("code" in candidate) ||
      !("label" in candidate) ||
      !("severity" in candidate) ||
      typeof candidate.code !== "string" ||
      typeof candidate.label !== "string" ||
      !["info", "warning", "critical"].includes(String(candidate.severity))
    ) {
      return [];
    }
    return [{
      code: candidate.code,
      label: candidate.label,
      severity: candidate.severity as ModerationInternalSignal["severity"],
    }];
  });
}

function mapBookCase(row: ModerationBookCaseRow): StoredModerationBookCase {
  return {
    authorId: row.author_id,
    authorPublicName: row.author_public_name,
    basePriceKopiykas: row.base_price_kopiykas,
    bookId: row.book_id,
    bookStatus: row.book_status,
    bookVersionId: row.book_version_id,
    coverMediaType: row.cover_media_type,
    coverObjectId: row.cover_object_id,
    coverStorageKey: row.cover_storage_key,
    description: row.description,
    genreSlug: row.genre_slug,
    id: row.id,
    internalSignals: internalSignals(row.internal_signals),
    isPublished: row.publication_state === "published",
    manuscriptObjectId: row.manuscript_object_id,
    previewObjectId: row.preview_object_id,
    previewStorageKey: row.preview_storage_key,
    revision: row.revision,
    sampleSectionIndex: row.sample_section_index,
    screeningResult: row.screening_result,
    sourceEventId: row.source_event_id,
    status: row.status,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    subjectVersionId: row.subject_version_id,
    submittedAt: new Date(row.submitted_at).toISOString(),
    title: row.title,
    triggerType: row.trigger_type,
  };
}

const bookCaseProjection = `
  c.id,
  c.revision,
  c.status,
  c.trigger_type,
  c.subject_type,
  c.subject_id,
  c.subject_version_id,
  c.source_event_id,
  subject.book_id,
  subject.book_version_id,
  version.author_id,
  profile.public_name AS author_public_name,
  version.title,
  version.description,
  version.genre_slug,
  version.base_price_kopiykas,
  version.sample_section_index,
  version.manuscript_object_id,
  version.cover_object_id,
  cover.storage_key AS cover_storage_key,
  cover.media_type AS cover_media_type,
  version.preview_object_id,
  preview.storage_key AS preview_storage_key,
  version.submitted_at,
  book.status AS book_status,
  publication.state AS publication_state,
  screening.result AS screening_result,
  screening.internal_signals
`;

const bookCaseJoins = `
  JOIN moderation_book_subjects subject ON subject.case_id = c.id
  JOIN publishing_book_versions version ON version.id = subject.book_version_id
  JOIN publishing_books book ON book.id = subject.book_id
  JOIN author_profiles profile ON profile.user_id = version.author_id
  JOIN publishing_private_objects cover ON cover.id = version.cover_object_id
  JOIN publishing_private_objects preview ON preview.id = version.preview_object_id
  LEFT JOIN book_publications publication ON publication.book_id = subject.book_id
  LEFT JOIN LATERAL (
    SELECT run.result, run.internal_signals
    FROM moderation_screening_runs run
    WHERE run.case_id = c.id
    ORDER BY run.attempt DESC
    LIMIT 1
  ) screening ON TRUE
`;

export async function findModerationBookCase(
  executor: SqlExecutor,
  caseId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<StoredModerationBookCase | null> {
  const result = await executor.query<ModerationBookCaseRow>(
    `
      SELECT ${bookCaseProjection}
      FROM moderation_cases c
      ${bookCaseJoins}
      WHERE c.id = $1
      ${options.forUpdate ? "FOR UPDATE OF c" : ""}
    `,
    [caseId],
  );
  return result.rows[0] ? mapBookCase(result.rows[0]) : null;
}

export async function listPendingModerationBookCases(
  executor: SqlExecutor,
  subjectType: ModerationSubjectType | "all",
): Promise<StoredModerationBookCase[]> {
  const result = await executor.query<ModerationBookCaseRow>(
    `
      SELECT ${bookCaseProjection}
      FROM moderation_cases c
      ${bookCaseJoins}
      WHERE c.status = 'manual_review_pending'
        AND ($1::text = 'all' OR c.subject_type = $1::text)
      ORDER BY c.created_at ASC, c.id ASC
    `,
    [subjectType],
  );
  return result.rows.map(mapBookCase);
}

export async function pendingModerationCounts(executor: SqlExecutor): Promise<{
  readonly all: number;
  readonly book: number;
  readonly book_update: number;
  readonly review: number;
}> {
  const result = await executor.query<{
    all_count: number;
    book_count: number;
    book_update_count: number;
    review_count: number;
  }>(`
    SELECT
      COUNT(*)::int AS all_count,
      COUNT(*) FILTER (WHERE subject_type = 'book')::int AS book_count,
      COUNT(*) FILTER (WHERE subject_type = 'book_update')::int AS book_update_count,
      COUNT(*) FILTER (WHERE subject_type = 'review')::int AS review_count
    FROM moderation_cases
    WHERE status = 'manual_review_pending'
  `);
  const row = result.rows[0];
  return {
    all: row?.all_count ?? 0,
    book: row?.book_count ?? 0,
    book_update: row?.book_update_count ?? 0,
    review: row?.review_count ?? 0,
  };
}

export interface PublicCoverObjectRecord {
  readonly id: string;
  readonly mediaType: string;
  readonly storageKey: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly availability: "published" | "unavailable";
}

export async function findPublicCoverObject(
  executor: SqlExecutor,
  bookId: string,
): Promise<PublicCoverObjectRecord | null> {
  const result = await executor.query<{
    availability: "published" | "unavailable";
    byte_length: number | string;
    id: string;
    media_type: string;
    sha256: string;
    storage_key: string;
  }>(
    `
      SELECT object.id, object.storage_key, object.media_type, object.byte_length,
             object.sha256, publication.state AS availability
      FROM book_publications publication
      JOIN publishing_book_versions version ON version.id = publication.active_book_version_id
      JOIN publishing_private_objects object ON object.id = version.cover_object_id
      WHERE publication.book_id = $1
    `,
    [bookId],
  );
  const row = result.rows[0];
  return row
    ? {
        availability: row.availability,
        byteLength: Number(row.byte_length),
        id: row.id,
        mediaType: row.media_type,
        sha256: row.sha256,
        storageKey: row.storage_key,
      }
    : null;
}
