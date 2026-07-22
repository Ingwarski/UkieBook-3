export const INGESTED_MANUSCRIPT_SCHEMA_VERSION = 1 as const;
export const NORMALIZED_MANUSCRIPT_SCHEMA_VERSION = 1 as const;
export const CONVERSION_RESULT_SCHEMA_VERSION = 1 as const;
export const PRIVATE_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type ManuscriptSourceKind = "docx" | "google-docs-export" | "txt";

interface BinaryManuscriptSource {
  readonly artifactVersion: 1;
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mediaType: string;
}

export interface TxtManuscriptSource extends BinaryManuscriptSource {
  readonly kind: "txt";
  readonly mediaType: "text/plain";
}

export interface DocxManuscriptSource extends BinaryManuscriptSource {
  readonly kind: "docx";
  readonly mediaType:
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export interface GoogleDocsExportSource extends BinaryManuscriptSource {
  readonly documentId: string;
  readonly exportFormat: "docx";
  readonly kind: "google-docs-export";
  readonly mediaType:
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  readonly revisionId: string | null;
}

export type ManuscriptSource =
  | DocxManuscriptSource
  | GoogleDocsExportSource
  | TxtManuscriptSource;

export interface ManuscriptMetadata {
  readonly authorName: string;
  readonly language: "uk";
  readonly title: string;
}

export interface ManuscriptTextRun {
  readonly kind: "text";
  readonly text: string;
}

export interface ManuscriptLineBreakRun {
  readonly kind: "line-break";
}

export interface ManuscriptIllustrationRun {
  readonly illustrationId: string;
  readonly kind: "illustration";
}

export type ManuscriptInlineRun =
  | ManuscriptIllustrationRun
  | ManuscriptLineBreakRun
  | ManuscriptTextRun;

export interface ManuscriptParagraph {
  readonly kind: "paragraph";
  readonly runs: readonly ManuscriptInlineRun[];
}

export interface ManuscriptHeading {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly runs: readonly ManuscriptInlineRun[];
}

export type ManuscriptBlock = ManuscriptHeading | ManuscriptParagraph;

export interface ManuscriptIllustration {
  readonly altText: string;
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly fileName: string;
  readonly id: string;
  readonly mediaType: "image/gif" | "image/jpeg" | "image/png";
}

export interface ManuscriptSourceReceipt {
  readonly artifactVersion: 1;
  readonly contentHash: string;
  readonly documentId: string | null;
  readonly fileName: string;
  readonly kind: ManuscriptSourceKind;
  readonly mediaType: string;
  readonly revisionId: string | null;
}

export interface IngestedManuscript {
  readonly blocks: readonly ManuscriptBlock[];
  readonly illustrations: readonly ManuscriptIllustration[];
  readonly metadata: ManuscriptMetadata;
  readonly schemaVersion: typeof INGESTED_MANUSCRIPT_SCHEMA_VERSION;
  readonly source: ManuscriptSourceReceipt;
  readonly stage: "ingested";
}

export type TechnicalNormalizationChange =
  | "blank-lines"
  | "dashes"
  | "heading-levels"
  | "quotes"
  | "unicode"
  | "whitespace";

export interface TechnicalNormalizationReceipt {
  readonly afterMeaningHash: string;
  readonly beforeMeaningHash: string;
  readonly changes: readonly TechnicalNormalizationChange[];
  readonly policyVersion: "ukiebook-technical-normalization.v1";
  readonly semanticRewrite: false;
}

export interface NormalizedManuscript {
  readonly blocks: readonly ManuscriptBlock[];
  readonly contentHash: string;
  readonly illustrations: readonly ManuscriptIllustration[];
  readonly metadata: ManuscriptMetadata;
  readonly normalization: TechnicalNormalizationReceipt;
  readonly schemaVersion: typeof NORMALIZED_MANUSCRIPT_SCHEMA_VERSION;
  readonly source: ManuscriptSourceReceipt;
  readonly stage: "normalized";
}

export interface EpubValidationReceipt {
  readonly contentDocuments: readonly string[];
  readonly imageEntries: readonly string[];
  readonly packageDocument: string;
  readonly spineDocuments: readonly string[];
  readonly validator: "epub-container.v1";
}

export interface MobiValidationReceipt {
  readonly fileVersion: 6;
  readonly firstRecordOffset: number;
  readonly headerLength: number;
  readonly recordCount: number;
  readonly signature: "BOOKMOBI";
  readonly textEncoding: 65_001;
  readonly validator: "legacy-mobi-header.v1";
}

export type ConversionValidationReceipt =
  | EpubValidationReceipt
  | MobiValidationReceipt;

interface PrivateConversionArtifactBase {
  readonly artifactVersion: typeof PRIVATE_ARTIFACT_SCHEMA_VERSION;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly storageKey: string;
  readonly visibility: "private";
}

export interface PrivateEpubConversionArtifact
  extends PrivateConversionArtifactBase {
  readonly format: "epub";
  readonly mediaType: "application/epub+zip";
  readonly validation: EpubValidationReceipt;
}

export interface PrivateMobiConversionArtifact
  extends PrivateConversionArtifactBase {
  readonly format: "mobi";
  readonly mediaType: "application/x-mobipocket-ebook";
  readonly validation: MobiValidationReceipt;
}

export type PrivateConversionArtifact =
  | PrivateEpubConversionArtifact
  | PrivateMobiConversionArtifact;

export interface ConversionEngineReceipt {
  readonly executablePath: string;
  readonly name: "calibre-ebook-convert";
  readonly version: string;
}

export interface ConversionResult {
  readonly artifacts: readonly [
    PrivateEpubConversionArtifact,
    PrivateMobiConversionArtifact,
  ];
  readonly bookVersionId: string;
  readonly conversionVersion: 1;
  readonly createdAt: string;
  readonly engine: ConversionEngineReceipt;
  readonly normalizedManuscriptHash: string;
  readonly schemaVersion: typeof CONVERSION_RESULT_SCHEMA_VERSION;
  readonly sourceArtifactHash: string;
}

export interface ConvertManuscriptRequest {
  readonly bookVersionId: string;
  readonly cover?: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly mediaType: "image/jpeg" | "image/png";
  };
  readonly manuscript: NormalizedManuscript;
}

export interface ConversionEngineBlocker {
  readonly code: "CONVERSION_ENGINE_UNAVAILABLE";
  readonly engine: "calibre-ebook-convert";
  readonly executablePath: string;
  readonly remediation: string;
  readonly type: "missing-conversion-engine";
}

export type ConversionEngineProbe =
  | {
      readonly available: true;
      readonly engine: ConversionEngineReceipt;
    }
  | {
      readonly available: false;
      readonly blocker: ConversionEngineBlocker;
    };
