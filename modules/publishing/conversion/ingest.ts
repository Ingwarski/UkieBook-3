import path from "node:path";

import { ManuscriptIngestionError, ZipArchiveError } from "./errors";
import { sha256 } from "./hash";
import {
  inspectRasterImage,
  InvalidRasterImageError,
  type SupportedRasterMediaType,
} from "./raster";
import {
  INGESTED_MANUSCRIPT_SCHEMA_VERSION,
  type DocxManuscriptSource,
  type GoogleDocsExportSource,
  type IngestedManuscript,
  type ManuscriptBlock,
  type ManuscriptIllustration,
  type ManuscriptInlineRun,
  type ManuscriptMetadata,
  type ManuscriptSource,
  type ManuscriptSourceReceipt,
  type TxtManuscriptSource,
} from "./types";
import { readZipArchive, type ZipArchive } from "./zip";

const DOCX_DOCUMENT_PATH = "word/document.xml";
const DOCX_RELATIONSHIPS_PATH = "word/_rels/document.xml.rels";

const imageMediaTypes = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
} as const;

type SupportedImageMediaType = SupportedRasterMediaType;

function requireMetadata(metadata: ManuscriptMetadata): ManuscriptMetadata {
  const title = metadata.title.trim();
  const authorName = metadata.authorName.trim();
  if (title.length === 0 || authorName.length === 0 || metadata.language !== "uk") {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      "A Ukrainian manuscript requires a title and Author name",
    );
  }
  return { authorName, language: "uk", title };
}

function sourceReceipt(source: ManuscriptSource): ManuscriptSourceReceipt {
  return {
    artifactVersion: source.artifactVersion,
    contentHash: sha256(source.bytes),
    documentId: source.kind === "google-docs-export" ? source.documentId : null,
    fileName: source.fileName,
    kind: source.kind,
    mediaType: source.mediaType,
    revisionId: source.kind === "google-docs-export" ? source.revisionId : null,
  };
}

function decodeUtf8(bytes: Uint8Array, description: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/u, "");
  } catch (error) {
    throw new ManuscriptIngestionError(
      "SOURCE_ENCODING_INVALID",
      `${description} is not valid UTF-8`,
      { cause: error },
    );
  }
}

function xmlDecode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function readAttribute(fragment: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = fragment.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "u"),
  );
  return match ? xmlDecode(match[1] ?? match[2] ?? "") : null;
}

function textRuns(lines: readonly string[]): ManuscriptInlineRun[] {
  const runs: ManuscriptInlineRun[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      runs.push({ kind: "line-break" });
    }
    if (line.length > 0) {
      runs.push({ kind: "text", text: line });
    }
  });
  return runs;
}

export function ingestTxt(
  source: TxtManuscriptSource,
  metadata: ManuscriptMetadata,
): IngestedManuscript {
  const value = decodeUtf8(source.bytes, source.fileName).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const blocks: ManuscriptBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.some((line) => line.trim().length > 0)) {
      blocks.push({ kind: "paragraph", runs: textRuns(paragraphLines) });
    }
    paragraphLines = [];
  };

  for (const line of value.split("\n")) {
    const heading = line.match(/^(#{1,6})[\t ]+(.+)$/u);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        runs: [{ kind: "text", text: heading[2]! }],
      });
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }
    paragraphLines.push(line);
  }
  flushParagraph();

  if (blocks.length === 0) {
    throw new ManuscriptIngestionError("MANUSCRIPT_EMPTY", "The TXT manuscript is empty");
  }

  return {
    blocks,
    illustrations: [],
    metadata: requireMetadata(metadata),
    schemaVersion: INGESTED_MANUSCRIPT_SCHEMA_VERSION,
    source: sourceReceipt(source),
    stage: "ingested",
  };
}

interface DocxRelationship {
  readonly external: boolean;
  readonly id: string;
  readonly target: string;
}

function parseRelationships(xml: string): ReadonlyMap<string, DocxRelationship> {
  const relationships = new Map<string, DocxRelationship>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)\/?\s*>/gu)) {
    const attributes = match[1] ?? "";
    const id = readAttribute(attributes, "Id");
    const target = readAttribute(attributes, "Target");
    if (!id || !target) {
      continue;
    }
    relationships.set(id, {
      external: readAttribute(attributes, "TargetMode") === "External",
      id,
      target,
    });
  }
  return relationships;
}

