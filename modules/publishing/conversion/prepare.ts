import { ingestManuscript } from "./ingest";
import { normalizeManuscript } from "./normalize";
import { createPreviewDocument, type PreviewDocument } from "./preview";
import type {
  ManuscriptMetadata,
  ManuscriptSource,
  NormalizedManuscript,
} from "./types";

export interface PrepareManuscriptInput {
  readonly metadata: ManuscriptMetadata;
  readonly source: ManuscriptSource;
}

export interface PreparedManuscript {
  readonly normalizedDocument: NormalizedManuscript;
  readonly previewDocument: PreviewDocument;
}

export function prepareManuscript(
  input: PrepareManuscriptInput,
): PreparedManuscript {
  const normalizedDocument = normalizeManuscript(
    ingestManuscript(input.source, input.metadata),
  );
  return {
    normalizedDocument,
    previewDocument: createPreviewDocument(normalizedDocument),
  };
}
