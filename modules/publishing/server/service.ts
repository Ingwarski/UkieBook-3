import "server-only";

import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";

import { prepareManuscript } from "../conversion/prepare";
import type { ManuscriptSource } from "../conversion/types";
import { withDomainTransaction } from "../../platform/transaction";
import type { SqlDatabase, SqlExecutor } from "../../platform/sql-port";
import { withSqlTransaction } from "../../platform/sql-port";
import type { PrivateObjectStorage } from "../storage/private-object-storage";
import { persistPrivateBuffer } from "../storage/private-object-persistence";
import {
  FIVE_YEAR_LICENSE_COPY_VERSION,
  PUBLISHING_CONVERTER_ADAPTER_ID,
  PUBLISHING_PIPELINE_VERSION,
  PUBLISHING_SCHEMA_VERSION,
  RIGHTS_COPY_VERSION,
  safeConversionMessage,
  type BookDraftReadModel,
  type ManuscriptSourceType,
  type PreviewDocument,
} from "../types";
import {
  createBookAndDraft,
  findDraftForAuthor,
  findLatestOpenDraftForAuthor,
  listDraftIllustrations,
  type StoredDraftRecord,
} from "./repository";

export { persistPrivateBuffer } from "../storage/private-object-persistence";

export class PublishingInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublishingInputError";
    this.code = code;
  }
}

export class PublishingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishingConflictError";
  }
}

function requireDraft(record: StoredDraftRecord | null): StoredDraftRecord {
  if (!record) throw new PublishingInputError("DRAFT_NOT_FOUND", "Чернетку не знайдено.");
  return record;
}

