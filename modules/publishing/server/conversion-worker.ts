import { randomUUID } from "node:crypto";

import {
  ArtifactValidationError,
  CalibreEbookConverter,
  ConversionEngineUnavailableError,
  createPreviewDocument,
  ManuscriptIngestionError,
  prepareManuscript,
  sha256,
  type ManuscriptBlock,
  type ManuscriptIllustration,
  type ManuscriptSource,
  type NormalizedManuscript,
} from "../conversion";
import type { DurableJob } from "../../platform/durable-jobs";
import type { SqlDatabase } from "../../platform/sql-port";
import { withSqlTransaction } from "../../platform/sql-port";
import type { PrivateObjectStorage } from "../storage/private-object-storage";
import { persistPrivateBuffer } from "../storage/private-object-persistence";
import { PUBLISHING_SCHEMA_VERSION, safeConversionMessage, type PreviewDocument } from "../types";

interface ConversionPayload {
  readonly authorId: string;
  readonly conversionRunId: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly fingerprint: string;
}

interface ConversionInputRow extends Record<string, unknown> {
  adapter_id: string;
  author_id: string;
  author_public_name: string;
  book_id: string;
  cover_media_type: string;
  cover_name: string | null;
  cover_storage_key: string;
  draft_id: string;
  draft_revision: number;
  input_sha256: string;
  manuscript_media_type: string;
  manuscript_name: string | null;
  manuscript_storage_key: string;
  pipeline_version: number;
  run_status: "completed" | "failed" | "queued" | "running";
  source_reference: string | null;
  source_type: "docx" | "google_docs" | "txt";
  title: string;
}

interface ExternalIllustrationRow extends Record<string, unknown> {
  anchor_label: string;
  media_type: string;
  object_id: string;
  original_name: string | null;
  sha256: string;
  storage_key: string;
}

function payloadFromJob(job: DurableJob): ConversionPayload {
  const payload = job.payload as Record<string, unknown>;
  const authorId = payload.authorId;
  const conversionRunId = payload.conversionRunId;
  const draftId = payload.draftId;
  const draftRevision = payload.draftRevision;
  const fingerprint = payload.fingerprint;
  if (
    typeof authorId !== "string" ||
    typeof conversionRunId !== "string" ||
    typeof draftId !== "string" ||
    typeof draftRevision !== "number" ||
    !Number.isInteger(draftRevision) ||
    typeof fingerprint !== "string"
  ) {
    throw new Error("Invalid publishing.convert.v1 payload");
  }
  return { authorId, conversionRunId, draftId, draftRevision, fingerprint };
}

