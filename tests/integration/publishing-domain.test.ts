import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../../db/migrate";
import { adaptPGlite } from "../../db/pglite";
import type { SqlDatabase } from "../../modules/platform/sql-port";
import { listAuthorBooks } from "../../modules/publishing/server/repository";
import {
  createAuthorDraft,
  generateFallbackCover,
  importGoogleDocument,
  loadAuthorDraft,
  persistPrivateBuffer,
  PublishingConflictError,
  PublishingInputError,
  queueDraftConversion,
  saveCommerceStep,
  saveDescriptionStep,
  saveSampleSection,
  submitBookDraft,
  uploadCover,
  uploadManuscript,
} from "../../modules/publishing/server/service";
import { LocalPrivateObjectStorage } from "../../modules/publishing/storage/private-object-storage";
import { PUBLISHING_SCHEMA_VERSION, type PreviewDocument } from "../../modules/publishing/types";
import { docxBytesFixture } from "../fixtures/publishing/conversion-fixtures";

const authorId = "11111111-1111-4111-8111-111111111111";

describe("UNIT-03 publishing domain", () => {
  let pglite: PGlite;
  let database: SqlDatabase;
  let storageRoot: string;
  let storage: LocalPrivateObjectStorage;

  beforeEach(async () => {
    pglite = await PGlite.create();
    database = adaptPGlite(pglite);
    await applyMigrations(database);
    await database.query(
      "INSERT INTO users (id, private_email) VALUES ($1, 'author@example.invalid')",
      [authorId],
    );
    await database.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'author')", [
      authorId,
    ]);
    await database.query(
      "INSERT INTO author_profiles (user_id, public_name) VALUES ($1, 'Олена Вітрова')",
      [authorId],
    );
    await database.query(
      "INSERT INTO catalog_genres (slug, label) VALUES ('proza', 'Проза'), ('fantastyka', 'Фантастика')",
    );
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "ukiebook-publishing-test-"));
    storage = new LocalPrivateObjectStorage(storageRoot);
  });

  afterEach(async () => {
    await database.close?.();
    if (storageRoot) await rm(storageRoot, { force: true, recursive: true });
  });

  it("preserves a draft through validation, conversion handoff and idempotent submission", async () => {
    let draft = await createAuthorDraft(database, storage, authorId);
    await expect(
      uploadManuscript(database, storage, {
        authorId,
        bytes: Buffer.from("%PDF broken"),
        draftId: draft.draftId,
        fileName: "wrong.pdf",
        maxBytes: 1_000_000,
        mediaType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MANUSCRIPT" } satisfies Partial<PublishingInputError>);
    expect((await loadAuthorDraft(database, storage, authorId, draft.draftId)).manuscriptObjectId).toBeNull();

    draft = await uploadManuscript(database, storage, {
      authorId,
      bytes: Buffer.from('# Розділ 1\n\n  "Тиха ніч"  -  над Дніпром.\n\nФінал.'),
      draftId: draft.draftId,
      fileName: "nich.txt",
      maxBytes: 1_000_000,
      mediaType: "text/plain",
    });
    await expect(listAuthorBooks(database, authorId)).resolves.toMatchObject([
      {
        currentStep: 2,
        draftId: draft.draftId,
        draftStatus: "draft",
        status: "draft",
      },
    ]);
    await saveDescriptionStep(database, {
      authorId,
      description: "Тиха українська проза про нічну подорож Дніпром.",
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      title: "Ніч над Дніпром",
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
    draft = await loadAuthorDraft(database, storage, authorId, draft.draftId);
    const conversionRunId = await queueDraftConversion(database, {
      authorId,
      draftId: draft.draftId,
    });
    await expect(
      database.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM durable_jobs WHERE queue = 'publishing' AND job_type = 'publishing.convert.v1'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    const previewDocument: PreviewDocument = {
      authorPublicName: "Олена Вітрова",
      schemaVersion: PUBLISHING_SCHEMA_VERSION,
      sections: [
        {
          blocks: [{ kind: "paragraph", text: "Тиха ніч — над Дніпром." }],
          heading: "Розділ 1",
        },
        {
          blocks: [{ kind: "paragraph", text: "Ранок повернув човен до берега." }],
          heading: "Розділ 2",
        },
      ],
      title: "Ніч над Дніпром",
    };
    const [normalized, preview, epub, mobi] = await Promise.all([
      persistPrivateBuffer(database, storage, {
        authorId,
        bytes: Buffer.from('{"normalized":true}'),
        kind: "normalized",
        mediaType: "application/json",
        originalName: "normalized.json",
      }),
      persistPrivateBuffer(database, storage, {
        authorId,
        bytes: Buffer.from(JSON.stringify(previewDocument)),
        kind: "preview",
        mediaType: "application/json",
        originalName: "preview.json",
      }),
      persistPrivateBuffer(database, storage, {
        authorId,
        bytes: Buffer.from("epub-fixture"),
        kind: "epub",
        mediaType: "application/epub+zip",
        originalName: "book.epub",
      }),
      persistPrivateBuffer(database, storage, {
        authorId,
        bytes: Buffer.from("mobi-fixture"),
        kind: "mobi",
        mediaType: "application/x-mobipocket-ebook",
        originalName: "book.mobi",
      }),
    ]);
    await database.query(
      `
        UPDATE publishing_conversion_runs
        SET status = 'completed', normalized_object_id = $1, completed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [normalized.id, conversionRunId],
    );
    await database.query(
      `
        INSERT INTO publishing_preview_artifacts (
          id, draft_id, conversion_run_id, preview_object_id,
          epub_object_id, mobi_object_id, content_sha256
        ) VALUES ('22222222-2222-4222-8222-222222222222', $1, $2, $3, $4, $5, $6)
      `,
      [draft.draftId, conversionRunId, preview.id, epub.id, mobi.id, preview.sha256],
    );
    await database.query("UPDATE publishing_book_drafts SET status = 'ready' WHERE id = $1", [
      draft.draftId,
    ]);
    draft = await loadAuthorDraft(database, storage, authorId, draft.draftId);
    expect(draft.preview?.document.sections[0]?.heading).toBe("Розділ 1");
    expect(draft.sampleSectionIndex).toBeNull();

    await expect(
      submitBookDraft(database, storage, {
        authorId,
        draftId: draft.draftId,
        fiveYearLicenseConfirmed: true,
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "SAMPLE" } satisfies Partial<PublishingInputError>);
    await expect(
      saveSampleSection(database, storage, {
        authorId,
        draftId: draft.draftId,
        previewArtifactId: draft.preview!.artifactId,
        sampleSectionIndex: 2,
      }),
    ).rejects.toMatchObject({ code: "SAMPLE" } satisfies Partial<PublishingInputError>);
    await saveSampleSection(database, storage, {
      authorId,
      draftId: draft.draftId,
      previewArtifactId: draft.preview!.artifactId,
      sampleSectionIndex: 1,
    });
    draft = await loadAuthorDraft(database, storage, authorId, draft.draftId);
    expect(draft).toMatchObject({
      samplePreviewArtifactId: draft.preview!.artifactId,
      sampleSectionIndex: 1,
    });
    await database.query(
      "UPDATE publishing_book_drafts SET sample_section_index = 99 WHERE id = $1",
      [draft.draftId],
    );
    await expect(
      submitBookDraft(database, storage, {
        authorId,
        draftId: draft.draftId,
        fiveYearLicenseConfirmed: true,
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "SAMPLE" } satisfies Partial<PublishingInputError>);
    await saveSampleSection(database, storage, {
      authorId,
      draftId: draft.draftId,
      previewArtifactId: draft.preview!.artifactId,
      sampleSectionIndex: 1,
    });

    await expect(
      submitBookDraft(database, storage, {
        authorId,
        draftId: draft.draftId,
        fiveYearLicenseConfirmed: true,
        rightsConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATIONS_REQUIRED" } satisfies Partial<PublishingInputError>);

    const submitted = await submitBookDraft(database, storage, {
      authorId,
      draftId: draft.draftId,
      fiveYearLicenseConfirmed: true,
      rightsConfirmed: true,
    });
    await expect(
      submitBookDraft(database, storage, {
        authorId,
        draftId: draft.draftId,
        fiveYearLicenseConfirmed: true,
        rightsConfirmed: true,
      }),
    ).resolves.toEqual(submitted);
    const counts = await database.query<{
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
    expect(counts.rows[0]).toEqual({ declarations: 2, events: 1, versions: 1 });
    await expect(
      database.query<{ sample_section_index: number }>(
        "SELECT sample_section_index FROM publishing_book_versions WHERE id = $1",
        [submitted.bookVersionId],
      ),
    ).resolves.toMatchObject({ rows: [{ sample_section_index: 1 }] });
    await expect(
      database.query("UPDATE publishing_book_versions SET title = 'mutated' WHERE id = $1", [
        submitted.bookVersionId,
      ]),
    ).rejects.toThrow(/immutable/u);
    await expect(
      database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM catalog_book_read_models"),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    const books = await listAuthorBooks(database, authorId);
    expect(books).toMatchObject([{ status: "submitted", title: "Ніч над Дніпром" }]);
  });

  it("does not let a stale fallback render overwrite a concurrently changed draft", async () => {
    const draft = await createAuthorDraft(database, storage, authorId);
    await saveDescriptionStep(database, {
      authorId,
      description: "Опис для перевірки конкурентного створення обкладинки.",
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      title: "Конкурентна обкладинка",
    });

    let intercepted = false;
    const raceDatabase: SqlDatabase = {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        parameters: readonly unknown[] = [],
      ) => {
        const result = await database.query<Row>(text, parameters);
        if (
          !intercepted &&
          text.includes("FROM publishing_book_drafts d") &&
          text.includes("WHERE d.id = $1")
        ) {
          intercepted = true;
          await database.query(
            `
              UPDATE publishing_book_drafts
              SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `,
            [draft.draftId],
          );
        }
        return result;
      },
    };

    await expect(
      generateFallbackCover(raceDatabase, storage, {
        authorId,
        draftId: draft.draftId,
      }),
    ).rejects.toBeInstanceOf(PublishingConflictError);
    await expect(
      database.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM publishing_private_objects WHERE object_kind = 'cover'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(loadAuthorDraft(database, storage, authorId, draft.draftId)).resolves.toMatchObject({
      coverObjectId: null,
      coverMode: "fallback",
    });
  });

  it("rejects decodable image formats outside the PNG, JPEG and WebP contract", async () => {
    const draft = await createAuthorDraft(database, storage, authorId);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="red"/></svg>',
    );

    await expect(
      uploadCover(database, storage, {
        authorId,
        bytes: svg,
        draftId: draft.draftId,
        fileName: "not-really-a-cover.png",
        maxBytes: 1_000_000,
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE",
    } satisfies Partial<PublishingInputError>);
    await expect(loadAuthorDraft(database, storage, authorId, draft.draftId)).resolves.toMatchObject({
      coverObjectId: null,
    });
  });

  it("imports a Google Docs DOCX export through the dedicated adapter without identity tokens", async () => {
    const draft = await createAuthorDraft(database, storage, authorId);
    const imported = await importGoogleDocument(database, storage, {
      authorId,
      documentUrl: "https://docs.google.com/document/d/fixture-document/edit",
      draftId: draft.draftId,
      exportOrigin: "https://docs.google.com",
      fetcher: async () =>
        new Response(new Uint8Array(docxBytesFixture()), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          status: 200,
        }),
      maxBytes: 1_000_000,
    });
    expect(imported).toMatchObject({
      sourceReference: "fixture-document",
      sourceType: "google_docs",
      status: "draft",
    });
    const privateData = await database.query<{ private_email: string }>(
      "SELECT private_email FROM users WHERE id = $1",
      [authorId],
    );
    expect(privateData.rows[0]?.private_email).toBe("author@example.invalid");
  });
});
