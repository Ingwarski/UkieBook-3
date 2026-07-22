import "server-only";

import { randomUUID } from "node:crypto";

import type { SqlExecutor } from "../../platform/sql-port";
import type {
  AuthorBookListItem,
  ManuscriptSourceType,
  PublishingDraftStatus,
  PublishingGenre,
  PublishingPrivateObject,
  PublishingPrivateObjectKind,
} from "../types";

export interface StoredDraftRecord {
  readonly bookId: string;
  readonly draftId: string;
  readonly authorId: string;
  readonly authorPublicName: string;
  readonly revision: number;
  readonly currentStep: number;
  readonly status: PublishingDraftStatus;
  readonly title: string;
  readonly description: string;
  readonly sourceType: ManuscriptSourceType | null;
  readonly sourceReference: string | null;
  readonly manuscriptObjectId: string | null;
  readonly sourceName: string | null;
  readonly genreSlug: string | null;
  readonly basePriceKopiykas: number | null;
  readonly sampleSectionIndex: number | null;
  readonly samplePreviewArtifactId: string | null;
  readonly coverMode: "uploaded" | "fallback";
  readonly coverObjectId: string | null;
  readonly conversionFailureCode: string | null;
  readonly conversionFailureMessage: string | null;
  readonly previewArtifactId: string | null;
  readonly previewStorageKey: string | null;
  readonly previewCreatedAt: string | null;
  readonly epubObjectId: string | null;
  readonly mobiObjectId: string | null;
  readonly updatedAt: string;
}

interface DraftRow extends Record<string, unknown> {
  book_id: string;
  draft_id: string;
  author_id: string;
  author_public_name: string;
  revision: number;
  current_step: number;
  status: PublishingDraftStatus;
  title: string;
  description: string;
  source_type: ManuscriptSourceType | null;
  source_reference: string | null;
  manuscript_object_id: string | null;
  source_name: string | null;
  genre_slug: string | null;
  base_price_kopiykas: number | null;
  sample_section_index: number | null;
  sample_preview_artifact_id: string | null;
  cover_mode: "uploaded" | "fallback";
  cover_object_id: string | null;
  conversion_failure_code: string | null;
  conversion_failure_message: string | null;
  preview_artifact_id: string | null;
  preview_storage_key: string | null;
  preview_created_at: Date | string | null;
  epub_object_id: string | null;
  mobi_object_id: string | null;
  updated_at: Date | string;
}

const draftProjection = `
  d.book_id,
  d.id AS draft_id,
  b.author_id,
  profile.public_name AS author_public_name,
  d.revision,
  d.current_step,
  d.status,
  d.title,
  d.description,
  d.source_type,
  d.source_reference,
  d.manuscript_object_id,
  manuscript.original_name AS source_name,
  d.genre_slug,
  d.base_price_kopiykas,
  d.sample_section_index,
  d.sample_preview_artifact_id,
  d.cover_mode,
  d.cover_object_id,
  d.conversion_failure_code,
  d.conversion_failure_message,
  latest_preview.id AS preview_artifact_id,
  latest_preview.preview_storage_key,
  latest_preview.created_at AS preview_created_at,
  latest_preview.epub_object_id,
  latest_preview.mobi_object_id,
  d.updated_at
`;