function cleanText(value: string, max: number, label: string): string {
  const cleaned = value.replace(/\r\n?/gu, "\n").trim();
  if (!cleaned) throw new PublishingInputError("REQUIRED", `${label}: заповніть поле.`);
  if (cleaned.length > max) {
    throw new PublishingInputError("TOO_LONG", `${label}: перевищено допустиму довжину.`);
  }
  return cleaned;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function readPreviewDocument(
  storage: PrivateObjectStorage,
  storageKey: string,
): Promise<PreviewDocument> {
  const raw = await storage.read(storageKey);
  const parsed = JSON.parse(raw.toString("utf8")) as PreviewDocument;
  if (
    parsed.schemaVersion !== PUBLISHING_SCHEMA_VERSION ||
    !Array.isArray(parsed.sections) ||
    parsed.sections.length === 0
  ) {
    throw new Error("Stored preview artifact has an unsupported schema");
  }
  return parsed;
}

async function draftReadModel(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  record: StoredDraftRecord,
): Promise<BookDraftReadModel> {
  const illustrations = await listDraftIllustrations(database, record.authorId, record.draftId);
  let preview: BookDraftReadModel["preview"] = null;
  if (
    record.previewArtifactId &&
    record.previewStorageKey &&
    record.previewCreatedAt &&
    record.epubObjectId &&
    record.mobiObjectId
  ) {
    const parsed = await readPreviewDocument(storage, record.previewStorageKey);
    preview = {
      artifactId: record.previewArtifactId,
      createdAt: record.previewCreatedAt,
      document: parsed,
      epubObjectId: record.epubObjectId,
      mobiObjectId: record.mobiObjectId,
    };
  }
  return {
    authorId: record.authorId,
    authorPublicName: record.authorPublicName,
    basePriceKopiykas: record.basePriceKopiykas,
    bookId: record.bookId,
    conversionFailure: record.conversionFailureCode
      ? {
          code: record.conversionFailureCode,
          message:
            record.conversionFailureMessage ?? safeConversionMessage(record.conversionFailureCode),
        }
      : null,
    coverMode: record.coverMode,
    coverObjectId: record.coverObjectId,
    coverUrl: record.coverObjectId
      ? `/api/author/publishing/objects/${record.coverObjectId}`
      : null,
    currentStep: record.currentStep,
    description: record.description,
    draftId: record.draftId,
    genreSlug: record.genreSlug,
    illustrations: illustrations.map((illustration) => ({
      ...illustration,
      url: `/api/author/publishing/objects/${illustration.objectId}`,
    })),
    manuscriptObjectId: record.manuscriptObjectId,
    preview,
    revision: record.revision,
    sampleSectionIndex: record.sampleSectionIndex,
    samplePreviewArtifactId: record.samplePreviewArtifactId,
    schemaVersion: PUBLISHING_SCHEMA_VERSION,
    sourceName: record.sourceName,
    sourceReference: record.sourceReference,
    sourceType: record.sourceType,
    status: record.status,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

export async function createAuthorDraft(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  authorId: string,
): Promise<BookDraftReadModel> {
  const created = await withSqlTransaction(database, (connection) =>
    createBookAndDraft(connection, authorId),
  );
  return loadAuthorDraft(database, storage, authorId, created.draftId);
}

export async function loadAuthorDraft(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  authorId: string,
  draftId: string,
): Promise<BookDraftReadModel> {
  return draftReadModel(
    database,
    storage,
    requireDraft(await findDraftForAuthor(database, authorId, draftId)),
  );
}

export async function loadLatestAuthorDraft(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  authorId: string,
): Promise<BookDraftReadModel | null> {
  const draft = await findLatestOpenDraftForAuthor(database, authorId);
  return draft ? draftReadModel(database, storage, draft) : null;
}

async function requireMutableAuthorDraft(
  database: SqlDatabase,
  authorId: string,
  draftId: string,
): Promise<StoredDraftRecord> {
  const draft = requireDraft(await findDraftForAuthor(database, authorId, draftId));
  if (draft.status === "submitted") {
    throw new PublishingConflictError("Подану версію не можна змінювати.");
  }
  return draft;
}

function validateManuscript(
  input: { readonly bytes: Buffer; readonly fileName: string; readonly mediaType: string },
): { readonly sourceType: Exclude<ManuscriptSourceType, "google_docs">; readonly mediaType: string } {
  const lower = input.fileName.toLocaleLowerCase("uk-UA");
  if (lower.endsWith(".txt")) {
    if (input.bytes.includes(0)) {
      throw new PublishingInputError("BROKEN_MANUSCRIPT", "TXT містить недопустимі двійкові дані.");
    }
    const text = input.bytes.toString("utf8");
    if (!text.trim() || text.includes("\uFFFD")) {
      throw new PublishingInputError("BROKEN_MANUSCRIPT", "TXT не вдалося прочитати як UTF-8.");
    }
    return { mediaType: "text/plain", sourceType: "txt" };
  }
  if (lower.endsWith(".docx")) {
    if (input.bytes.subarray(0, 4).toString("hex") !== "504b0304") {
      throw new PublishingInputError("BROKEN_MANUSCRIPT", "DOCX має пошкоджену структуру.");
    }
    return {
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sourceType: "docx",
    };
  }
  throw new PublishingInputError(
    "UNSUPPORTED_MANUSCRIPT",
    "Підтримуються лише DOCX, TXT або імпорт із Google Docs.",
  );
}

export async function uploadManuscript(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly bytes: Buffer;
    readonly draftId: string;
    readonly fileName: string;
    readonly maxBytes: number;
    readonly mediaType: string;
    readonly sourceReference?: string | null;
    readonly sourceTypeOverride?: ManuscriptSourceType;
  },
): Promise<BookDraftReadModel> {
  if (input.bytes.byteLength > input.maxBytes) {
    throw new PublishingInputError("FILE_TOO_LARGE", "Файл перевищує ліміт 50 МБ.");
  }
  await requireMutableAuthorDraft(database, input.authorId, input.draftId);
  const validated = validateManuscript(input);
  const sourceType = input.sourceTypeOverride ?? validated.sourceType;
  try {
    const common = {
      artifactVersion: 1 as const,
      bytes: new Uint8Array(input.bytes),
      fileName: input.fileName,
    };
    const source: ManuscriptSource = validated.sourceType === "txt"
      ? { ...common, kind: "txt", mediaType: "text/plain" }
      : {
          ...common,
          kind: "docx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        };
    prepareManuscript({
      metadata: { authorName: "Автор UkieBook", language: "uk", title: "Чернетка" },
      source,
    });
  } catch {
    throw new PublishingInputError(
      "BROKEN_MANUSCRIPT",
      "Не вдалося прочитати рукопис. Завантажте справний DOCX або TXT.",
    );
  }
  await withSqlTransaction(database, async (connection) => {
    const draft = requireDraft(
      await findDraftForAuthor(connection, input.authorId, input.draftId, { forUpdate: true }),
    );
    if (draft.status === "submitted") {
      throw new PublishingConflictError("Подану версію не можна змінювати.");
    }
    const object = await persistPrivateBuffer(connection, storage, {
      authorId: input.authorId,
      bytes: input.bytes,
      kind: "manuscript",
      mediaType: validated.mediaType,
      originalName: input.fileName,
    });
    await connection.query(
      `
        UPDATE publishing_book_drafts
        SET source_type = $1,
            source_reference = $2,
            manuscript_object_id = $3,
            current_step = GREATEST(current_step, 2),
            revision = revision + 1,
            status = 'draft',
            sample_section_index = NULL,
            sample_preview_artifact_id = NULL,
            conversion_failure_code = NULL,
            conversion_failure_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `,
      [sourceType, input.sourceReference ?? null, object.id, input.draftId],
    );
  });
  return loadAuthorDraft(database, storage, input.authorId, input.draftId);
}

function googleDocumentId(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublishingInputError("GOOGLE_DOCS_URL", "Вставте коректне посилання Google Docs.");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new PublishingInputError("GOOGLE_DOCS_URL", "Потрібне посилання docs.google.com.");
  }
  const match = url.pathname.match(/^\/document\/d\/([A-Za-z0-9_-]+)(?:\/|$)/u);
  if (!match?.[1]) {
    throw new PublishingInputError("GOOGLE_DOCS_URL", "Не вдалося визначити документ.");
  }
  return match[1];
}

async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredValue = response.headers.get("content-length");
  if (declaredValue !== null) {
    if (!/^\d+$/u.test(declaredValue)) {
      throw new Error("Google Docs returned an invalid Content-Length");
    }
    const declaredLength = Number(declaredValue);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      throw new PublishingInputError("FILE_TOO_LARGE", "Документ перевищує ліміт 50 МБ.");
    }
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      byteLength += chunk.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new PublishingInputError("FILE_TOO_LARGE", "Документ перевищує ліміт 50 МБ.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength);
}

export async function importGoogleDocument(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly draftId: string;
    readonly documentUrl: string;
    readonly exportOrigin: string;
    readonly maxBytes: number;
    readonly fetcher?: typeof fetch;
  },
): Promise<BookDraftReadModel> {
  await requireMutableAuthorDraft(database, input.authorId, input.draftId);
  const documentId = googleDocumentId(input.documentUrl);
  const origin = new URL(input.exportOrigin);
  if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost") {
    throw new Error("Google Docs export origin must use HTTPS");
  }
  const exportUrl = new URL(`/document/d/${documentId}/export`, origin);
  exportUrl.searchParams.set("format", "docx");
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(exportUrl, {
      headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PublishingInputError(
      "GOOGLE_DOCS_UNAVAILABLE",
      "Google Docs не відповідає. Чернетку збережено — повторіть або завантажте DOCX.",
    );
  }
  if (!response.ok) {
    throw new PublishingInputError(
      response.status === 401 || response.status === 403
        ? "GOOGLE_DOCS_PERMISSION"
        : "GOOGLE_DOCS_UNAVAILABLE",
      response.status === 401 || response.status === 403
        ? "Немає доступу до документа. Надайте доступ за посиланням або завантажте DOCX."
        : "Не вдалося імпортувати документ. Спробуйте DOCX.",
    );
  }
  let bytes: Buffer;
  try {
    bytes = await readBoundedResponseBody(response, input.maxBytes);
  } catch (error) {
    if (error instanceof PublishingInputError) throw error;
    throw new PublishingInputError(
      "GOOGLE_DOCS_UNAVAILABLE",
      "Не вдалося імпортувати документ. Спробуйте DOCX.",
    );
  }
  return uploadManuscript(database, storage, {
    authorId: input.authorId,
    bytes,
    draftId: input.draftId,
    fileName: `google-doc-${documentId}.docx`,
    maxBytes: input.maxBytes,
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sourceReference: documentId,
    sourceTypeOverride: "google_docs",
  });
}

async function normalizeRasterImage(
  bytes: Buffer,
  input: { readonly height?: number; readonly width?: number },
): Promise<Buffer> {
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("No image dimensions");
    if (!metadata.format || !new Set(["jpeg", "png", "webp"]).has(metadata.format)) {
      throw new PublishingInputError(
        "UNSUPPORTED_IMAGE",
        "Підтримуються лише PNG, JPG або WebP.",
      );
    }
    return image
      .resize(
        input.width
          ? {
              fit: "cover",
              height: input.height,
              position: "attention",
              width: input.width,
            }
          : { fit: "inside", height: 1800, width: 1800, withoutEnlargement: true },
      )
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (error) {
    if (error instanceof PublishingInputError) throw error;
    throw new PublishingInputError("BROKEN_IMAGE", "Не вдалося прочитати зображення.");
  }
}

export async function uploadIllustration(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly anchorLabel: string;
    readonly authorId: string;
    readonly bytes: Buffer;
    readonly draftId: string;
    readonly fileName: string;
    readonly maxBytes: number;
  },
): Promise<BookDraftReadModel> {
  if (input.bytes.byteLength > input.maxBytes) {
    throw new PublishingInputError("FILE_TOO_LARGE", "Ілюстрація перевищує ліміт 50 МБ.");
  }
  await requireMutableAuthorDraft(database, input.authorId, input.draftId);
  const normalized = await normalizeRasterImage(input.bytes, {});
  await withSqlTransaction(database, async (connection) => {
    const draft = requireDraft(
      await findDraftForAuthor(connection, input.authorId, input.draftId, { forUpdate: true }),
    );
    if (draft.status === "submitted") throw new PublishingConflictError("Версію вже подано.");
    const object = await persistPrivateBuffer(connection, storage, {
      authorId: input.authorId,
      bytes: normalized,
      kind: "illustration",
      mediaType: "image/png",
      originalName: input.fileName,
    });
    const ordinalResult = await connection.query<{ next_ordinal: number }>(
      `
        SELECT COALESCE(MAX(ordinal) + 1, 0)::int AS next_ordinal
        FROM publishing_draft_illustrations
        WHERE draft_id = $1
      `,
      [input.draftId],
    );
    await connection.query(
      `
        INSERT INTO publishing_draft_illustrations (
          id, draft_id, object_id, ordinal, anchor_label
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        randomUUID(),
        input.draftId,
        object.id,
        ordinalResult.rows[0]?.next_ordinal ?? 0,
        cleanText(input.anchorLabel || "Після першого розділу", 160, "Розташування"),
      ],
    );
    await connection.query(
      `
        UPDATE publishing_book_drafts
        SET revision = revision + 1,
            status = 'draft',
            sample_section_index = NULL,
            sample_preview_artifact_id = NULL,
            conversion_failure_code = NULL,
            conversion_failure_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [input.draftId],
    );
  });
  return loadAuthorDraft(database, storage, input.authorId, input.draftId);
}

