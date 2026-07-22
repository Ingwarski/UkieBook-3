import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  convertManuscript,
  inspectRasterImage,
  readZipArchive,
  sha256,
  validateEpub,
} from "../../modules/publishing/conversion";
import {
  docxManuscriptFixture,
  ukrainianMetadata,
} from "../fixtures/publishing/conversion-fixtures";

const ebookConvertPath = process.env.CALIBRE_EBOOK_CONVERT_PATH;
const requiredEbookConvertPath =
  ebookConvertPath ?? "/missing-calibre/ebook-convert";

async function inspectWithCalibre(
  executablePath: string,
  arguments_: readonly string[],
) {
  return new Promise<{ readonly stderr: string; readonly stdout: string }>(
    (resolve, reject) => {
      const child = spawn(executablePath, arguments_, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        const result = {
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdout: Buffer.concat(stdout).toString("utf8"),
        };
        if (exitCode === 0) {
          resolve(result);
        } else {
          reject(
            new Error(
              `ebook-meta failed with exit ${String(exitCode)} / ${String(signal)}: ${result.stderr}`,
            ),
          );
        }
      });
    },
  );
}

describe("UNIT-03 Calibre EPUB and legacy MOBI proof", () => {
  it.skipIf(!ebookConvertPath)(
    "converts a Ukrainian DOCX with inline illustration into validated private artifacts",
    async () => {
      const source = docxManuscriptFixture();
      const cover = await readFile(
        new URL("../../public/books/covers/final/sad-kamianykh-ptakhiv.png", import.meta.url),
      );
      const result = await convertManuscript(
        {
          bookVersionId: "unit03-calibre-proof-v1",
          cover: {
            bytes: cover,
            fileName: "sad-kamianykh-ptakhiv.png",
            mediaType: "image/png",
          },
          metadata: ukrainianMetadata,
          source,
        },
        {
          ebookConvertPath: requiredEbookConvertPath,
          now: () => new Date("2026-07-22T12:00:00.000Z"),
          timeoutMs: 120_000,
        },
      );

      expect(result.conversionResult).toMatchObject({
        bookVersionId: "unit03-calibre-proof-v1",
        conversionVersion: 1,
        createdAt: "2026-07-22T12:00:00.000Z",
        engine: { name: "calibre-ebook-convert", version: "9.11.0" },
        normalizedManuscriptHash: result.normalizedDocument.contentHash,
        sourceArtifactHash: sha256(source.bytes),
      });
      expect(result.epub.byteLength).toBeGreaterThan(0);
      expect(result.mobi.byteLength).toBeGreaterThan(0);
      expect(result.validators.epub).toMatchObject({
        spineDocuments: expect.arrayContaining([expect.stringMatching(/\.xhtml$/u)]),
        validator: "epub-container.v1",
      });
      expect(result.validators.mobi).toMatchObject({
        fileVersion: 6,
        signature: "BOOKMOBI",
        textEncoding: 65_001,
        validator: "legacy-mobi-header.v1",
      });
      const [epubArtifact, mobiArtifact] = result.conversionResult.artifacts;
      expect(epubArtifact).toMatchObject({
        artifactVersion: 1,
        contentHash: sha256(result.epub),
        visibility: "private",
      });
      expect(epubArtifact.storageKey).toMatch(
        /^publishing\/private\/book-versions\/unit03-calibre-proof-v1\/conversion-v1\/[a-f0-9]{64}\.epub$/u,
      );
      expect(mobiArtifact).toMatchObject({
        artifactVersion: 1,
        contentHash: sha256(result.mobi),
        visibility: "private",
      });
      expect(result.normalizedDocument.illustrations).toHaveLength(1);
      expect(result.validators.epub.imageEntries.length).toBeGreaterThan(0);
      const epubArchive = readZipArchive(result.epub);
      const epubReadingDocuments = result.validators.epub.spineDocuments.map(
        (entryName) =>
          new TextDecoder().decode(epubArchive.entries.get(entryName)?.bytes),
      );
      const epubReadingText = epubReadingDocuments.join("\n");
      expect(epubReadingText).toContain("Гілка калини над Дніпром");
      expect(epubReadingText).toContain("Після ілюстрації");
      expect(
        epubReadingDocuments.find((document) =>
          document.includes("Після ілюстрації"),
        ),
      ).toMatch(/<img\b/u);

      const inspectionDirectory = await mkdtemp(
        path.join(os.tmpdir(), "ukiebook-calibre-proof-"),
      );
      try {
        const epubPath = path.join(inspectionDirectory, "proof.epub");
        const mobiPath = path.join(inspectionDirectory, "proof.mobi");
        const mobiRoundTripPath = path.join(
          inspectionDirectory,
          "mobi-roundtrip.epub",
        );
        const epubCoverPath = path.join(inspectionDirectory, "epub-cover.bin");
        const mobiCoverPath = path.join(inspectionDirectory, "mobi-cover.bin");
        await Promise.all([
          writeFile(epubPath, result.epub),
          writeFile(mobiPath, result.mobi),
        ]);
        const ebookMetaPath = path.join(
          path.dirname(requiredEbookConvertPath),
          "ebook-meta",
        );
        const [epubMetadata, mobiMetadata] = await Promise.all([
          inspectWithCalibre(ebookMetaPath, [
            epubPath,
            `--get-cover=${epubCoverPath}`,
          ]),
          inspectWithCalibre(ebookMetaPath, [
            mobiPath,
            `--get-cover=${mobiCoverPath}`,
          ]),
        ]);
        for (const metadata of [epubMetadata, mobiMetadata]) {
          expect(metadata.stderr).toBe("");
          expect(metadata.stdout).toContain("Title               : Ніч над Дніпром");
          expect(metadata.stdout).toContain("Author(s)           : Олена Вітрова");
          expect(metadata.stdout).toContain("Languages           : ukr");
        }
        for (const coverPath of [epubCoverPath, mobiCoverPath]) {
          const extractedCover = inspectRasterImage(await readFile(coverPath));
          expect(extractedCover.width).toBeGreaterThan(100);
          expect(extractedCover.height).toBeGreaterThan(100);
        }
        await inspectWithCalibre(requiredEbookConvertPath, [
          mobiPath,
          mobiRoundTripPath,
        ]);
        const mobiRoundTripBytes = await readFile(mobiRoundTripPath);
        const mobiRoundTripValidation = validateEpub(mobiRoundTripBytes);
        const mobiRoundTripArchive = readZipArchive(mobiRoundTripBytes);
        const mobiManuscriptDocument = mobiRoundTripValidation.spineDocuments
          .map((entryName) =>
            new TextDecoder().decode(
              mobiRoundTripArchive.entries.get(entryName)?.bytes,
            ),
          )
          .find((document) => document.includes("Після ілюстрації"));
        expect(mobiManuscriptDocument).toContain("Київська ніч");
        expect(mobiManuscriptDocument).toMatch(/<img\b/u);
      } finally {
        await rm(inspectionDirectory, { force: true, recursive: true });
      }
    },
    120_000,
  );
});