const draftJoins = `
  JOIN publishing_books b ON b.id = d.book_id
  JOIN author_profiles profile ON profile.user_id = b.author_id
  LEFT JOIN publishing_private_objects manuscript ON manuscript.id = d.manuscript_object_id
  LEFT JOIN LATERAL (
    SELECT
      artifact.id,
      artifact.created_at,
      artifact.epub_object_id,
      artifact.mobi_object_id,
      preview_object.storage_key AS preview_storage_key
    FROM publishing_preview_artifacts artifact
    JOIN publishing_conversion_runs conversion_run
      ON conversion_run.id = artifact.conversion_run_id
    JOIN publishing_private_objects preview_object ON preview_object.id = artifact.preview_object_id
    WHERE artifact.draft_id = d.id
      AND conversion_run.draft_revision = d.revision
      AND conversion_run.status = 'completed'
    ORDER BY artifact.created_at DESC, artifact.id DESC
    LIMIT 1
  ) latest_preview ON TRUE
`;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function mapDraft(row: DraftRow): StoredDraftRecord {
  return {
    authorId: row.author_id,
    authorPublicName: row.author_public_name,
    basePriceKopiykas: row.base_price_kopiykas,
    bookId: row.book_id,
    conversionFailureCode: row.conversion_failure_code,
    conversionFailureMessage: row.conversion_failure_message,
    coverMode: row.cover_mode,
    coverObjectId: row.cover_object_id,
    currentStep: row.current_step,
    description: row.description,
    draftId: row.draft_id,
    epubObjectId: row.epub_object_id,
    genreSlug: row.genre_slug,
    manuscriptObjectId: row.manuscript_object_id,
    mobiObjectId: row.mobi_object_id,
    previewArtifactId: row.preview_artifact_id,
    previewCreatedAt: iso(row.preview_created_at),
    previewStorageKey: row.preview_storage_key,
    revision: row.revision,
    sampleSectionIndex: row.sample_section_index,
    samplePreviewArtifactId: row.sample_preview_artifact_id,
    sourceName: row.source_name,
    sourceReference: row.source_reference,
    sourceType: row.source_type,
    status: row.status,
    title: row.title,
    updatedAt: iso(row.updated_at)!,
  };
}

export async function createBookAndDraft(
  executor: SqlExecutor,
  authorId: string,
): Promise<{ readonly bookId: string; readonly draftId: string }> {
  const bookId = randomUUID();
  const draftId = randomUUID();
  await executor.query(
    `
      INSERT INTO publishing_books (id, author_id)
      VALUES ($1, $2)
    `,
    [bookId, authorId],
  );
  await executor.query(
    `
      INSERT INTO publishing_book_drafts (id, book_id)
      VALUES ($1, $2)
    `,
    [draftId, bookId],
  );
  return { bookId, draftId };
}

