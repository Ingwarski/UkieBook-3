import { CalibreEbookConverter } from "./calibre";
import {
  prepareManuscript,
  type PrepareManuscriptInput,
  type PreparedManuscript,
} from "./prepare";
import type {
  ConversionResult,
} from "./types";

export * from "./calibre";
export * from "./errors";
export * from "./hash";
export * from "./html";
export * from "./ingest";
export * from "./normalize";
export * from "./prepare";
export * from "./preview";
export * from "./raster";
export * from "./types";
export * from "./validators";
export * from "./zip";

export interface ConvertManuscriptInput extends PrepareManuscriptInput {
  readonly bookVersionId: string;
  readonly cover?: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly mediaType: "image/jpeg" | "image/png";
  };
}

export interface ConvertManuscriptOptions {
  readonly ebookConvertPath: string;
  readonly maxArtifactBytes?: number;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workingDirectory?: string;
}

export interface ConvertedManuscript extends PreparedManuscript {
  readonly conversionResult: ConversionResult;
  readonly epub: Buffer;
  readonly mobi: Buffer;
  readonly validators: {
    readonly epub: ConversionResult["artifacts"][0]["validation"];
    readonly mobi: ConversionResult["artifacts"][1]["validation"];
  };
}

export async function convertManuscript(
  input: ConvertManuscriptInput,
  options: ConvertManuscriptOptions,
): Promise<ConvertedManuscript> {
  const prepared = prepareManuscript(input);
  const converter = new CalibreEbookConverter({
    executablePath: options.ebookConvertPath,
    maxArtifactBytes: options.maxArtifactBytes,
    now: options.now,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    workingDirectory: options.workingDirectory,
  });
  const conversionResult = await converter.convert({
    bookVersionId: input.bookVersionId,
    cover: input.cover,
    manuscript: prepared.normalizedDocument,
  });
  const [epubArtifact, mobiArtifact] = conversionResult.artifacts;
  return {
    ...prepared,
    conversionResult,
    epub: Buffer.from(epubArtifact.bytes),
    mobi: Buffer.from(mobiArtifact.bytes),
    validators: {
      epub: epubArtifact.validation,
      mobi: mobiArtifact.validation,
    },
  };
}
