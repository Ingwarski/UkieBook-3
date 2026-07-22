import type {
  ManuscriptIllustration,
  ManuscriptInlineRun,
  NormalizedManuscript,
} from "./types";

export const PREVIEW_DOCUMENT_SCHEMA_VERSION = 1 as const;

export interface PreviewParagraphBlock {
  readonly kind: "paragraph";
  readonly text: string;
}

export interface PreviewImageBlock {
  readonly altText: string;
  readonly contentHash: string;
  readonly illustrationId: string;
  readonly kind: "image";
  readonly mediaType: ManuscriptIllustration["mediaType"];
}

export type PreviewBlock = PreviewImageBlock | PreviewParagraphBlock;

export interface PreviewSection {
  readonly blocks: readonly PreviewBlock[];
  readonly heading: string | null;
  readonly headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null;
}

export interface PreviewDocument {
  readonly metadata: {
    readonly authorName: string;
    readonly language: "uk";
    readonly title: string;
  };
  readonly normalizedManuscriptHash: string;
  readonly schemaVersion: typeof PREVIEW_DOCUMENT_SCHEMA_VERSION;
  readonly sections: readonly PreviewSection[];
}

function textFromRuns(runs: readonly ManuscriptInlineRun[]): string {
  return runs
    .map((run) => {
      if (run.kind === "text") {
        return run.text;
      }
      if (run.kind === "line-break") {
        return "\n";
      }
      return "";
    })
    .join("")
    .trim();
}

function blocksFromRuns(
  runs: readonly ManuscriptInlineRun[],
  illustrations: ReadonlyMap<string, ManuscriptIllustration>,
): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  let text = "";
  const flushText = () => {
    const normalized = text.trim();
    if (normalized.length > 0) {
      blocks.push({ kind: "paragraph", text: normalized });
    }
    text = "";
  };

  for (const run of runs) {
    if (run.kind === "text") {
      text += run.text;
    } else if (run.kind === "line-break") {
      text += "\n";
    } else {
      flushText();
      const illustration = illustrations.get(run.illustrationId);
      if (illustration) {
        blocks.push({
          altText: illustration.altText,
          contentHash: illustration.contentHash,
          illustrationId: illustration.id,
          kind: "image",
          mediaType: illustration.mediaType,
        });
      }
    }
  }
  flushText();
  return blocks;
}

export function createPreviewDocument(
  manuscript: NormalizedManuscript,
): PreviewDocument {
  const illustrations = new Map(
    manuscript.illustrations.map((illustration) => [illustration.id, illustration]),
  );
  const sections: {
    blocks: PreviewBlock[];
    heading: string | null;
    headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null;
  }[] = [];
  let current = {
    blocks: [] as PreviewBlock[],
    heading: null as string | null,
    headingLevel: null as 1 | 2 | 3 | 4 | 5 | 6 | null,
  };

  for (const block of manuscript.blocks) {
    if (block.kind === "heading") {
      if (current.heading !== null || current.blocks.length > 0) {
        sections.push(current);
      }
      current = {
        blocks: [],
        heading: textFromRuns(block.runs),
        headingLevel: block.level,
      };
      continue;
    }
    current.blocks.push(...blocksFromRuns(block.runs, illustrations));
  }
  if (current.heading !== null || current.blocks.length > 0) {
    sections.push(current);
  }

  return {
    metadata: manuscript.metadata,
    normalizedManuscriptHash: manuscript.contentHash,
    schemaVersion: PREVIEW_DOCUMENT_SCHEMA_VERSION,
    sections,
  };
}
