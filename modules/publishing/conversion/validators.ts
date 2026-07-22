import path from "node:path";

import { ArtifactValidationError, ZipArchiveError } from "./errors";
import type {
  EpubValidationReceipt,
  MobiValidationReceipt,
} from "./types";
import { readZipArchive } from "./zip";

function decodeUtf8(bytes: Uint8Array, description: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ArtifactValidationError("epub", `${description} is not valid UTF-8`, {
      cause: error,
    });
  }
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function readAttribute(fragment: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = fragment.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "u"),
  );
  return match ? decodeXmlAttribute(match[1] ?? match[2] ?? "") : null;
}

function safePackagePath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/^\/+/, ""));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ArtifactValidationError(
      "epub",
      "EPUB package document escapes the container",
    );
  }
  return normalized;
}

function decodeManifestHref(value: string): string {
  try {
    return decodeURIComponent(value.split("#", 1)[0] ?? "");
  } catch (error) {
    throw new ArtifactValidationError("epub", "EPUB manifest href is malformed", {
      cause: error,
    });
  }
}

export function validateEpub(input: Uint8Array): EpubValidationReceipt {
  let archive;
  try {
    archive = readZipArchive(input, {
      maxEntries: 10_000,
      maxEntryBytes: 64 * 1024 * 1024,
      maxTotalBytes: 512 * 1024 * 1024,
    });
  } catch (error) {
    throw new ArtifactValidationError("epub", "EPUB is not a valid bounded ZIP archive", {
      cause: error instanceof ZipArchiveError ? error : undefined,
    });
  }
  const mimetype = archive.entries.get("mimetype");
  if (!mimetype) {
    throw new ArtifactValidationError("epub", "EPUB mimetype entry is missing");
  }
  const firstPhysicalOffset = Math.min(
    ...archive.orderedEntries.map((entry) => entry.localHeaderOffset),
  );
  if (mimetype.localHeaderOffset !== firstPhysicalOffset || mimetype.compressionMethod !== 0) {
    throw new ArtifactValidationError(
      "epub",
      "EPUB mimetype must be the first uncompressed entry",
    );
  }
  if (decodeUtf8(mimetype.bytes, "EPUB mimetype") !== "application/epub+zip") {
    throw new ArtifactValidationError("epub", "EPUB mimetype value is invalid");
  }
  const container = archive.entries.get("META-INF/container.xml");
  if (!container) {
    throw new ArtifactValidationError("epub", "EPUB container.xml is missing");
  }
  const containerXml = decodeUtf8(container.bytes, "EPUB container.xml");
  const rootfileAttributes = containerXml.match(/<rootfile\b([^>]*?)\/?\s*>/u)?.[1] ?? "";
  const packagePathAttribute = readAttribute(rootfileAttributes, "full-path");
  const packageMediaType = readAttribute(rootfileAttributes, "media-type");
  if (
    !packagePathAttribute ||
    packageMediaType !== "application/oebps-package+xml"
  ) {
    throw new ArtifactValidationError(
      "epub",
      "EPUB container does not identify an OPF package document",
    );
  }
  const packageDocument = safePackagePath(packagePathAttribute);
  const packageEntry = archive.entries.get(packageDocument);
  if (!packageEntry) {
    throw new ArtifactValidationError(
      "epub",
      `EPUB package document is missing: ${packageDocument}`,
    );
  }
  const packageXml = decodeUtf8(packageEntry.bytes, "EPUB package document");
  if (!/<package\b/u.test(packageXml) || !/<manifest\b/u.test(packageXml) || !/<spine\b/u.test(packageXml)) {
    throw new ArtifactValidationError(
      "epub",
      "EPUB package document is missing package, manifest, or spine metadata",
    );
  }
  const packageDirectory = path.posix.dirname(packageDocument);
  const contentDocuments: string[] = [];
  const imageEntries: string[] = [];
  const manifest = new Map<
    string,
    { readonly entryPath: string; readonly mediaType: string }
  >();
  for (const itemMatch of packageXml.matchAll(/<item\b([^>]*?)\/?\s*>/gu)) {
    const attributes = itemMatch[1] ?? "";
    const id = readAttribute(attributes, "id");
    const href = readAttribute(attributes, "href");
    const mediaType = readAttribute(attributes, "media-type");
    if (!id || !href || !mediaType) {
      throw new ArtifactValidationError(
        "epub",
        "EPUB manifest item is missing id, href, or media-type",
      );
    }
    if (manifest.has(id)) {
      throw new ArtifactValidationError(
        "epub",
        `EPUB manifest contains a duplicate id: ${id}`,
      );
    }
    const decodedHref = decodeManifestHref(href);
    const entryPath = safePackagePath(
      packageDirectory === "."
        ? decodedHref
        : path.posix.join(packageDirectory, decodedHref),
    );
    if (!archive.entries.has(entryPath)) {
      throw new ArtifactValidationError(
        "epub",
        `EPUB manifest entry is missing from the container: ${entryPath}`,
      );
    }
    manifest.set(id, { entryPath, mediaType });
    if (mediaType === "application/xhtml+xml") {
      const content = archive.entries.get(entryPath);
      const contentXml = decodeUtf8(content!.bytes, `EPUB content document ${entryPath}`);
      if (!/<html\b/u.test(contentXml) || !/<body\b/u.test(contentXml)) {
        throw new ArtifactValidationError(
          "epub",
          `EPUB content document has no HTML body: ${entryPath}`,
        );
      }
      contentDocuments.push(entryPath);
    } else if (mediaType.startsWith("image/")) {
      imageEntries.push(entryPath);
    }
  }
  if (contentDocuments.length === 0) {
    throw new ArtifactValidationError(
      "epub",
      "EPUB manifest has no XHTML content documents",
    );
  }
  const spineDocuments: string[] = [];
  for (const itemrefMatch of packageXml.matchAll(/<itemref\b([^>]*?)\/?\s*>/gu)) {
    const idref = readAttribute(itemrefMatch[1] ?? "", "idref");
    const item = idref ? manifest.get(idref) : undefined;
    if (!idref || !item || item.mediaType !== "application/xhtml+xml") {
      throw new ArtifactValidationError(
        "epub",
        `EPUB spine references an invalid content item: ${idref ?? "missing"}`,
      );
    }
    spineDocuments.push(item.entryPath);
  }
  if (spineDocuments.length === 0) {
    throw new ArtifactValidationError("epub", "EPUB spine has no content documents");
  }

  return {
    contentDocuments,
    imageEntries,
    packageDocument,
    spineDocuments,
    validator: "epub-container.v1",
  };
}