export async function saveDescriptionStep(
  database: SqlDatabase,
  input: {
    readonly authorId: string;
    readonly description: string;
    readonly draftId: string;
    readonly expectedRevision: number;
    readonly title: string;
  },
): Promise<void> {
  const title = cleanText(input.title, 240, "Назва книжки");
  const description = cleanText(input.description, 8_000, "Опис");
  await withSqlTransaction(database, async (connection) => {
    const draft = requireDraft(
      await findDraftForAuthor(connection, input.authorId, input.draftId, { forUpdate: true }),
    );
    if (draft.revision !== input.expectedRevision) {
      throw new PublishingConflictError("Чернетка змінилася в іншій вкладці. Оновіть сторінку.");
    }
    if (draft.status === "submitted") throw new PublishingConflictError("Версію вже подано.");
    await connection.query(
      `
        UPDATE publishing_book_drafts
        SET title = $1,
            description = $2,
            current_step = GREATEST(current_step, 3),
            revision = revision + 1,
            status = 'draft',
            sample_section_index = NULL,
            sample_preview_artifact_id = NULL,
            conversion_failure_code = NULL,
            conversion_failure_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [title, description, input.draftId],
    );
    await connection.query(
      "UPDATE publishing_books SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [title, draft.bookId],
    );
  });
}

export async function uploadCover(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly bytes: Buffer;
    readonly draftId: string;
    readonly fileName: string;
    readonly maxBytes: number;
  },
): Promise<void> {
  if (input.bytes.byteLength > input.maxBytes) {
    throw new PublishingInputError("FILE_TOO_LARGE", "Обкладинка перевищує ліміт 50 МБ.");
  }
  await requireMutableAuthorDraft(database, input.authorId, input.draftId);
  const cover = await normalizeRasterImage(input.bytes, { height: 1800, width: 1200 });
  await attachCover(database, storage, {
    authorId: input.authorId,
    bytes: cover,
    draftId: input.draftId,
    mode: "uploaded",
    originalName: input.fileName,
  });
}

async function attachCover(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly bytes: Buffer;
    readonly draftId: string;
    readonly expectedRevision?: number;
    readonly mode: "uploaded" | "fallback";
    readonly originalName: string;
  },
): Promise<void> {
  await withSqlTransaction(database, async (connection) => {
    const draft = requireDraft(
      await findDraftForAuthor(connection, input.authorId, input.draftId, { forUpdate: true }),
    );
    if (
      input.expectedRevision !== undefined &&
      draft.revision !== input.expectedRevision
    ) {
      throw new PublishingConflictError(
        "Чернетка змінилася під час створення обкладинки. Поточну обкладинку збережено.",
      );
    }
    if (draft.status === "submitted") throw new PublishingConflictError("Версію вже подано.");
    const object = await persistPrivateBuffer(connection, storage, {
      authorId: input.authorId,
      bytes: input.bytes,
      kind: "cover",
      mediaType: "image/png",
      originalName: input.originalName,
    });
    await connection.query(
      `
        UPDATE publishing_book_drafts
        SET cover_mode = $1,
            cover_object_id = $2,
            current_step = GREATEST(current_step, 4),
            revision = revision + 1,
            status = 'draft',
            sample_section_index = NULL,
            sample_preview_artifact_id = NULL,
            conversion_failure_code = NULL,
            conversion_failure_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [input.mode, object.id, input.draftId],
    );
  });
}

