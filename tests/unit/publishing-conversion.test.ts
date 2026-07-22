import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ArtifactValidationError,
  CalibreEbookConverter,
  ConversionAbortedError,
  ConversionEngineUnavailableError,
  ConversionExecutionError,
  ConversionInputError,
  createCalibreHtmlInput,
  createPreviewDocument,
  ingestDocx,
  ingestGoogleDocsExport,
  ingestTxt,
  normalizeManuscript,
  prepareManuscript,
  inspectRasterImage,
  sha256,
  validateEpub,
  validateLegacyMobi,
  type ConversionProcessRunner,
} from "../../modules/publishing/conversion";
import {
  docxManuscriptFixture,
  googleDocsExportFixture,
  inlineIllustrationPng,
  txtManuscriptFixture,
  ukrainianMetadata,
  validEpubFixture,
  validLegacyMobiFixture,
} from "../fixtures/publishing/conversion-fixtures";

describe("UNIT-03 bounded manuscript conversion enabler", () => {
  it("ingests TXT and performs only traceable technical normalization", () => {
    const ingested = ingestTxt(txtManuscriptFixture(), ukrainianMetadata);
    const normalized = normalizeManuscript(ingested);

    expect(normalized.blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(normalized.blocks[1]).toMatchObject({
      kind: "paragraph",
      runs: [
        { kind: "text", text: "«Київська ніч» — тиха." },
        { kind: "line-break" },
        { kind: "text", text: "Другий рядок." },
      ],
    });
    expect(normalized.normalization).toMatchObject({
      semanticRewrite: false,
      policyVersion: "ukiebook-technical-normalization.v1",
    });
    expect(normalized.normalization.beforeMeaningHash).toBe(
      normalized.normalization.afterMeaningHash,
    );
    expect(normalized.normalization.changes).toEqual(
      expect.arrayContaining(["dashes", "quotes", "whitespace"]),
    );
  });

  it("ingests DOCX headings and preserves inline illustration order and bytes", () => {
    const normalized = normalizeManuscript(
      ingestDocx(docxManuscriptFixture(), ukrainianMetadata),
    );
    expect(normalized.illustrations).toHaveLength(1);
    expect(normalized.illustrations[0]).toMatchObject({
      altText: "Гілка калини над Дніпром",
      contentHash: sha256(inlineIllustrationPng),
      mediaType: "image/png",
    });
    expect(normalized.blocks[1]).toMatchObject({
      kind: "paragraph",
      runs: [
        { kind: "text", text: "«Київська ніч» — тиха." },
        { kind: "illustration", illustrationId: normalized.illustrations[0]?.id },
        { kind: "text", text: "Після ілюстрації." },
      ],
    });

    const html = createCalibreHtmlInput(normalized);
    expect(html.images).toHaveLength(1);
    expect(html.images[0]?.bytes).toEqual(inlineIllustrationPng);
    expect(html.html).toContain("<img src=\"images/illustration-");
    expect(html.html).toContain("alt=\"Гілка калини над Дніпром\"");
  });

  it("records Google Docs export provenance while using the DOCX export adapter", () => {
    const ingested = ingestGoogleDocsExport(
      googleDocsExportFixture(),
      ukrainianMetadata,
    );
    expect(ingested.source).toMatchObject({
      documentId: "google-docs-ukiebook-fixture",
      kind: "google-docs-export",
      revisionId: "revision-7",
    });
    expect(ingested.illustrations).toHaveLength(1);
  });

  it("creates a versioned preview document with section and image blocks", () => {
    const prepared = prepareManuscript({
      metadata: ukrainianMetadata,
      source: docxManuscriptFixture(),
    });
    const preview = createPreviewDocument(prepared.normalizedDocument);
    expect(preview).toMatchObject({
      metadata: ukrainianMetadata,
      normalizedManuscriptHash: prepared.normalizedDocument.contentHash,
      schemaVersion: 1,
      sections: [
        {
          heading: "Розділ 1",
          headingLevel: 1,
          blocks: [
            { kind: "paragraph", text: "«Київська ніч» — тиха." },
            { kind: "image", altText: "Гілка калини над Дніпром" },
            { kind: "paragraph", text: "Після ілюстрації." },
            { kind: "paragraph", text: "Фінальний абзац рукопису." },
          ],
        },
      ],
    });
  });

  it("validates EPUB container/package entries and legacy MOBI headers", () => {
    expect(validateEpub(validEpubFixture())).toEqual({
      contentDocuments: ["OEBPS/chapter.xhtml"],
      imageEntries: ["OEBPS/images/illustration.png"],
      packageDocument: "OEBPS/content.opf",
      spineDocuments: ["OEBPS/chapter.xhtml"],
      validator: "epub-container.v1",
    });
    const fixtureMobi = Buffer.from(validLegacyMobiFixture());
    const firstRecordOffset = fixtureMobi.readUInt32BE(78);
    const validMobi = Buffer.alloc(firstRecordOffset + 16 + 232);
    fixtureMobi.copy(validMobi);
    validMobi.writeUInt32BE(232, firstRecordOffset + 20);
    validMobi.writeUInt32BE(65_001, firstRecordOffset + 28);
    validMobi.writeUInt32BE(6, firstRecordOffset + 36);
    expect(validateLegacyMobi(validMobi)).toMatchObject({
      fileVersion: 6,
      headerLength: 232,
      recordCount: 1,
      signature: "BOOKMOBI",
      textEncoding: 65_001,
      validator: "legacy-mobi-header.v1",
    });
    const hybridMobi = Buffer.alloc(340);
    hybridMobi.write("BOOKMOBI", 60, "ascii");
    hybridMobi.writeUInt16BE(2, 76);
    hybridMobi.writeUInt32BE(96, 78);
    hybridMobi.writeUInt32BE(320, 86);
    hybridMobi.write("MOBI", 112, "ascii");
    hybridMobi.writeUInt32BE(200, 116);
    hybridMobi.writeUInt32BE(65_001, 124);
    hybridMobi.writeUInt32BE(6, 132);
    hybridMobi.write("BOUNDARY", 320, "ascii");
    expect(() => validateLegacyMobi(hybridMobi)).toThrow(
      "Hybrid MOBI/KF8 output is not the required legacy-only MOBI format",
    );
    expect(() => validateEpub(new Uint8Array([1, 2, 3]))).toThrow(
      ArtifactValidationError,
    );
    expect(() => validateLegacyMobi(new Uint8Array(128))).toThrow(
      ArtifactValidationError,
    );
  });

  it("rejects mismatched ZIP metadata and active/non-raster illustration payloads", () => {
    const mismatchedLocalName = Buffer.from(validEpubFixture());
    mismatchedLocalName[30] = "x".charCodeAt(0);
    expect(() => validateEpub(mismatchedLocalName)).toThrow(
      ArtifactValidationError,
    );
    expect(inspectRasterImage(inlineIllustrationPng)).toEqual({
      height: 1,
      mediaType: "image/png",
      width: 1,
    });
    expect(() =>
      inspectRasterImage(new TextEncoder().encode("<svg><script /></svg>")),
    ).toThrow("Only bounded PNG, JPEG, and GIF images are supported");
  });

  it("returns a typed deployment blocker when Calibre is absent", async () => {
    const normalized = normalizeManuscript(
      ingestTxt(txtManuscriptFixture(), ukrainianMetadata),
    );
    const converter = new CalibreEbookConverter({
      executablePath: "/definitely-missing/ebook-convert",
    });
    await expect(
      converter.convert({ bookVersionId: "version-fixture", manuscript: normalized }),
    ).rejects.toMatchObject({
      blocker: {
        code: "CONVERSION_ENGINE_UNAVAILABLE",
        engine: "calibre-ebook-convert",
        type: "missing-conversion-engine",
      },
      code: "CONVERSION_ENGINE_UNAVAILABLE",
    });
    await expect(
      converter.convert({ bookVersionId: "version-fixture", manuscript: normalized }),
    ).rejects.toBeInstanceOf(ConversionEngineUnavailableError);
    await expect(
      converter.convert({
        bookVersionId: "version-fixture",
        cover: {
          bytes: new TextEncoder().encode("not an image"),
          fileName: "cover.png",
          mediaType: "image/png",
        },
        manuscript: normalized,
      }),
    ).rejects.toBeInstanceOf(ConversionInputError);
  });

  it("bounds generated artifact size before loading converter output into memory", async () => {
    const normalized = normalizeManuscript(
      ingestTxt(txtManuscriptFixture(), ukrainianMetadata),
    );
    const processRunner: ConversionProcessRunner = {
      async run(_executablePath, arguments_) {
        if (arguments_[0] === "--version") {
          return {
            exitCode: 0,
            signal: null,
            stderr: "",
            stdout: "ebook-convert (calibre 9.11.0)",
          };
        }
        const outputPath = arguments_[1];
        if (!outputPath) {
          throw new Error("Fixture converter output path is missing");
        }
        await writeFile(outputPath, Buffer.alloc(9));
        return { exitCode: 0, signal: null, stderr: "", stdout: "" };
      },
    };
    const converter = new CalibreEbookConverter({
      executablePath: "/fixture/ebook-convert",
      maxArtifactBytes: 8,
      processRunner,
    });
    await expect(
      converter.convert({ bookVersionId: "bounded-output", manuscript: normalized }),
    ).rejects.toMatchObject({
      code: "CONVERSION_EXECUTION_FAILED",
      format: "epub",
    });
    await expect(
      converter.convert({ bookVersionId: "bounded-output", manuscript: normalized }),
    ).rejects.toBeInstanceOf(ConversionExecutionError);
  });

  it("does not misreport an aborted worker conversion as a missing engine", async () => {
    const controller = new AbortController();
    controller.abort();
    const converter = new CalibreEbookConverter({
      executablePath: "/fixture/ebook-convert",
      signal: controller.signal,
    });
    const normalized = normalizeManuscript(
      ingestTxt(txtManuscriptFixture(), ukrainianMetadata),
    );
    await expect(
      converter.convert({ bookVersionId: "aborted-output", manuscript: normalized }),
    ).rejects.toBeInstanceOf(ConversionAbortedError);
  });
});
