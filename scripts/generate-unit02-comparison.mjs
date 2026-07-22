import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

const comparisonUnitId = process.env.UNIT_ID?.trim() || "UNIT-02";
const comparisonFiles = [
  "unit02-design-compare-final.png",
  "unit02-target-final-1280.png",
  "unit02-s01-final-1280.png",
  "unit02-s02-final-1280.png",
  "unit02-s02-final-390.png",
];

const approvedBaseline = {
  baselineId: "AVB-UKIEBOOK-AURORA-7B-V3",
  canonicalScreenshotHash: "25d667d08214092f8bf8df93bf0a2c15738a2a28430286ec98c05a0f173d1984",
  htmlHash: "01f6ab68ed967ef03c7230842d1ede7c948643bb7d24a65c4eb45ac7498093f9",
  logoHash: "db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f",
  receiptHash: "ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c",
  targetBundleHash: "e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724",
  treeHash: "7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97",
};

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function shasumReceiptHash(entries) {
  const receipt = entries.map(({ file, sha256: digest }) => `${digest}  ${file}\n`).join("");
  return createHash("sha256").update(receipt).digest("hex");
}

export async function validateApprovedBaseline(repositoryRoot) {
  const paths = {
    canonicalScreenshot: path.join(repositoryRoot, "output/playwright/baseline-s01-v3-1280.png"),
    html: path.join(
      repositoryRoot,
      "forge/design/candidates/operator-final-7b/v3/ukiebook-catalog.html",
    ),
    logo: path.join(
      repositoryRoot,
      "forge/design/candidates/operator-final-7b/v3/assets/UkieBook-logo-transparent.svg",
    ),
    receipt: path.join(
      repositoryRoot,
      "forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json",
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
  const frozenRoot = path.join(
    repositoryRoot,
    "forge/design/candidates/operator-final-7b/v3",
  );
  const frozenFiles = (await listFiles(frozenRoot))
    .map((file) => path.relative(repositoryRoot, file).split(path.sep).join("/"))
    .sort();
  const expectedFrozenFiles = [...sourceHashes.keys()].sort();
  if (JSON.stringify(frozenFiles) !== JSON.stringify(expectedFrozenFiles)) {
    throw new Error("Approved Aurora V3 tree file set does not match its locked receipt");
  }
  const frozenEntries = [];
  for (const file of frozenFiles) {
    const digest = await sha256(path.join(repositoryRoot, file));
    if (digest !== sourceHashes.get(file)) {
      throw new Error(`Approved Aurora V3 artifact hash mismatch: ${file}`);
    }
    frozenEntries.push({ file, sha256: digest });
  }
  const targetBundleFiles = [
    "forge/design/candidates/operator-final-7b/v3/ukiebook-catalog.html",
    "forge/design/candidates/operator-final-7b/v3/assets/UkieBook-logo-transparent.svg",
    ...frozenFiles.filter((file) => file.includes("/assets/covers/")),
  ];
  const targetBundleEntries = targetBundleFiles.map((file) => ({
    file,
    sha256: sourceHashes.get(file),
  }));
  const computedTargetBundleHash = shasumReceiptHash(targetBundleEntries);
  const computedTreeHash = shasumReceiptHash(frozenEntries);
  if (
    receipt.baseline_id !== approvedBaseline.baselineId ||
    receipt.target_hash !== approvedBaseline.targetBundleHash ||
    receipt.prototype_tree_hash !== approvedBaseline.treeHash ||
    computedTargetBundleHash !== approvedBaseline.targetBundleHash ||
    computedTreeHash !== approvedBaseline.treeHash ||
    sourceHashes.get("forge/design/candidates/operator-final-7b/v3/ukiebook-catalog.html") !==
      approvedBaseline.htmlHash ||
    sourceHashes.get(
      "forge/design/candidates/operator-final-7b/v3/assets/UkieBook-logo-transparent.svg",
    ) !== approvedBaseline.logoHash ||
    captureHashes.get("output/playwright/baseline-s01-v3-1280.png") !==
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
    "output/playwright/baseline-s01-v3-1280.png",
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
  console.log(
    `Generated ${comparisonUnitId} comparison from ${path.relative(process.cwd(), visualRoot)}`,
  );
}
