import { SemanticRewriteDetectedError } from "./errors";
import { sha256 } from "./hash";
import {
  NORMALIZED_MANUSCRIPT_SCHEMA_VERSION,
  type IngestedManuscript,
  type ManuscriptBlock,
  type ManuscriptInlineRun,
  type NormalizedManuscript,
  type TechnicalNormalizationChange,
} from "./types";

interface QuoteState {
  open: boolean;
}

function lexicalProjection(manuscript: {
  readonly blocks: readonly ManuscriptBlock[];
  readonly illustrations: readonly { readonly contentHash: string; readonly id: string }[];
}): string {
  const imageHashes = new Map(
    manuscript.illustrations.map((illustration) => [
      illustration.id,
      illustration.contentHash,
    ]),
  );
  const text = manuscript.blocks
    .flatMap((block) =>
      block.runs.map((run) => {
        if (run.kind === "illustration") {
          return ` illustration${imageHashes.get(run.illustrationId) ?? "missing"} `;
        }
        if (run.kind === "line-break") {
          return " ";
        }
        return run.text;
      }),
    )
    .join(" ")
    .normalize("NFC")
    .toLocaleLowerCase("uk-UA");
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).join("\u001f");
}

function normalizeText(
  value: string,
  quoteState: QuoteState,
  changes: Set<TechnicalNormalizationChange>,
): string {
  const unicode = value.normalize("NFC");
  if (unicode !== value) {
    changes.add("unicode");
  }
  const whitespace = unicode
    .replace(/[\u00A0\u202F]/gu, " ")
    .replace(/[\t ]+/gu, " ");
  if (whitespace !== unicode) {
    changes.add("whitespace");
  }
  const dashes = whitespace
    .replace(/[\t ]+(?:--?|–|—)[\t ]+/gu, " — ");
  if (dashes !== whitespace) {
    changes.add("dashes");
  }
  const quotes = dashes.replace(/["“”„‟]/gu, () => {
    const replacement = quoteState.open ? "»" : "«";
    quoteState.open = !quoteState.open;
    return replacement;
  });
  if (quotes !== dashes) {
    changes.add("quotes");
  }
  const trimmed = quotes.trim();
  if (trimmed !== quotes) {
    changes.add("whitespace");
  }
  return trimmed;
}

function normalizeRuns(
  runs: readonly ManuscriptInlineRun[],
  quoteState: QuoteState,
  changes: Set<TechnicalNormalizationChange>,
): ManuscriptInlineRun[] {
  const normalized: ManuscriptInlineRun[] = [];
  let pendingText = "";
  const flushText = () => {
    if (pendingText.length > 0) {
      const text = normalizeText(pendingText, quoteState, changes);
      if (text.length > 0) {
        normalized.push({ kind: "text", text });
      }
      pendingText = "";
    }
  };
  for (const run of runs) {
    if (run.kind === "text") {
      pendingText += run.text;
      continue;
    }
    flushText();
    if (run.kind === "line-break") {
      if (
        normalized.length === 0 ||
        normalized.at(-1)?.kind === "line-break"
      ) {
        changes.add("blank-lines");
      } else {
        normalized.push(run);
      }
      continue;
    }
    normalized.push(run);
  }
  flushText();
  while (normalized.at(-1)?.kind === "line-break") {
    normalized.pop();
    changes.add("blank-lines");
  }
  return normalized;
}

function canonicalHash(manuscript: {
  readonly blocks: readonly ManuscriptBlock[];
  readonly illustrations: readonly {
    readonly altText: string;
    readonly contentHash: string;
    readonly fileName: string;
    readonly id: string;
    readonly mediaType: string;
  }[];
  readonly metadata: { readonly authorName: string; readonly language: string; readonly title: string };
  readonly source: { readonly contentHash: string; readonly kind: string };
}): string {
  return sha256(
    JSON.stringify({
      blocks: manuscript.blocks,
      illustrations: manuscript.illustrations.map(
        ({ altText, contentHash, fileName, id, mediaType }) => ({
          altText,
          contentHash,
          fileName,
          id,
          mediaType,
        }),
      ),
      metadata: manuscript.metadata,
      source: {
        contentHash: manuscript.source.contentHash,
        kind: manuscript.source.kind,
      },
    }),
  );
}

export function normalizeManuscript(
  manuscript: IngestedManuscript,
): NormalizedManuscript {
  const changes = new Set<TechnicalNormalizationChange>();
  const quoteState: QuoteState = { open: false };
  const illustrationIds = new Set(
    manuscript.illustrations.map((illustration) => illustration.id),
  );
  const blocks: ManuscriptBlock[] = [];

  for (const block of manuscript.blocks) {
    const runs = normalizeRuns(block.runs, quoteState, changes);
    for (const run of runs) {
      if (run.kind === "illustration" && !illustrationIds.has(run.illustrationId)) {
        throw new SemanticRewriteDetectedError();
      }
    }
    if (runs.length === 0) {
      changes.add("blank-lines");
      continue;
    }
    if (block.kind === "heading") {
      const level = Math.min(6, Math.max(1, block.level)) as 1 | 2 | 3 | 4 | 5 | 6;
      if (level !== block.level) {
        changes.add("heading-levels");
      }
      blocks.push({ kind: "heading", level, runs });
    } else {
      blocks.push({ kind: "paragraph", runs });
    }
  }

  const beforeMeaningHash = sha256(lexicalProjection(manuscript));
  const normalizedBase = {
    blocks,
    illustrations: manuscript.illustrations,
    metadata: manuscript.metadata,
    source: manuscript.source,
  };
  const afterMeaningHash = sha256(lexicalProjection(normalizedBase));
  if (beforeMeaningHash !== afterMeaningHash) {
    throw new SemanticRewriteDetectedError();
  }
  if (blocks.length === 0) {
    throw new SemanticRewriteDetectedError();
  }

  return {
    ...normalizedBase,
    contentHash: canonicalHash(normalizedBase),
    normalization: {
      afterMeaningHash,
      beforeMeaningHash,
      changes: [...changes].sort(),
      policyVersion: "ukiebook-technical-normalization.v1",
      semanticRewrite: false,
    },
    schemaVersion: NORMALIZED_MANUSCRIPT_SCHEMA_VERSION,
    stage: "normalized",
  };
}
