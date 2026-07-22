import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { applyMigrations, listAppliedMigrations, rollbackLatestMigration } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  readZipArchive,
  validateEpub,
  validateLegacyMobi,
} from "../modules/publishing/conversion";
import { createPublishingConversionHandler } from "../modules/publishing/server/conversion-worker";
import {
  createAuthorDraft,
  generateFallbackCover,
  importGoogleDocument,
  loadAuthorDraft,
  queueDraftConversion,
  saveCommerceStep,
  saveDescriptionStep,
  saveSampleSection,
  submitBookDraft,
  uploadManuscript,
} from "../modules/publishing/server/service";
import { LocalPrivateObjectStorage } from "../modules/publishing/storage/private-object-storage";
import { runWorkerOnce } from "../workers/worker";
import {
  docxBytesFixture,
  txtManuscriptFixture,
} from "../tests/fixtures/publishing/conversion-fixtures";
import { requireDedicatedUnit03DatabaseUrl } from "./unit03-database-guard";

const databaseUrl = requireDedicatedUnit03DatabaseUrl(process.env.UNIT03_DATABASE_URL);
const ebookConvertPath = process.env.CALIBRE_EBOOK_CONVERT_PATH;
if (!ebookConvertPath) throw new Error("CALIBRE_EBOOK_CONVERT_PATH is required");
const verifiedEbookConvertPath: string = ebookConvertPath;
const artifactRoot = path.resolve(".data/unit03-postgres-proof");
await rm(artifactRoot, { force: true, recursive: true });
const storage = new LocalPrivateObjectStorage(artifactRoot);
const database = openPostgresDatabase(databaseUrl);
const authorId = "30303030-3030-4030-8030-303030303030";

type ProofSource = "docx" | "google_docs" | "txt";

interface ConversionProof {
  readonly draft: Awaited<ReturnType<typeof loadAuthorDraft>>;
  readonly epubValidator: string;
  readonly expectedInlineIllustrations: number;
  readonly meaningHash: string;
  readonly mobiValidator: string;
  readonly source: ProofSource;
  readonly sourceContentHash: string;
  readonly sourceKind: "docx" | "google-docs-export" | "txt";
}

interface NormalizedProofDocument {
  readonly blocks: readonly unknown[];
  readonly illustrations: readonly unknown[];
  readonly metadata: {
    readonly authorName: string;
    readonly language: string;
    readonly title: string;
  };
  readonly normalization: {
    readonly afterMeaningHash: string;
    readonly beforeMeaningHash: string;
    readonly semanticRewrite: boolean;
  };
  readonly source: {
    readonly contentHash: string;
    readonly documentId: string | null;
    readonly kind: ConversionProof["sourceKind"];
  };
  readonly stage: string;
}

async function seedAuthor(): Promise<void> {
  await database.query(
    "INSERT INTO users (id, private_email) VALUES ($1, 'unit03-private@example.invalid')",
    [authorId],
  );
  await database.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'author')", [authorId]);
  await database.query(
    "INSERT INTO author_profiles (user_id, public_name) VALUES ($1, 'Олена Вітрова')",
    [authorId],
  );
  await database.query(
    "INSERT INTO catalog_genres (slug, label) VALUES ('proza', 'Проза'), ('fantastyka', 'Фантастика')",
  );
}