export function coverTitleLines(title: string): [string, string, string] {
  const maximumCharacters = 18;
  const parts = title
    .trim()
    .split(/\s+/u)
    .flatMap((word) => {
      const characters = Array.from(word);
      const chunks: string[] = [];
      while (characters.length > maximumCharacters) {
        chunks.push(
          `${characters.splice(0, maximumCharacters - 1).join("")}‑`,
        );
      }
      if (characters.length > 0) chunks.push(characters.join(""));
      return chunks;
    });
  const lines: string[] = [];
  let truncated = false;
  for (const part of parts) {
    const current = lines.at(-1);
    if (current === undefined) {
      lines.push(part);
      continue;
    }
    if (Array.from(`${current} ${part}`).length <= maximumCharacters) {
      lines[lines.length - 1] = `${current} ${part}`;
      continue;
    }
    if (lines.length < 3) {
      lines.push(part);
      continue;
    }
    truncated = true;
    break;
  }
  if (truncated && lines[2]) {
    const finalCharacters = Array.from(lines[2]);
    lines[2] = `${finalCharacters.slice(0, maximumCharacters - 1).join("")}…`;
  }
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
}

export async function generateFallbackCover(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: { readonly authorId: string; readonly draftId: string },
): Promise<void> {
  const draft = requireDraft(await findDraftForAuthor(database, input.authorId, input.draftId));
  const title = cleanText(draft.title, 240, "Назва книжки");
  const genre = draft.genreSlug ? draft.genreSlug.replaceAll("-", " ") : "українська книжка";
  const [line1, line2, line3] = coverTitleLines(title);
  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2F5B72"/>
          <stop offset="0.55" stop-color="#8F5BA9"/>
          <stop offset="1" stop-color="#D68D5F"/>
        </linearGradient>
        <radialGradient id="light" cx="72%" cy="16%" r="70%">
          <stop offset="0" stop-color="#FFE7C6" stop-opacity=".92"/>
          <stop offset="1" stop-color="#FFE7C6" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="1800" fill="url(#sky)"/>
      <rect width="1200" height="1800" fill="url(#light)"/>
      <path d="M0 1220 C260 980 420 1120 620 960 C820 800 930 920 1200 690 L1200 1800 L0 1800 Z" fill="#132F39" opacity=".74"/>
      <path d="M0 1380 C280 1190 500 1330 720 1150 C900 1010 1050 1070 1200 940 L1200 1800 L0 1800 Z" fill="#0C222B" opacity=".82"/>
      <text x="92" y="190" fill="#FFF7F3" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="5">UKIEBOOK · ${xml(genre.toLocaleUpperCase("uk-UA"))}</text>
      <text x="92" y="480" fill="#FFFFFF" font-family="Georgia, serif" font-size="94" font-weight="700">
        <tspan x="92" dy="0">${xml(line1)}</tspan>
        <tspan x="92" dy="118">${xml(line2)}</tspan>
        <tspan x="92" dy="118">${xml(line3)}</tspan>
      </text>
      <text x="92" y="1640" fill="#FFF7F3" font-family="Arial, sans-serif" font-size="42" font-weight="600">${xml(draft.authorPublicName)}</text>
    </svg>
  `);
  const cover = await sharp(artwork).png({ compressionLevel: 9 }).toBuffer();
  await attachCover(database, storage, {
    authorId: input.authorId,
    bytes: cover,
    draftId: input.draftId,
    expectedRevision: draft.revision,
    mode: "fallback",
    originalName: `fallback-${input.draftId}.png`,
  });
}

export async function saveCommerceStep(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly basePriceKopiykas: number;
    readonly draftId: string;
    readonly expectedRevision: number;
    readonly genreSlug: string;
  },
): Promise<void> {
  if (!Number.isInteger(input.basePriceKopiykas) || input.basePriceKopiykas < 0) {
    throw new PublishingInputError("PRICE", "Укажіть коректну ціну в гривнях.");
  }
  await withSqlTransaction(database, async (connection) => {
    const draft = requireDraft(
      await findDraftForAuthor(connection, input.authorId, input.draftId, { forUpdate: true }),
    );
    if (draft.revision !== input.expectedRevision) {
      throw new PublishingConflictError("Чернетка змінилася. Оновіть сторінку.");
    }
    if (!draft.manuscriptObjectId || !draft.description.trim() || !draft.coverObjectId) {
      throw new PublishingInputError("INCOMPLETE", "Спершу завершіть попередні кроки.");
    }
    const genre = await connection.query<{ slug: string }>(
      "SELECT slug FROM catalog_genres WHERE slug = $1",
      [input.genreSlug],
    );
    if (!genre.rows[0]) throw new PublishingInputError("GENRE", "Оберіть жанр зі списку.");
    await connection.query(
      `
        UPDATE publishing_book_drafts
        SET genre_slug = $1,
            base_price_kopiykas = $2,
            sample_section_index = NULL,
            sample_preview_artifact_id = NULL,
            current_step = 5,
            revision = revision + 1,
            status = 'draft',
            conversion_failure_code = NULL,
            conversion_failure_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [input.genreSlug, input.basePriceKopiykas, input.draftId],
    );
  });
  const updated = requireDraft(await findDraftForAuthor(database, input.authorId, input.draftId));
  if (updated.coverMode === "fallback") {
    await generateFallbackCover(database, storage, {
      authorId: input.authorId,
      draftId: input.draftId,
    });
  }
}

