import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

const comparisonFiles = [
  "unit02-design-compare-final.png",
  "unit02-target-final-1280.png",
  "unit02-s01-final-1280.png",
  "unit02-s02-final-1280.png",
  "unit02-s02-final-390.png",
];

const approvedBaseline = {
  baselineId: "AVB-UKIEBOOK-AURORA-7B-V2",
  canonicalScreenshotHash: "752774cd8814d93c2e2b47672a84f6441430c9320f06b1b348130b99b8585c4a",
  htmlHash: "35df0816497c1b178b9ad37b5f6331aebce4d26712581e3da4ccad73cde78462",
  logoHash: "5cdd21d3ba038632528fc17a13068e3792d03a029779251cd738aaada4aa0ad3",
  receiptHash: "e26d965e196f98a408c5ce9735acb07350175a9a3befb3f77851094910bec033",
  targetBundleHash: "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d",
};

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function validateApprovedBaseline(repositoryRoot) {
  const paths = {
    canonicalScreenshot: path.join(repositoryRoot, "output/playwright/baseline-s01-v2-1280.png"),
    html: path.join(
      repositoryRoot,
      "forge/design/candidates/operator-final-7b/v2/ukiebook-catalog.html",
    ),
    logo: path.join(repositoryRoot, "UkieBook-logo.jpg"),
    receipt: path.join(
      repositoryRoot,
      "forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V2.visual-qa.json",
    ),
  };
  const actual = {
    canonicalScreenshotHash: await sha256(paths.canonicalScreenshot),
    htmlHash: await sha256(paths.html),
    logoHash: await sha256(paths.logo),
    receiptHash: await sha256(paths.receipt),
  };
  for (const [name, value] of Object.entries(actual)) {
    if (value !== approvedBaseline[name]) {
      throw new Error(`Approved Aurora baseline ${name} mismatch`);
    }
  }
  const receipt = JSON.parse(await readFile(paths.receipt, "utf8"));
  const sourceHashes = new Map(
    receipt.source_artifact_ids?.map(({ path: sourcePath, sha256: hash }) => [sourcePath, hash]),
  );
  const captureHashes = new Map(
    receipt.implementation_capture_ids?.map(({ path: capturePath, sha256: hash }) => [
      capturePath,
      hash,
    ]),
  );
  if (
    receipt.baseline_id !== approvedBaseline.baselineId ||
    receipt.target_hash !== approvedBaseline.targetBundleHash ||
    sourceHashes.get("forge/design/candidates/operator-final-7b/v2/ukiebook-catalog.html") !==
      approvedBaseline.htmlHash ||
    sourceHashes.get("UkieBook-logo.jpg") !== approvedBaseline.logoHash ||
    captureHashes.get("output/playwright/baseline-s01-v2-1280.png") !==
      approvedBaseline.canonicalScreenshotHash
  ) {
    throw new Error("Approved Aurora visual-QA receipt does not match its locked artifacts");
  }
  return {
    ...approvedBaseline,
    artifacts: Object.fromEntries(
      Object.entries(paths).map(([name, file]) => [name, path.relative(repositoryRoot, file)]),
    ),
  };
}

async function viewportBuffer(source, cssWidth, cssHeight) {
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Missing image dimensions: ${source}`);
  }
  const scale = metadata.width / cssWidth;
  const cropHeight = Math.round(cssHeight * scale);
  if (Math.abs(scale - Math.round(scale)) > 0.01 || metadata.height < cropHeight) {
    throw new Error(`Unexpected viewport capture dimensions: ${source}`);
  }
  return sharp(source)
    .extract({ height: cropHeight, left: 0, top: 0, width: metadata.width })
    .resize(cssWidth, cssHeight, { fit: "fill" })
    .png()
    .toBuffer();
}

export async function generateUnit02Comparison({
  outputRoots,
  repositoryRoot = process.cwd(),
  visualRoot,
}) {
  const approvedTarget = await validateApprovedBaseline(repositoryRoot);
  const canonicalTarget = path.join(
    repositoryRoot,
    "output/playwright/baseline-s01-v2-1280.png",
  );
  const sources = {
    s01: path.join(visualRoot, "s01-default-1280@2x.png"),
    s02Desktop: path.join(visualRoot, "s02-discount-1280@2x.png"),
    s02Mobile: path.join(visualRoot, "s02-discount-390@2x.png"),
    target: canonicalTarget,
  };
  const [target, s01, s02Desktop, s02Mobile] = await Promise.all([
    viewportBuffer(sources.target, 1280, 900),
    viewportBuffer(sources.s01, 1280, 900),
    viewportBuffer(sources.s02Desktop, 1280, 900),
    viewportBuffer(sources.s02Mobile, 390, 844),
  ]);
  const comparison = await sharp({
    create: {
      background: "#ece7e2",
      channels: 3,
      height: 900,
      width: 2580,
    },
  })
    .composite([
      { input: target, left: 0, top: 0 },
      { input: s01, left: 1300, top: 0 },
    ])
    .png()
    .toBuffer();
  const outputs = {
    "unit02-design-compare-final.png": comparison,
    "unit02-s01-final-1280.png": s01,
    "unit02-s02-final-1280.png": s02Desktop,
    "unit02-s02-final-390.png": s02Mobile,
    "unit02-target-final-1280.png": target,
  };
  for (const outputRoot of outputRoots) {
    await mkdir(outputRoot, { recursive: true });
    await Promise.all(
      Object.entries(outputs).map(([name, contents]) =>
        writeFile(path.join(outputRoot, name), contents),
      ),
    );
  }
  return {
    approvedTarget,
    files: comparisonFiles,
    sources,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const visualRoot = path.resolve(
    process.argv[2] ?? "test-results/unit02-visual/evidence/visual",
  );
  const outputRoot = path.resolve(process.argv[3] ?? "output/playwright");
  await generateUnit02Comparison({ outputRoots: [outputRoot], visualRoot });
  console.log(`Generated UNIT-02 comparison from ${path.relative(process.cwd(), visualRoot)}`);
}
