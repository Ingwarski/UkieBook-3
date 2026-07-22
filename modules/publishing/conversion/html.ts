import path from "node:path";

import type {
  ManuscriptIllustration,
  ManuscriptInlineRun,
  NormalizedManuscript,
} from "./types";

export interface CalibreHtmlInput {
  readonly html: string;
  readonly images: readonly {
    readonly bytes: Uint8Array;
    readonly relativePath: string;
  }[];
}

const extensionsByMediaType: Record<ManuscriptIllustration["mediaType"], string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRuns(
  runs: readonly ManuscriptInlineRun[],
  imagePaths: ReadonlyMap<string, string>,
  illustrations: ReadonlyMap<string, ManuscriptIllustration>,
): string {
  return runs
    .map((run) => {
      if (run.kind === "text") {
        return escapeHtml(run.text);
      }
      if (run.kind === "line-break") {
        return "<br />";
      }
      const imagePath = imagePaths.get(run.illustrationId);
      const illustration = illustrations.get(run.illustrationId);
      if (!imagePath || !illustration) {
        throw new Error(`Normalized manuscript illustration is missing: ${run.illustrationId}`);
      }
      return `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(illustration.altText)}" />`;
    })
    .join("");
}

export function createCalibreHtmlInput(
  manuscript: NormalizedManuscript,
): CalibreHtmlInput {
  const imagePaths = new Map<string, string>();
  const illustrations = new Map<string, ManuscriptIllustration>();
  const images = manuscript.illustrations.map((illustration) => {
    const relativePath = path.posix.join(
      "images",
      `${illustration.id}.${extensionsByMediaType[illustration.mediaType]}`,
    );
    imagePaths.set(illustration.id, relativePath);
    illustrations.set(illustration.id, illustration);
    return { bytes: illustration.bytes, relativePath };
  });
  const body = manuscript.blocks
    .map((block) => {
      const content = renderRuns(block.runs, imagePaths, illustrations);
      return block.kind === "heading"
        ? `<h${block.level}>${content}</h${block.level}>`
        : `<p>${content}</p>`;
    })
    .join("\n");

  return {
    html: `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="author" content="${escapeHtml(manuscript.metadata.authorName)}" />
  <title>${escapeHtml(manuscript.metadata.title)}</title>
  <style>
    body { font-family: serif; line-height: 1.55; }
    img { display: block; height: auto; margin: 1em auto; max-width: 100%; }
  </style>
</head>
<body>
${body}
</body>
</html>
`,
    images,
  };
}