async function conversionFingerprint(
  executor: SqlExecutor,
  draft: StoredDraftRecord,
): Promise<string> {
  const objects = await executor.query<{ object_kind: string; sha256: string }>(
    `
      SELECT object_kind, sha256
      FROM publishing_private_objects
      WHERE id IN (
        SELECT manuscript_object_id FROM publishing_book_drafts WHERE id = $1
        UNION ALL
        SELECT cover_object_id FROM publishing_book_drafts WHERE id = $1
        UNION ALL
        SELECT object_id FROM publishing_draft_illustrations WHERE draft_id = $1
      )
      ORDER BY object_kind, sha256
    `,
    [draft.draftId],
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        adapter: PUBLISHING_CONVERTER_ADAPTER_ID,
        author: draft.authorPublicName,
        basePriceKopiykas: draft.basePriceKopiykas,
        description: draft.description,
        genre: draft.genreSlug,
        objects: objects.rows,
        pipeline: PUBLISHING_PIPELINE_VERSION,
        sourceType: draft.sourceType,
        title: draft.title,
      }),
    )
    .digest("hex");
}

export async function queueDraftConversion(
  database: SqlDatabase,
  input: { readonly authorId: string; readonly draftId: string },
): Promise<string> {
  return withDomainTransaction(database, async (transaction) => {
    const draft = requireDraft(
      await findDraftForAuthor(transaction.connection, input.authorId, input.draftId, {
        forUpdate: true,
      }),
    );
    if (
      !draft.manuscriptObjectId ||
      !draft.coverObjectId ||
      !draft.title.trim() ||
      !draft.description.trim() ||
      !draft.genreSlug ||
      draft.basePriceKopiykas === null
    ) {
      throw new PublishingInputError("INCOMPLETE", "Заповніть кроки 1–4 перед переглядом.");
    }
    if (draft.status === "submitted") throw new PublishingConflictError("Версію вже подано.");
    if (draft.status === "ready" && draft.previewArtifactId) return draft.previewArtifactId;
    const active = await transaction.connection.query<{ id: string }>(
      `
        SELECT id FROM publishing_conversion_runs
        WHERE draft_id = $1 AND draft_revision = $2 AND status IN ('queued', 'running')
        ORDER BY created_at DESC LIMIT 1
      `,
      [draft.draftId, draft.revision],
    );
    if (active.rows[0]) return active.rows[0].id;
    const fingerprint = await conversionFingerprint(transaction.connection, draft);
    const conversionRunId = randomUUID();
    await transaction.connection.query(
      `
        INSERT INTO publishing_conversion_runs (
          id, draft_id, draft_revision, input_sha256, pipeline_version, adapter_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'queued')
      `,
      [
        conversionRunId,
        draft.draftId,
        draft.revision,
        fingerprint,
        PUBLISHING_PIPELINE_VERSION,
        PUBLISHING_CONVERTER_ADAPTER_ID,
      ],
    );
    await transaction.connection.query(
      `
        UPDATE publishing_book_drafts
        SET status = 'converting',
            sample_section_index = NULL,
            sample_preview_artifact_id = NULL,
            conversion_failure_code = NULL,
            conversion_failure_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [draft.draftId],
    );
    await transaction.enqueue({
      correlationId: conversionRunId,
      idempotencyKey: `publishing.convert:${conversionRunId}`,
      jobType: "publishing.convert.v1",
      jobVersion: 1,
      maxAttempts: 3,
      payload: {
        authorId: input.authorId,
        conversionRunId,
        draftId: draft.draftId,
        draftRevision: draft.revision,
        fingerprint,
      },
      queue: "publishing",
    });
    return conversionRunId;
  });
}

export async function saveSampleSection(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly draftId: string;
    readonly previewArtifactId: string;
    readonly sampleSectionIndex: number;
  },
): Promise<void> {
  if (!Number.isInteger(input.sampleSectionIndex) || input.sampleSectionIndex < 0) {
    throw new PublishingInputError("SAMPLE", "Оберіть розділ для безкоштовного фрагмента.");
  }
  await withSqlTransaction(database, async (connection) => {
    const draft = requireDraft(
      await findDraftForAuthor(connection, input.authorId, input.draftId, { forUpdate: true }),
    );
    if (
      draft.status !== "ready" ||
      !draft.previewArtifactId ||
      !draft.previewStorageKey
    ) {
      throw new PublishingInputError("PREVIEW_REQUIRED", "Спершу перевірте готове видання.");
    }
    if (draft.previewArtifactId !== input.previewArtifactId) {
      throw new PublishingInputError(
        "SAMPLE_STALE",
        "Попередній перегляд змінився. Оберіть безкоштовний фрагмент ще раз.",
      );
    }
    const preview = await readPreviewDocument(storage, draft.previewStorageKey);
    if (input.sampleSectionIndex >= preview.sections.length) {
      throw new PublishingInputError(
        "SAMPLE",
        "Оберіть розділ, який є в готовому попередньому перегляді.",
      );
    }
    await connection.query(
      `
        UPDATE publishing_book_drafts
        SET sample_section_index = $1,
            sample_preview_artifact_id = $2,
            current_step = 6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [input.sampleSectionIndex, input.previewArtifactId, input.draftId],
    );
  });
}

