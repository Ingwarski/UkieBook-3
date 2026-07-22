import type { ConversionEngineBlocker } from "./types";

export class ManuscriptIngestionError extends Error {
  readonly code:
    | "DOCX_ARCHIVE_INVALID"
    | "DOCX_CONTENT_INVALID"
    | "MANUSCRIPT_EMPTY"
    | "SOURCE_ENCODING_INVALID"
    | "SOURCE_KIND_UNSUPPORTED";

  constructor(
    code: ManuscriptIngestionError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManuscriptIngestionError";
    this.code = code;
  }
}

export class SemanticRewriteDetectedError extends Error {
  readonly code = "SEMANTIC_REWRITE_DETECTED" as const;

  constructor() {
    super("Technical normalization changed the manuscript's lexical meaning");
    this.name = "SemanticRewriteDetectedError";
  }
}

export class ArtifactValidationError extends Error {
  readonly code = "CONVERSION_ARTIFACT_INVALID" as const;
  readonly format: "epub" | "mobi";

  constructor(format: "epub" | "mobi", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactValidationError";
    this.format = format;
  }
}

export class ConversionEngineUnavailableError extends Error {
  readonly blocker: ConversionEngineBlocker;
  readonly code = "CONVERSION_ENGINE_UNAVAILABLE" as const;

  constructor(blocker: ConversionEngineBlocker, options?: ErrorOptions) {
    super(
      `Calibre ebook-convert is unavailable at ${blocker.executablePath}`,
      options,
    );
    this.name = "ConversionEngineUnavailableError";
    this.blocker = blocker;
  }
}

export class ConversionAbortedError extends Error {
  readonly code = "CONVERSION_ABORTED" as const;

  constructor() {
    super("Conversion was aborted before completion");
    this.name = "ConversionAbortedError";
  }
}

export class ConversionInputError extends Error {
  readonly code = "CONVERSION_INPUT_INVALID" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConversionInputError";
  }
}

export class ConversionExecutionError extends Error {
  readonly code = "CONVERSION_EXECUTION_FAILED" as const;
  readonly format: "epub" | "mobi";

  constructor(
    format: "epub" | "mobi",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversionExecutionError";
    this.format = format;
  }
}

export class ZipArchiveError extends Error {
  readonly code = "ZIP_ARCHIVE_INVALID" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ZipArchiveError";
  }
}