async function loadInput(database: SqlDatabase, payload: ConversionPayload): Promise<ConversionInputRow> {
  const result = await database.query<ConversionInputRow>(
    `
      SELECT
        run.status AS run_status,
        run.input_sha256,
        run.pipeline_version,
        run.adapter_id,
        draft.id AS draft_id,
        draft.revision AS draft_revision,
        draft.source_type,
        draft.source_reference,
        draft.title,
        book.id AS book_id,
        book.author_id,
        profile.public_name AS author_public_name,
        manuscript.storage_key AS manuscript_storage_key,
        manuscript.media_type AS manuscript_media_type,
        manuscript.original_name AS manuscript_name,
        cover.storage_key AS cover_storage_key,
        cover.media_type AS cover_media_type,
        cover.original_name AS cover_name
      FROM publishing_conversion_runs run
      JOIN publishing_book_drafts draft ON draft.id = run.draft_id
      JOIN publishing_books book ON book.id = draft.book_id
      JOIN author_profiles profile ON profile.user_id = book.author_id
      JOIN publishing_private_objects manuscript ON manuscript.id = draft.manuscript_object_id
      JOIN publishing_private_objects cover ON cover.id = draft.cover_object_id
      WHERE run.id = $1 AND run.draft_id = $2 AND book.author_id = $3
    `,
    [payload.conversionRunId, payload.draftId, payload.authorId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Publishing conversion input was not found");
  if (row.input_sha256 !== payload.fingerprint) throw new Error("Conversion fingerprint mismatch");
  return row;
}

async function loadExternalIllustrations(
  database: SqlDatabase,
  draftId: string,
): Promise<ExternalIllustrationRow[]> {
  const result = await database.query<ExternalIllustrationRow>(
    `
      SELECT object.id AS object_id, object.storage_key, object.media_type,
             object.original_name, object.sha256, placement.anchor_label
      FROM publishing_draft_illustrations placement
      JOIN publishing_private_objects object ON object.id = placement.object_id
      WHERE placement.draft_id = $1
      ORDER BY placement.ordinal, placement.id
    `,
    [draftId],
  );
  return result.rows;
}

function manuscriptSource(row: ConversionInputRow, bytes: Buffer): ManuscriptSource {
  const common = {
    artifactVersion: 1 as const,
    bytes: new Uint8Array(bytes),
    fileName: row.manuscript_name ?? (row.source_type === "txt" ? "manuscript.txt" : "manuscript.docx"),
  };
  if (row.source_type === "txt") {
    return { ...common, kind: "txt", mediaType: "text/plain" };
  }
  if (row.source_type === "google_docs") {
    return {
      ...common,
      documentId: row.source_reference ?? "unknown",
      exportFormat: "docx",
      kind: "google-docs-export",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      revisionId: null,
    };
  }
  return {
    ...common,
    kind: "docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function insertExternalIllustrations(
  manuscript: NormalizedManuscript,
  illustrations: readonly ManuscriptIllustration[],
): NormalizedManuscript {
  if (illustrations.length === 0) return manuscript;
  const blocks: ManuscriptBlock[] = [...manuscript.blocks];
  const secondHeading = blocks.findIndex((block, index) => index > 0 && block.kind === "heading");
  const insertionIndex = secondHeading === -1 ? blocks.length : secondHeading;
  blocks.splice(
    insertionIndex,
    0,
    ...illustrations.map(
      (illustration): ManuscriptBlock => ({
        kind: "paragraph",
        runs: [{ illustrationId: illustration.id, kind: "illustration" }],
      }),
    ),
  );
  const contentHash = sha256(
    JSON.stringify({
      base: manuscript.contentHash,
      extraIllustrations: illustrations.map(({ contentHash: hash, id }) => ({ hash, id })),
    }),
  );
  return {
    ...manuscript,
    blocks,
    contentHash,
    illustrations: [...manuscript.illustrations, ...illustrations],
  };
}

function safeCode(error: unknown): string {
  if (error instanceof ConversionEngineUnavailableError) return "CALIBRE_UNAVAILABLE";
  if (error instanceof ManuscriptIngestionError) return "BROKEN_MANUSCRIPT";
  if (error instanceof ArtifactValidationError) {
    return error.format === "epub" ? "EPUB_INVALID" : "MOBI_INVALID";
  }
  return "UNKNOWN";
}

function serializedNormalized(manuscript: NormalizedManuscript): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        ...manuscript,
        illustrations: manuscript.illustrations.map((illustration) => ({
          altText: illustration.altText,
          contentHash: illustration.contentHash,
          fileName: illustration.fileName,
          id: illustration.id,
          mediaType: illustration.mediaType,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function createPublishingConversionHandler(options: {
  readonly database: SqlDatabase;
  readonly ebookConvertPath: string;
  readonly storage: PrivateObjectStorage;
}) {
  return async (job: DurableJob, context: { readonly signal: AbortSignal }): Promise<void> => {
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    const payload = payloadFromJob(job);
    const initial = await loadInput(options.database, payload);
    if (initial.run_status === "completed") return;
    if (initial.draft_revision !== payload.draftRevision) {
      await options.database.query(
        `
          UPDATE publishing_conversion_runs
          SET status = 'failed', failure_code = 'STALE_CONVERSION',
              failure_message = $1, completed_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND status <> 'completed'
        `,
        [safeConversionMessage("STALE_CONVERSION"), payload.conversionRunId],
      );
      return;
    }
    await options.database.query(
      `
        UPDATE publishing_conversion_runs
        SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
            failure_code = NULL, failure_message = NULL
        WHERE id = $1 AND status IN ('queued', 'running', 'failed')
      `,
      [payload.conversionRunId],
    );
    try {
      const [sourceBytes, coverBytes, externalRows] = await Promise.all([
        options.storage.read(initial.manuscript_storage_key),
        options.storage.read(initial.cover_storage_key),
        loadExternalIllustrations(options.database, payload.draftId),
      ]);
      const externalIllustrations = await Promise.all(
        externalRows.map(async (row): Promise<ManuscriptIllustration> => ({
          altText: row.anchor_label,
          bytes: new Uint8Array(await options.storage.read(row.storage_key)),
          contentHash: row.sha256,
          fileName: row.original_name ?? `${row.object_id}.png`,
          id: `external-${row.object_id}`,
          mediaType: "image/png",
        })),
      );
      const prepared = prepareManuscript({
        metadata: { authorName: initial.author_public_name, language: "uk", title: initial.title },
        source: manuscriptSource(initial, sourceBytes),
      });
      const normalized = insertExternalIllustrations(
        prepared.normalizedDocument,
        externalIllustrations,
      );
      if (context.signal.aborted) {
        throw context.signal.reason ?? new Error("Worker lease was lost");
      }
      const converter = new CalibreEbookConverter({
        executablePath: options.ebookConvertPath,
        signal: context.signal,
      });
      const conversion = await converter.convert({
        bookVersionId: payload.conversionRunId,
        cover: {
          bytes: new Uint8Array(coverBytes),
          fileName: initial.cover_name ?? "cover.png",
          mediaType: initial.cover_media_type === "image/jpeg" ? "image/jpeg" : "image/png",
        },
        manuscript: normalized,
      });
      if (context.signal.aborted) throw new Error("Worker lease was lost");

      const illustrationObjects = new Map<string, string>();
      for (const row of externalRows) illustrationObjects.set(`external-${row.object_id}`, row.object_id);
      for (const illustration of normalized.illustrations) {
        if (illustrationObjects.has(illustration.id)) continue;
        const object = await persistPrivateBuffer(options.database, options.storage, {
          authorId: payload.authorId,
          bytes: Buffer.from(illustration.bytes),
          kind: "illustration",
          mediaType: illustration.mediaType,
          originalName: illustration.fileName,
        });
        illustrationObjects.set(illustration.id, object.id);
      }
      const converterPreview = createPreviewDocument(normalized);
      const previewDocument: PreviewDocument = {
        authorPublicName: converterPreview.metadata.authorName,
        schemaVersion: PUBLISHING_SCHEMA_VERSION,
        sections: converterPreview.sections.map((section, index) => ({
          blocks: section.blocks.map((block) =>
            block.kind === "paragraph"
              ? { kind: "paragraph" as const, text: block.text }
              : {
                  alt: block.altText || `Ілюстрація ${index + 1}`,
                  kind: "illustration" as const,
                  objectId: illustrationObjects.get(block.illustrationId)!,
                },
          ),
          heading: section.heading || `Розділ ${index + 1}`,
        })),
        title: converterPreview.metadata.title,
      };
      const [normalizedObject, previewObject, epubObject, mobiObject] = await Promise.all([
        persistPrivateBuffer(options.database, options.storage, {
          authorId: payload.authorId,
          bytes: serializedNormalized(normalized),
          kind: "normalized",
          mediaType: "application/json",
          originalName: `normalized-${payload.conversionRunId}.json`,
        }),
        persistPrivateBuffer(options.database, options.storage, {
          authorId: payload.authorId,
          bytes: Buffer.from(`${JSON.stringify(previewDocument, null, 2)}\n`, "utf8"),
          kind: "preview",
          mediaType: "application/json",
          originalName: `preview-${payload.conversionRunId}.json`,
        }),
        persistPrivateBuffer(options.database, options.storage, {
          authorId: payload.authorId,
          bytes: Buffer.from(conversion.artifacts[0].bytes),
          kind: "epub",
          mediaType: "application/epub+zip",
          originalName: `${initial.title}.epub`,
        }),
        persistPrivateBuffer(options.database, options.storage, {
          authorId: payload.authorId,
          bytes: Buffer.from(conversion.artifacts[1].bytes),
          kind: "mobi",
          mediaType: "application/x-mobipocket-ebook",
          originalName: `${initial.title}.mobi`,
        }),
      ]);
      if (context.signal.aborted) throw new Error("Worker lease was lost");
      await withSqlTransaction(options.database, async (connection) => {
        const locked = await connection.query<{ revision: number; status: string }>(
          "SELECT revision, status FROM publishing_book_drafts WHERE id = $1 FOR UPDATE",
          [payload.draftId],
        );
        if (locked.rows[0]?.revision !== payload.draftRevision) {
          await connection.query(
            `
              UPDATE publishing_conversion_runs
              SET status = 'failed', failure_code = 'STALE_CONVERSION',
                  failure_message = $1, completed_at = CURRENT_TIMESTAMP
              WHERE id = $2
            `,
            [safeConversionMessage("STALE_CONVERSION"), payload.conversionRunId],
          );
          return;
        }
        await connection.query(
          `
            INSERT INTO publishing_preview_artifacts (
              id, draft_id, conversion_run_id, preview_object_id,
              epub_object_id, mobi_object_id, content_sha256
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (conversion_run_id) DO NOTHING
          `,
          [
            randomUUID(),
            payload.draftId,
            payload.conversionRunId,
            previewObject.id,
            epubObject.id,
            mobiObject.id,
            previewObject.sha256,
          ],
        );
        await connection.query(
          `
            UPDATE publishing_conversion_runs
            SET status = 'completed', normalized_object_id = $1,
                completed_at = CURRENT_TIMESTAMP, failure_code = NULL, failure_message = NULL
            WHERE id = $2
          `,
          [normalizedObject.id, payload.conversionRunId],
        );
        await connection.query(
          `
            UPDATE publishing_book_drafts
            SET status = 'ready', current_step = 5,
                conversion_failure_code = NULL, conversion_failure_message = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [payload.draftId],
        );
      });
    } catch (error) {
      // Once the durable-job lease is lost this worker no longer owns any
      // publishing state transition. The new lease holder must be the only
      // process allowed to record retry/failure state.
      if (context.signal.aborted) {
        throw context.signal.reason ?? error;
      }
      const code = safeCode(error);
      if (job.attempts >= job.maxAttempts) {
        const message = safeConversionMessage(code);
        await withSqlTransaction(options.database, async (connection) => {
          await connection.query(
            `
              UPDATE publishing_conversion_runs
              SET status = 'failed', failure_code = $1, failure_message = $2,
                  completed_at = CURRENT_TIMESTAMP
              WHERE id = $3 AND status <> 'completed'
            `,
            [code, message, payload.conversionRunId],
          );
          await connection.query(
            `
              UPDATE publishing_book_drafts
              SET status = 'conversion_failed', conversion_failure_code = $1,
                  conversion_failure_message = $2, updated_at = CURRENT_TIMESTAMP
              WHERE id = $3 AND revision = $4 AND status <> 'submitted'
            `,
            [code, message, payload.draftId, payload.draftRevision],
          );
        });
      } else {
        await options.database.query(
          `
            UPDATE publishing_conversion_runs
            SET status = 'queued', failure_code = NULL, failure_message = NULL
            WHERE id = $1 AND status <> 'completed'
          `,
          [payload.conversionRunId],
        );
      }
      throw new Error(code);
    }
  };
}