function contentTypeForImage(
  entryName: string,
  contentTypesXml: string | null,
): SupportedImageMediaType | null {
  if (contentTypesXml) {
    for (const match of contentTypesXml.matchAll(/<(?:Default|Override)\b([^>]*?)\/?\s*>/gu)) {
      const attributes = match[1] ?? "";
      const extension = readAttribute(attributes, "Extension")?.toLocaleLowerCase("en");
      const partName = readAttribute(attributes, "PartName")?.replace(/^\//u, "");
      const contentType = readAttribute(attributes, "ContentType");
      const applies = partName === entryName || extension === path.posix.extname(entryName).slice(1).toLocaleLowerCase("en");
      if (
        applies &&
        contentType &&
        Object.values(imageMediaTypes).includes(contentType as SupportedImageMediaType)
      ) {
        return contentType as SupportedImageMediaType;
      }
    }
  }
  const extension = path.posix.extname(entryName).slice(1).toLocaleLowerCase("en") as keyof typeof imageMediaTypes;
  return imageMediaTypes[extension] ?? null;
}

function resolveRelationshipTarget(target: string): string {
  const withoutLeadingSlash = target.replace(/^\/+/, "");
  const resolved = target.startsWith("/")
    ? path.posix.normalize(withoutLeadingSlash)
    : path.posix.normalize(path.posix.join("word", withoutLeadingSlash));
  if (resolved.startsWith("../") || resolved === "..") {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      `DOCX relationship escapes the document package: ${target}`,
    );
  }
  return resolved;
}

function docxHeadingLevel(paragraphXml: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const styleTag = paragraphXml.match(/<w:pStyle\b([^>]*?)\/?\s*>/u)?.[1] ?? "";
  const style = readAttribute(styleTag, "w:val") ?? readAttribute(styleTag, "val");
  const styleMatch = style?.match(/(?:Heading|heading)[ _-]?([1-6])$/u);
  if (styleMatch) {
    return Number(styleMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6;
  }
  const outlineTag = paragraphXml.match(/<w:outlineLvl\b([^>]*?)\/?\s*>/u)?.[1] ?? "";
  const outlineValue =
    readAttribute(outlineTag, "w:val") ?? readAttribute(outlineTag, "val");
  const outline = outlineValue === null ? Number.NaN : Number(outlineValue);
  if (Number.isInteger(outline) && outline >= 0 && outline <= 5) {
    return (outline + 1) as 1 | 2 | 3 | 4 | 5 | 6;
  }
  return null;
}

function createIllustration(
  archive: ZipArchive,
  relationship: DocxRelationship,
  tokenXml: string,
  contentTypesXml: string | null,
): ManuscriptIllustration {
  if (relationship.external) {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      "External DOCX illustrations are not accepted; embed the image first",
    );
  }
  const entryName = resolveRelationshipTarget(relationship.target);
  const entry = archive.entries.get(entryName);
  if (!entry) {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      `Embedded DOCX illustration is missing: ${entryName}`,
    );
  }
  const mediaType = contentTypeForImage(entryName, contentTypesXml);
  if (!mediaType) {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      `Embedded DOCX illustration type is unsupported: ${entryName}`,
    );
  }
  try {
    const inspected = inspectRasterImage(entry.bytes);
    if (inspected.mediaType !== mediaType) {
      throw new InvalidRasterImageError(
        `Declared ${mediaType} does not match ${inspected.mediaType}`,
      );
    }
  } catch (error) {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      `Embedded DOCX illustration is not a safe bounded raster image: ${entryName}`,
      { cause: error },
    );
  }
  const contentHash = sha256(entry.bytes);
  const docProperties = tokenXml.match(/<wp:docPr\b([^>]*?)\/?\s*>/u)?.[1] ?? "";
  const altText =
    readAttribute(docProperties, "descr") ??
    readAttribute(docProperties, "name") ??
    "Ілюстрація рукопису";
  return {
    altText,
    bytes: entry.bytes,
    contentHash,
    fileName: path.posix.basename(entryName),
    id: `illustration-${contentHash.slice(0, 16)}`,
    mediaType,
  };
}