export async function submitBookDraft(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly draftId: string;
    readonly fiveYearLicenseConfirmed: boolean;
    readonly rightsConfirmed: boolean;
  },
): Promise<{ readonly bookId: string; readonly bookVersionId: string }> {
  if (!input.rightsConfirmed || !input.fiveYearLicenseConfirmed) {
    throw new PublishingInputError(
      "CONFIRMATIONS_REQUIRED",
      "Окремо підтвердьте Декларацію прав і пʼятирічну ліцензійну умову.",
    );
  }
  return withDomainTransaction(database, async (transaction) => {
    const draft = requireDraft(
      await findDraftForAuthor(transaction.connection, input.authorId, input.draftId, {
        forUpdate: true,
      }),
    );
    const existing = await transaction.connection.query<{ id: string }>(
      `
        SELECT id FROM publishing_book_versions
        WHERE book_id = $1 AND author_id = $2
        ORDER BY version_number DESC LIMIT 1
      `,
      [draft.bookId, input.authorId],
    );
    if (draft.status === "submitted" && existing.rows[0]) {
      return { bookId: draft.bookId, bookVersionId: existing.rows[0].id };
    }
    if (draft.status !== "ready" || !draft.previewArtifactId) {
      throw new PublishingInputError("PREVIEW_REQUIRED", "Спершу перевірте готове видання.");
    }
    if (
      draft.sampleSectionIndex === null ||
      draft.samplePreviewArtifactId !== draft.previewArtifactId
    ) {
      throw new PublishingInputError(
        "SAMPLE",
        "Оберіть безкоштовний фрагмент із готового попереднього перегляду.",
      );
    }
    const artifact = await transaction.connection.query<{
      epub_object_id: string;
      mobi_object_id: string;
      preview_object_id: string;
      preview_storage_key: string;
    }>(
      `
        SELECT artifact.preview_object_id, artifact.epub_object_id, artifact.mobi_object_id,
               preview_object.storage_key AS preview_storage_key
        FROM publishing_preview_artifacts artifact
        JOIN publishing_conversion_runs conversion_run
          ON conversion_run.id = artifact.conversion_run_id
        JOIN publishing_private_objects preview_object
          ON preview_object.id = artifact.preview_object_id
        WHERE artifact.id = $1 AND artifact.draft_id = $2
          AND conversion_run.status = 'completed'
          AND conversion_run.draft_revision = $3
      `,
      [draft.samplePreviewArtifactId, draft.draftId, draft.revision],
    );
    const output = artifact.rows[0];
    if (
      !output ||
      !draft.manuscriptObjectId ||
      !draft.coverObjectId ||
      !draft.genreSlug ||
      draft.basePriceKopiykas === null ||
      !draft.description.trim()
    ) {
      throw new PublishingInputError("INCOMPLETE", "Чернетка не готова до подання.");
    }
    const preview = await readPreviewDocument(storage, output.preview_storage_key);
    if (draft.sampleSectionIndex >= preview.sections.length) {
      throw new PublishingInputError(
        "SAMPLE",
        "Обраного безкоштовного фрагмента немає в готовому виданні.",
      );
    }
    const count = await transaction.connection.query<{ next_version: number }>(
      `
        SELECT COALESCE(MAX(version_number) + 1, 1)::int AS next_version
        FROM publishing_book_versions
        WHERE book_id = $1
      `,
      [draft.bookId],
    );
    const versionNumber = count.rows[0]?.next_version ?? 1;
    const bookVersionId = randomUUID();
    await transaction.connection.query(
      `
        INSERT INTO publishing_book_versions (
          id, book_id, version_number, author_id, manuscript_object_id,
          cover_object_id, preview_object_id, epub_object_id, mobi_object_id,
          title, description, genre_slug, base_price_kopiykas, sample_section_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        bookVersionId,
        draft.bookId,
        versionNumber,
        input.authorId,
        draft.manuscriptObjectId,
        draft.coverObjectId,
        output.preview_object_id,
        output.epub_object_id,
        output.mobi_object_id,
        draft.title,
        draft.description,
        draft.genreSlug,
        draft.basePriceKopiykas,
        draft.sampleSectionIndex,
      ],
    );
    for (const declaration of [
      { copyVersion: RIGHTS_COPY_VERSION, type: "rights" },
      { copyVersion: FIVE_YEAR_LICENSE_COPY_VERSION, type: "five_year_license" },
    ] as const) {
      await transaction.connection.query(
        `
          INSERT INTO publishing_rights_declarations (
            id, book_version_id, author_id, declaration_type, copy_version, confirmed
          ) VALUES ($1, $2, $3, $4, $5, TRUE)
        `,
        [randomUUID(), bookVersionId, input.authorId, declaration.type, declaration.copyVersion],
      );
    }
    await transaction.connection.query(
      `
        UPDATE publishing_book_drafts
        SET status = 'submitted', current_step = 6, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [draft.draftId],
    );
    await transaction.connection.query(
      `
        UPDATE publishing_books
        SET status = 'submitted', title = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [draft.title, draft.bookId],
    );
    await transaction.emit({
      aggregateId: draft.bookId,
      aggregateType: "Book",
      correlationId: bookVersionId,
      eventType: "BookSubmitted",
      eventVersion: 1,
      idempotencyKey: `publishing.book-submitted:${bookVersionId}`,
      payload: {
        authorId: input.authorId,
        bookId: draft.bookId,
        bookVersionId,
        versionNumber,
      },
      topic: "publishing.book-submitted.v1",
    });
    return { bookId: draft.bookId, bookVersionId };
  });
}