export async function findDraftForAuthor(
  executor: SqlExecutor,
  authorId: string,
  draftId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<StoredDraftRecord | null> {
  if (!uuidPattern.test(draftId)) return null;
  const result = await executor.query<DraftRow>(
    `
      SELECT ${draftProjection}
      FROM publishing_book_drafts d
      ${draftJoins}
      WHERE d.id = $1 AND b.author_id = $2
      ${options.forUpdate ? "FOR UPDATE OF d, b" : ""}
    `,
    [draftId, authorId],
  );
  return result.rows[0] ? mapDraft(result.rows[0]) : null;
}

export async function findLatestOpenDraftForAuthor(
  executor: SqlExecutor,
  authorId: string,
): Promise<StoredDraftRecord | null> {
  const result = await executor.query<DraftRow>(
    `
      SELECT ${draftProjection}
      FROM publishing_book_drafts d
      ${draftJoins}
      WHERE b.author_id = $1 AND d.status <> 'submitted'
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT 1
    `,
    [authorId],
  );
  return result.rows[0] ? mapDraft(result.rows[0]) : null;
}

export async function listGenres(executor: SqlExecutor): Promise<PublishingGenre[]> {
  const result = await executor.query<{ label: string; slug: string }>(
    "SELECT slug, label FROM catalog_genres ORDER BY label, slug",
  );
  return result.rows;
}

export async function listAuthorBooks(
  executor: SqlExecutor,
  authorId: string,
): Promise<AuthorBookListItem[]> {
  const result = await executor.query<{
    book_id: string;
    cover_object_id: string | null;
    current_step: number | null;
    draft_id: string | null;
    draft_status: PublishingDraftStatus | null;
    rejection_category: string | null;
    status: AuthorBookListItem["status"];
    title: string;
    updated_at: Date | string;
  }>(
    `
      SELECT
        b.id AS book_id,
        draft.id AS draft_id,
        draft.current_step,
        draft.status AS draft_status,
        COALESCE(draft.title, b.title) AS title,
        b.status,
        b.rejection_category,
        draft.cover_object_id,
        b.updated_at
      FROM publishing_books b
      LEFT JOIN LATERAL (
        SELECT d.id, d.title, d.cover_object_id, d.current_step, d.status
        FROM publishing_book_drafts d
        WHERE d.book_id = b.id
        ORDER BY d.revision DESC, d.id DESC
        LIMIT 1
      ) draft ON TRUE
      WHERE b.author_id = $1
      ORDER BY b.updated_at DESC, b.id DESC
    `,
    [authorId],
  );
  return result.rows.map((row) => ({
    coverUrl: row.cover_object_id
      ? `/api/author/publishing/objects/${row.cover_object_id}`
      : null,
    currentStep: row.current_step,
    draftId: row.draft_id,
    draftStatus: row.draft_status,
    id: row.book_id,
    rejectionCategory: row.rejection_category,
    salesCount: row.status === "published" ? 0 : null,
    status: row.status,
    title: row.title,
    updatedAt: iso(row.updated_at)!,
  }));
}

interface PrivateObjectRow extends Record<string, unknown> {
  id: string;
  owner_user_id: string;
  object_kind: PublishingPrivateObjectKind;
  storage_key: string;
  sha256: string;
  byte_length: number | string;
  media_type: string;
  original_name: string | null;
  created_at: Date | string;
}

function mapPrivateObject(row: PrivateObjectRow): PublishingPrivateObject {
  return {
    byteLength: Number(row.byte_length),
    createdAt: iso(row.created_at)!,
    id: row.id,
    kind: row.object_kind,
    mediaType: row.media_type,
    originalName: row.original_name,
    ownerUserId: row.owner_user_id,
    sha256: row.sha256,
    storageKey: row.storage_key,
  };
}

export async function findPrivateObjectForAuthor(
  executor: SqlExecutor,
  authorId: string,
  objectId: string,
): Promise<PublishingPrivateObject | null> {
  if (!uuidPattern.test(objectId)) return null;
  const result = await executor.query<PrivateObjectRow>(
    `
      SELECT *
      FROM publishing_private_objects
      WHERE id = $1 AND owner_user_id = $2
    `,
    [objectId, authorId],
  );
  return result.rows[0] ? mapPrivateObject(result.rows[0]) : null;
}

export async function listDraftIllustrations(
  executor: SqlExecutor,
  authorId: string,
  draftId: string,
): Promise<
  Array<{
    readonly anchorLabel: string;
    readonly id: string;
    readonly name: string;
    readonly objectId: string;
    readonly ordinal: number;
  }>
> {
  const result = await executor.query<{
    anchor_label: string;
    id: string;
    object_id: string;
    ordinal: number;
    original_name: string | null;
  }>(
    `
      SELECT placement.id, placement.object_id, placement.ordinal,
             placement.anchor_label, object.original_name
      FROM publishing_draft_illustrations placement
      JOIN publishing_book_drafts draft ON draft.id = placement.draft_id
      JOIN publishing_books book ON book.id = draft.book_id
      JOIN publishing_private_objects object ON object.id = placement.object_id
      WHERE placement.draft_id = $1 AND book.author_id = $2
      ORDER BY placement.ordinal, placement.id
    `,
    [draftId, authorId],
  );
  return result.rows.map((row) => ({
    anchorLabel: row.anchor_label,
    id: row.id,
    name: row.original_name ?? `Ілюстрація ${row.ordinal + 1}`,
    objectId: row.object_id,
    ordinal: row.ordinal,
  }));
}