export function validateLegacyMobi(input: Uint8Array): MobiValidationReceipt {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length < 96) {
    throw new ArtifactValidationError("mobi", "MOBI file is too short");
  }
  const signature = buffer.subarray(60, 68).toString("ascii");
  if (signature !== "BOOKMOBI") {
    throw new ArtifactValidationError(
      "mobi",
      `MOBI PalmDB signature is invalid: ${signature || "missing"}`,
    );
  }
  const recordCount = buffer.readUInt16BE(76);
  const recordTableEnd = 78 + recordCount * 8;
  if (recordCount < 1 || recordTableEnd > buffer.length) {
    throw new ArtifactValidationError("mobi", "MOBI record table is invalid");
  }
  const recordOffsets: number[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = buffer.readUInt32BE(78 + index * 8);
    if (
      offset < recordTableEnd ||
      offset >= buffer.length ||
      (index > 0 && offset <= recordOffsets[index - 1]!)
    ) {
      throw new ArtifactValidationError("mobi", "MOBI record offsets are invalid");
    }
    recordOffsets.push(offset);
  }
  if (
    recordOffsets.some(
      (offset, index) =>
        index > 0 &&
        buffer.subarray(offset, offset + 8).toString("ascii") === "BOUNDARY",
    )
  ) {
    throw new ArtifactValidationError(
      "mobi",
      "Hybrid MOBI/KF8 output is not the required legacy-only MOBI format",
    );
  }
  const firstRecordOffset = recordOffsets[0]!;
  if (firstRecordOffset + 40 > buffer.length) {
    throw new ArtifactValidationError("mobi", "MOBI first record offset is invalid");
  }
  const mobiHeader = buffer.subarray(firstRecordOffset + 16, firstRecordOffset + 20).toString("ascii");
  if (mobiHeader !== "MOBI") {
    throw new ArtifactValidationError("mobi", "Legacy MOBI header is missing");
  }
  const headerLength = buffer.readUInt32BE(firstRecordOffset + 20);
  const textEncoding = buffer.readUInt32BE(firstRecordOffset + 28);
  const fileVersion = buffer.readUInt32BE(firstRecordOffset + 36);
  const firstRecordEnd = recordOffsets[1] ?? buffer.length;
  if (
    headerLength < 116 ||
    firstRecordOffset + 16 + headerLength > firstRecordEnd
  ) {
    throw new ArtifactValidationError("mobi", "MOBI header length is invalid");
  }
  if (textEncoding !== 65_001) {
    throw new ArtifactValidationError(
      "mobi",
      `MOBI text encoding is not UTF-8: ${textEncoding}`,
    );
  }
  if (fileVersion !== 6) {
    throw new ArtifactValidationError(
      "mobi",
      `MOBI output is not the required legacy MOBI 6 format: ${fileVersion}`,
    );
  }

  return {
    fileVersion: 6,
    firstRecordOffset,
    headerLength,
    recordCount,
    signature: "BOOKMOBI",
    textEncoding: 65_001,
    validator: "legacy-mobi-header.v1",
  };
}