function parseDocx(
  source: DocxManuscriptSource | GoogleDocsExportSource,
  metadata: ManuscriptMetadata,
): IngestedManuscript {
  let archive: ZipArchive;
  try {
    archive = readZipArchive(source.bytes);
  } catch (error) {
    throw new ManuscriptIngestionError(
      "DOCX_ARCHIVE_INVALID",
      `${source.fileName} is not a valid bounded DOCX archive`,
      { cause: error instanceof ZipArchiveError ? error : undefined },
    );
  }
  const documentEntry = archive.entries.get(DOCX_DOCUMENT_PATH);
  if (!documentEntry) {
    throw new ManuscriptIngestionError(
      "DOCX_CONTENT_INVALID",
      `DOCX is missing ${DOCX_DOCUMENT_PATH}`,
    );
  }
  const documentXml = decodeUtf8(documentEntry.bytes, DOCX_DOCUMENT_PATH);
  const relationshipsEntry = archive.entries.get(DOCX_RELATIONSHIPS_PATH);
  const relationships = relationshipsEntry
    ? parseRelationships(decodeUtf8(relationshipsEntry.bytes, DOCX_RELATIONSHIPS_PATH))
    : new Map<string, DocxRelationship>();
  const contentTypesEntry = archive.entries.get("[Content_Types].xml");
  const contentTypesXml = contentTypesEntry
    ? decodeUtf8(contentTypesEntry.bytes, "[Content_Types].xml")
    : null;
  const illustrations = new Map<string, ManuscriptIllustration>();
  const blocks: ManuscriptBlock[] = [];

  for (const paragraphMatch of documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gu)) {
    const paragraphXml = paragraphMatch[1] ?? "";
    const runs: ManuscriptInlineRun[] = [];
    const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?\s*>|<w:tab\b[^>]*\/?\s*>|<w:(?:drawing|pict)\b[\s\S]*?<\/w:(?:drawing|pict)>/gu;
    for (const token of paragraphXml.matchAll(tokenPattern)) {
      const tokenXml = token[0];
      if (token[1] !== undefined) {
        runs.push({ kind: "text", text: xmlDecode(token[1]) });
      } else if (/^<w:tab\b/u.test(tokenXml)) {
        runs.push({ kind: "text", text: "\t" });
      } else if (/^<w:(?:br|cr)\b/u.test(tokenXml)) {
        runs.push({ kind: "line-break" });
      } else {
        const relationshipId =
          tokenXml.match(/<a:blip\b[^>]*\br:embed\s*=\s*["']([^"']+)["']/u)?.[1] ??
          tokenXml.match(/<v:imagedata\b[^>]*\br:id\s*=\s*["']([^"']+)["']/u)?.[1];
        if (!relationshipId) {
          continue;
        }
        const relationship = relationships.get(relationshipId);
        if (!relationship) {
          throw new ManuscriptIngestionError(
            "DOCX_CONTENT_INVALID",
            `DOCX illustration relationship is missing: ${relationshipId}`,
          );
        }
        const illustration = createIllustration(
          archive,
          relationship,
          tokenXml,
          contentTypesXml,
        );
        illustrations.set(illustration.id, illustration);
        runs.push({ illustrationId: illustration.id, kind: "illustration" });
      }
    }
    if (runs.length === 0) {
      continue;
    }
    const level = docxHeadingLevel(paragraphXml);
    blocks.push(
      level
        ? { kind: "heading", level, runs }
        : { kind: "paragraph", runs },
    );
  }

  if (blocks.length === 0) {
    throw new ManuscriptIngestionError("MANUSCRIPT_EMPTY", "The DOCX manuscript is empty");
  }
  return {
    blocks,
    illustrations: [...illustrations.values()],
    metadata: requireMetadata(metadata),
    schemaVersion: INGESTED_MANUSCRIPT_SCHEMA_VERSION,
    source: sourceReceipt(source),
    stage: "ingested",
  };
}

export function ingestDocx(
  source: DocxManuscriptSource,
  metadata: ManuscriptMetadata,
): IngestedManuscript {
  return parseDocx(source, metadata);
}

export function ingestGoogleDocsExport(
  source: GoogleDocsExportSource,
  metadata: ManuscriptMetadata,
): IngestedManuscript {
  return parseDocx(source, metadata);
}

export function ingestManuscript(
  source: ManuscriptSource,
  metadata: ManuscriptMetadata,
): IngestedManuscript {
  switch (source.kind) {
    case "txt":
      return ingestTxt(source, metadata);
    case "docx":
      return ingestDocx(source, metadata);
    case "google-docs-export":
      return ingestGoogleDocsExport(source, metadata);
    default: {
      const exhaustiveSource: never = source;
      throw new ManuscriptIngestionError(
        "SOURCE_KIND_UNSUPPORTED",
        `Unsupported manuscript source: ${String(exhaustiveSource)}`,
      );
    }
  }
}