async function ingestProofManuscript(
  draftId: string,
  source: ProofSource,
) {
  if (source === "google_docs") {
    const fixtureBytes = Buffer.from(docxBytesFixture());
    let exportRequests = 0;
    const imported = await importGoogleDocument(database, storage, {
      authorId,
      documentUrl:
        "https://docs.google.com/document/d/unit03-google-docs-proof/edit",
      draftId,
      exportOrigin: "https://docs.google.com",
      fetcher: async (input, init) => {
        exportRequests += 1;
        const exportUrl = new URL(String(input));
        assert.equal(exportUrl.origin, "https://docs.google.com");
        assert.equal(
          exportUrl.pathname,
          "/document/d/unit03-google-docs-proof/export",
        );
        assert.equal(exportUrl.searchParams.get("format"), "docx");
        assert.equal(init?.redirect, "follow");
        const headers = new Headers(init?.headers);
        assert.equal(headers.has("authorization"), false);
        assert.equal(headers.has("cookie"), false);
        return new Response(fixtureBytes, {
          headers: {
            "Content-Length": String(fixtureBytes.byteLength),
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          status: 200,
        });
      },
      maxBytes: 5_000_000,
    });
    assert.equal(exportRequests, 1);
    assert.equal(imported.sourceReference, "unit03-google-docs-proof");
    assert.equal(imported.sourceType, "google_docs");
    return imported;
  }

  if (source === "txt") {
    const fixture = txtManuscriptFixture();
    return uploadManuscript(database, storage, {
      authorId,
      bytes: Buffer.from(fixture.bytes),
      draftId,
      fileName: fixture.fileName,
      maxBytes: 5_000_000,
      mediaType: fixture.mediaType,
    });
  }

  return uploadManuscript(database, storage, {
    authorId,
    bytes: Buffer.from(docxBytesFixture()),
    draftId,
    fileName: "unit03-docx-proof.docx",
    maxBytes: 5_000_000,
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function completeDraft(title: string, source: ProofSource = "docx") {
  let draft = await createAuthorDraft(database, storage, authorId);
  draft = await ingestProofManuscript(draft.draftId, source);
  await saveDescriptionStep(database, {
    authorId,
    description: "Українська історія про тишу, памʼять і нічну подорож Дніпром.",
    draftId: draft.draftId,
    expectedRevision: draft.revision,
    title,
  });
  await generateFallbackCover(database, storage, { authorId, draftId: draft.draftId });
  draft = await loadAuthorDraft(database, storage, authorId, draft.draftId);
  await saveCommerceStep(database, storage, {
    authorId,
    basePriceKopiykas: 19_900,
    draftId: draft.draftId,
    expectedRevision: draft.revision,
    genreSlug: "proza",
  });
  return loadAuthorDraft(database, storage, authorId, draft.draftId);
}

async function convertAndProve(
  title: string,
  source: ProofSource,
): Promise<ConversionProof> {
  let draft = await completeDraft(title, source);
  await queueDraftConversion(database, { authorId, draftId: draft.draftId });
  assert.equal(await runPublishingWorker(), true);
  draft = await loadAuthorDraft(database, storage, authorId, draft.draftId);
  assert.equal(draft.status, "ready");
  assert.ok(draft.preview);
  await saveSampleSection(database, storage, {
    authorId,
    draftId: draft.draftId,
    previewArtifactId: draft.preview.artifactId,
    sampleSectionIndex: 0,
  });
  draft = await loadAuthorDraft(database, storage, authorId, draft.draftId);
  assert.ok(draft.preview);

  const outputs = await database.query<{
    epub_key: string;
    mobi_key: string;
    normalized_key: string;
  }>(
    `
      SELECT
        epub.storage_key AS epub_key,
        mobi.storage_key AS mobi_key,
        normalized.storage_key AS normalized_key
      FROM publishing_conversion_runs run
      JOIN publishing_preview_artifacts artifact
        ON artifact.conversion_run_id = run.id
      JOIN publishing_private_objects normalized
        ON normalized.id = run.normalized_object_id
      JOIN publishing_private_objects epub
        ON epub.id = artifact.epub_object_id
      JOIN publishing_private_objects mobi
        ON mobi.id = artifact.mobi_object_id
      WHERE run.draft_id = $1 AND run.status = 'completed'
      ORDER BY run.completed_at DESC, run.id DESC
      LIMIT 1
    `,
    [draft.draftId],
  );
  const output = outputs.rows[0];
  assert.ok(output);

  const [normalizedBytes, epubBytes, mobiBytes] = await Promise.all([
    storage.read(output.normalized_key),
    storage.read(output.epub_key),
    storage.read(output.mobi_key),
  ]);
  const normalized = JSON.parse(
    normalizedBytes.toString("utf8"),
  ) as NormalizedProofDocument;
  const expectedSourceKind: ConversionProof["sourceKind"] =
    source === "google_docs" ? "google-docs-export" : source;
  const expectedInlineIllustrations = source === "txt" ? 0 : 1;
  assert.equal(normalized.stage, "normalized");
  assert.equal(normalized.source.kind, expectedSourceKind);
  assert.match(normalized.source.contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    normalized.source.documentId,
    source === "google_docs" ? "unit03-google-docs-proof" : null,
  );
  assert.equal(normalized.metadata.title, title);
  assert.equal(normalized.metadata.authorName, "Олена Вітрова");
  assert.equal(normalized.metadata.language, "uk");
  assert.equal(normalized.normalization.semanticRewrite, false);
  assert.equal(
    normalized.normalization.beforeMeaningHash,
    normalized.normalization.afterMeaningHash,
  );
  assert.match(normalized.normalization.afterMeaningHash, /^[a-f0-9]{64}$/u);
  assert.equal(normalized.illustrations.length, expectedInlineIllustrations);
  const normalizedText = JSON.stringify(normalized.blocks);
  for (const marker of
    source === "txt"
      ? ["Київська ніч", "Другий рядок", "Фінал"]
      : ["Київська ніч", "Після ілюстрації", "Фінальний абзац"]
  ) {
    assert.match(normalizedText, new RegExp(marker, "u"));
  }

  const epubValidation = validateEpub(epubBytes);
  const mobiValidation = validateLegacyMobi(mobiBytes);
  const epubArchive = readZipArchive(epubBytes);
  const epubReadingText = epubValidation.spineDocuments
    .map((entryName) =>
      new TextDecoder().decode(epubArchive.entries.get(entryName)?.bytes),
    )
    .join("\n");
  for (const marker of
    source === "txt"
      ? ["Київська ніч", "Другий рядок", "Фінал"]
      : ["Київська ніч", "Після ілюстрації", "Фінальний абзац"]
  ) {
    assert.match(epubReadingText, new RegExp(marker, "u"));
  }
  if (expectedInlineIllustrations > 0) {
    assert.ok(epubValidation.imageEntries.length > 0);
    assert.match(epubReadingText, /<img\b/u);
    assert.ok(
      draft.preview.document.sections.some((section) =>
        section.blocks.some((block) => block.kind === "illustration"),
      ),
    );
  }

  return {
    draft,
    epubValidator: epubValidation.validator,
    expectedInlineIllustrations,
    meaningHash: normalized.normalization.afterMeaningHash,
    mobiValidator: mobiValidation.validator,
    source,
    sourceContentHash: normalized.source.contentHash,
    sourceKind: expectedSourceKind,
  };
}

async function runPublishingWorker(pathToConverter = verifiedEbookConvertPath): Promise<boolean> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const handled = await runWorkerOnce({
      database,
      handlers: {
        "publishing.convert.v1": createPublishingConversionHandler({
          database,
          ebookConvertPath: pathToConverter,
          storage,
        }),
      },
      leaseSeconds: 30,
      queue: "publishing",
      retryDelayMs: 0,
      workerId: `unit03-proof-${Date.now()}-${attempt}`,
    });
    if (handled) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  return false;
}

try {
  await database.query("DROP SCHEMA public CASCADE");
  await database.query("CREATE SCHEMA public");
  const applied = await applyMigrations(database);
  assert.equal(applied.at(-1)?.id, "0004_publishing_pipeline");
  assert.equal((await listAppliedMigrations(database)).length, 4);
  assert.deepEqual(await rollbackLatestMigration(database), {
    direction: "down",
    id: "0004_publishing_pipeline",
  });
  assert.deepEqual(await applyMigrations(database), [
    { direction: "up", id: "0004_publishing_pipeline" },
  ]);
  await seedAuthor();

  const docxProof = await convertAndProve("Ніч над Дніпром", "docx");
  const txtProof = await convertAndProve("Тиха ніч над Києвом", "txt");
  const googleDocsProof = await convertAndProve(
    "Калина над Дніпром",
    "google_docs",
  );
  const conversionProofs = [docxProof, txtProof, googleDocsProof];
  const happyDraft = docxProof.draft;
  const submission = await submitBookDraft(database, storage, {
    authorId,
    draftId: happyDraft.draftId,
    fiveYearLicenseConfirmed: true,
    rightsConfirmed: true,
  });
  assert.deepEqual(
    await submitBookDraft(database, storage, {
      authorId,
      draftId: happyDraft.draftId,
      fiveYearLicenseConfirmed: true,
      rightsConfirmed: true,
    }),
    submission,
  );
  const submittedCounts = await database.query<{
    declarations: number;
    events: number;
    versions: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM publishing_book_versions) AS versions,
        (SELECT COUNT(*)::int FROM publishing_rights_declarations) AS declarations,
        (SELECT COUNT(*)::int FROM outbox_events WHERE event_type = 'BookSubmitted') AS events
    `,
  );
  assert.deepEqual(submittedCounts.rows[0], { declarations: 2, events: 1, versions: 1 });
  await assert.rejects(
    database.query("UPDATE publishing_book_versions SET title = 'mutation' WHERE id = $1", [
      submission.bookVersionId,
    ]),
    /immutable/u,
  );

  let staleDraft = await completeDraft("Застарілий прогін");
  await queueDraftConversion(database, { authorId, draftId: staleDraft.draftId });
  staleDraft = await loadAuthorDraft(database, storage, authorId, staleDraft.draftId);
  await saveDescriptionStep(database, {
    authorId,
    description: `${staleDraft.description} Нова авторська примітка.`,
    draftId: staleDraft.draftId,
    expectedRevision: staleDraft.revision,
    title: staleDraft.title,
  });
  assert.equal(await runPublishingWorker(), true);
  staleDraft = await loadAuthorDraft(database, storage, authorId, staleDraft.draftId);
  assert.equal(staleDraft.status, "draft");
  assert.equal(staleDraft.preview, null);

  let failedDraft = await completeDraft("Відновлювана помилка");
  const failedRunId = await queueDraftConversion(database, {
    authorId,
    draftId: failedDraft.draftId,
  });
  await database.query(
    "UPDATE durable_jobs SET max_attempts = 1 WHERE correlation_id = $1 AND queue = 'publishing'",
    [failedRunId],
  );
  assert.equal(await runPublishingWorker("/definitely/missing/ebook-convert"), true);
  failedDraft = await loadAuthorDraft(database, storage, authorId, failedDraft.draftId);
  assert.equal(failedDraft.status, "conversion_failed");
  assert.equal(failedDraft.conversionFailure?.code, "CALIBRE_UNAVAILABLE");
  assert.ok(failedDraft.manuscriptObjectId);
  const preservedManuscriptObjectId = failedDraft.manuscriptObjectId;
  await queueDraftConversion(database, {
    authorId,
    draftId: failedDraft.draftId,
  });
  assert.equal(await runPublishingWorker(), true);
  failedDraft = await loadAuthorDraft(database, storage, authorId, failedDraft.draftId);
  assert.equal(failedDraft.status, "ready");
  assert.equal(failedDraft.manuscriptObjectId, preservedManuscriptObjectId);
  assert.equal(failedDraft.conversionFailure, null);
  assert.ok(failedDraft.preview);

  const privacy = await database.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM catalog_book_read_models",
  );
  assert.equal(privacy.rows[0]?.count, 0);
  process.stdout.write(
    `${JSON.stringify({
      conversion_error_recovery: "passed",
      conversion_error_retry: "passed",
      conversion_sources: conversionProofs.map((proof) => ({
        epub_validator: proof.epubValidator,
        expected_inline_illustrations: proof.expectedInlineIllustrations,
        meaning_hash: proof.meaningHash,
        mobi_validator: proof.mobiValidator,
        source: proof.source,
        source_content_hash: proof.sourceContentHash,
        source_kind: proof.sourceKind,
      })),
      epub_validator: "epub-container.v1",
      immutable_book_version: "passed",
      inline_illustration: "passed",
      mobi_validator: "legacy-mobi-header.v1",
      private_catalog_boundary: "passed",
      stale_job: "passed",
      status: "passed",
    })}\n`,
  );
} finally {
  await database.close?.();
  await rm(artifactRoot, { force: true, recursive: true });
}
