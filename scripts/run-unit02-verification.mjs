import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import sharp from "sharp";

import { generateUnit02Comparison } from "./generate-unit02-comparison.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V2";
const targetBundleHash =
  "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d";
const expectedDatabaseName = "ukiebook_unit02";
const generatedComparisonPaths = new Set([
  "output/playwright/unit02-design-compare-final.png",
  "output/playwright/unit02-s01-final-1280.png",
  "output/playwright/unit02-s02-final-1280.png",
  "output/playwright/unit02-s02-final-390.png",
  "output/playwright/unit02-target-final-1280.png",
]);
const realDatabaseUrl = process.env.REAL_DATABASE_URL;

if (!realDatabaseUrl) {
  throw new Error(
    "REAL_DATABASE_URL is required; UNIT-02 cannot pass on an emulated database",
  );
}

function requireDedicatedDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("REAL_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("REAL_DATABASE_URL must not contain connection override parameters");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("REAL_DATABASE_URL must use postgres: or postgresql:");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopbackHosts.has(parsed.hostname)) {
    throw new Error(
      "UNIT-02 destructive database proofs require a loopback PostgreSQL host",
    );
  }
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `UNIT-02 destructive database proofs require the exact dedicated database ${expectedDatabaseName}`,
    );
  }
  if (!parsed.username || !parsed.password) {
    throw new Error(
      "REAL_DATABASE_URL must include dedicated PostgreSQL credentials",
    );
  }
  return parsed;
}

const parsedRealDatabaseUrl = requireDedicatedDatabase(realDatabaseUrl);
const { stdout: revisionOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
});
const implementationRevision = revisionOutput.trim();
const { stdout: statusOutput } = await execFileAsync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: repositoryRoot },
);
if (statusOutput.trim()) {
  throw new Error(
    "UNIT-02 verification must start from a clean implementation commit",
  );
}

const startedAt = new Date();
const runId = `${startedAt
  .toISOString()
  .replace(/[-:]/gu, "")
  .replace(/\.\d{3}Z$/u, "Z")}-${implementationRevision.slice(0, 12)}`;
const runRoot = path.resolve("forge", "runs", "UNIT-02", runId);
const commandDirectory = path.join(runRoot, "evidence", "commands");
const evalDirectory = path.join(runRoot, "evals");
await mkdir(commandDirectory, { recursive: true });
await mkdir(evalDirectory, { recursive: true });

const authSecret = randomBytes(32).toString("base64url");
const privacySentinel = `unit02-privacy-${randomBytes(24).toString("hex")}`;
const sharedEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_ORIGIN: "https://unit02.invalid",
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  CI: "1",
  DATABASE_URL: realDatabaseUrl,
  IMPLEMENTATION_REVISION: implementationRevision,
  PLAYWRIGHT_HTML_OPEN: "never",
  REAL_DATABASE_URL: realDatabaseUrl,
  UNIT00_SECRET_SENTINEL: authSecret,
  UNIT01_PRIVACY_SENTINEL: privacySentinel,
  UNIT01_PAYOUT_SENTINEL: privacySentinel,
  UNIT02_ALLOW_FIXTURE_SEED: "1",
  UNIT02_DATABASE_URL: realDatabaseUrl,
  UNIT02_PRIVACY_SENTINEL: privacySentinel,
  UNIT_EVIDENCE_DIR: runRoot,
};
const sensitiveValues = [
  { category: "real-database-url", value: realDatabaseUrl },
  {
    category: "real-database-password",
    value: decodeURIComponent(parsedRealDatabaseUrl.password),
  },
  {
    category: "real-database-password-encoded",
    value: parsedRealDatabaseUrl.password,
  },
  { category: "auth-secret", value: authSecret },
  { category: "privacy-sentinel", value: privacySentinel },
]
  .filter(({ value }) => value.length > 0)
  .sort((left, right) => right.value.length - left.value.length);
const commandResults = [];

function redactSensitiveValues(value) {
  let redacted = value;
  for (const marker of sensitiveValues) {
    redacted = redacted.split(marker.value).join(`[REDACTED:${marker.category}]`);
  }
  return redacted;
}

async function writeJson(relativePath, value) {
  const target = path.join(runRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCommand(name, executable, arguments_, extraEnvironment = {}) {
  const started = new Date();
  console.log(`\n[UNIT-02] ${name}`);
  const child = spawn(executable, arguments_, {
    cwd: repositoryRoot,
    env: { ...sharedEnvironment, ...extraEnvironment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const { exitCode, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, closeSignal) =>
      resolve({ exitCode: code, signal: closeSignal }),
    );
  });
  const finished = new Date();
  const redactedStdout = redactSensitiveValues(stdout);
  const redactedStderr = redactSensitiveValues(stderr);
  if (redactedStdout) process.stdout.write(redactedStdout);
  if (redactedStderr) process.stderr.write(redactedStderr);
  const commandText = `${executable} ${arguments_.join(" ")}`;
  const receipt = [
    `name: ${name}`,
    `command: ${commandText}`,
    `implementation_revision: ${implementationRevision}`,
    `started_at: ${started.toISOString()}`,
    `finished_at: ${finished.toISOString()}`,
    `exit_code: ${exitCode ?? "null"}`,
    `signal: ${signal ?? "none"}`,
    "",
    "[stdout]",
    redactedStdout,
    "[stderr]",
    redactedStderr,
  ].join("\n");
  const relativeReceipt = `evidence/commands/${name}.txt`;
  await writeFile(path.join(runRoot, relativeReceipt), receipt, "utf8");
  commandResults.push({
    arguments: arguments_,
    command: commandText,
    executable,
    exit_code: exitCode,
    finished_at: finished.toISOString(),
    name,
    receipt: relativeReceipt,
    signal,
    started_at: started.toISOString(),
  });
  await writeJson("evidence/commands/index.json", {
    commands: commandResults,
    implementation_revision: implementationRevision,
    unit: "UNIT-02",
    updated_at: finished.toISOString(),
  });
  if (exitCode !== 0) {
    throw new Error(
      `${name} failed${exitCode === null ? ` after signal ${signal}` : ` with exit code ${exitCode}`}`,
    );
  }
}

async function sha256File(relativePath) {
  const content = await readFile(path.resolve(relativePath));
  return createHash("sha256").update(content).digest("hex");
}

function repositoryPath(relativeWithinRun) {
  return path
    .relative(repositoryRoot, path.join(runRoot, relativeWithinRun))
    .split(path.sep)
    .join("/");
}

async function writeEval(fileName, value) {
  await writeJson(`evals/${fileName}`, {
    ...value,
    findings: value.findings ?? [],
    implementation_revision: implementationRevision,
    owner: "Codex / catalog and Book Page",
    rerun_of: null,
    status: value.status ?? "passed",
    timestamp: new Date().toISOString(),
    unit: "UNIT-02",
  });
}

async function writeRunResult(status, finishedAt, findings = []) {
  const sourceFiles = [
    "docs/architecture.md",
    "docs/design-brief.md",
    "docs/development-plan.md",
    "docs/dod-evals.md",
    "docs/guardrails.md",
    "docs/prd.md",
    "docs/qa-checklist.md",
    "docs/screen-map.md",
    "docs/user-journey.md",
    "docs/wireframes.md",
    "forge/sdd-manifest.json",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [file, await sha256File(file)]),
    ),
  );
  await writeJson("run.json", {
    baseline_id: baselineId,
    commands: commandResults,
    database_proof: {
      database_name: expectedDatabaseName,
      engine: "PostgreSQL",
      host_class: "loopback-dedicated",
    },
    finished_at: finishedAt.toISOString(),
    findings,
    implementation_revision: implementationRevision,
    prototype_reuse: "none",
    run_id: runId,
    source_hashes: sourceHashes,
    started_at: startedAt.toISOString(),
    status,
    target_bundle_hash: targetBundleHash,
    unit: "UNIT-02",
  });
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function inspectEvidenceForSecretsAndTraces() {
  const files = await listFiles(runRoot);
  const leaks = [];
  const forbiddenArtifacts = [];
  for (const file of files) {
    const relative = path.relative(runRoot, file).split(path.sep).join("/");
    const baseName = path.basename(file);
    if (/^trace(?:\.|-|_)/iu.test(baseName) || /\.har$/iu.test(baseName)) {
      forbiddenArtifacts.push(relative);
    }
    const contents = await readFile(file);
    for (const marker of sensitiveValues) {
      if (contents.includes(Buffer.from(marker.value))) {
        leaks.push({ category: marker.category, file: relative });
      }
    }
  }
  if (leaks.length > 0 || forbiddenArtifacts.length > 0) {
    for (const relative of new Set(leaks.map(({ file }) => file))) {
      const target = path.join(runRoot, relative);
      const contents = await readFile(target);
      for (const marker of sensitiveValues) {
        const markerBytes = Buffer.from(marker.value);
        let offset = contents.indexOf(markerBytes);
        while (offset !== -1) {
          contents.fill(0x2a, offset, offset + markerBytes.length);
          offset = contents.indexOf(markerBytes, offset + markerBytes.length);
        }
      }
      await writeFile(target, contents);
    }
    for (const relative of forbiddenArtifacts) {
      await unlink(path.join(runRoot, relative));
    }
    const details = [
      ...leaks.map(({ category, file }) => `${category} in ${file}`),
      ...forbiddenArtifacts.map((file) => `trace/HAR artifact ${file}`),
    ].join(", ");
    throw new Error(`UNIT-02 evidence hygiene failed: ${details}`);
  }
  return {
    checked_files: files.length,
    checked_secret_categories: sensitiveValues.map(({ category }) => category),
    forbidden_artifacts: forbiddenArtifacts,
    leaks,
    status: "passed",
    verified_at: new Date().toISOString(),
  };
}

async function requireEvidenceFile(relativePath) {
  const metadata = await stat(path.join(runRoot, relativePath));
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Required evidence is empty: ${relativePath}`);
  }
}

function unit02VisualFiles() {
  return [
    "s01-default-1280@2x.png",
    "s01-shelf-hover-1280@2x.png",
    "s01-tile-hover-1280@2x.png",
    "s01-shelf-focus-1280@2x.png",
    "s01-tile-focus-1280@2x.png",
    "s01-reduced-motion-1280@2x.png",
    ...[390, 430, 768, 1440].flatMap((width) => [
      `s01-default-${width}@2x.png`,
      `s01-empty-${width}@2x.png`,
      `s01-discount-${width}@2x.png`,
      `s01-query-${width}@2x.png`,
      `s01-long-results-${width}@2x.png`,
      `s01-loading-${width}@2x.png`,
      `s01-error-${width}@2x.png`,
    ]),
    ...[390, 768, 1280].flatMap((width) =>
      [
        "discount",
        "discount-inactive",
        "sample-open",
        "reviews-page-2",
        "unavailable",
        "loading",
      ].map(
        (state) => `s02-${state}-${width}@2x.png`,
      ),
    ),
    "s02-menu-open-390@2x.png",
  ].map((file) => `evidence/visual/${file}`);
}

async function captureAssetManifest() {
  const expectedLogoHashes = {
    "public/brand/UkieBook-logo-exact.svg":
      "abb3acf8cfa673161e6547ca725f7b337b29185a7eb6918218f887faadc66d98",
    "public/brand/UkieBook-logo.jpg":
      "5cdd21d3ba038632528fc17a13068e3792d03a029779251cd738aaada4aa0ad3",
  };
  const logos = [];
  for (const [file, expectedHash] of Object.entries(expectedLogoHashes)) {
    const actualHash = await sha256File(file);
    if (actualHash !== expectedHash) {
      throw new Error(`Official logo hash mismatch: ${file}`);
    }
    logos.push({ file, sha256: actualHash, status: "passed" });
  }
  const coverDirectory = path.resolve("public/books/covers");
  const coverNames = (await readdir(coverDirectory))
    .filter((file) => file.endsWith(".png"))
    .sort();
  if (coverNames.length !== 6) {
    throw new Error("UNIT-02 requires exactly six generated production covers");
  }
  const covers = [];
  for (const name of coverNames) {
    const file = path.join("public/books/covers", name);
    const metadata = await sharp(file).metadata();
    if (metadata.width !== 1024 || metadata.height !== 1536) {
      throw new Error(`Cover is not the approved 2:3 production size: ${file}`);
    }
    covers.push({
      file,
      height: metadata.height,
      sha256: await sha256File(file),
      width: metadata.width,
    });
  }
  await writeJson("evidence/visual/unit02-assets.json", {
    covers,
    logos,
    status: "passed",
    verified_at: new Date().toISOString(),
  });
}

function requiredDesignQaValue(contents, label, pattern) {
  const match = contents.match(pattern);
  if (!match?.[1]) {
    throw new Error(`design-qa.md is missing ${label}`);
  }
  return match[1];
}

function isReviewOnlyPath(file) {
  return (
    file === "design-qa.md" ||
    generatedComparisonPaths.has(file) ||
    file.startsWith("forge/runs/UNIT-02/")
  );
}

function visualReceiptDigest(receipts) {
  const identity = receipts.map(({ file, sha256 }) => ({ file, sha256 }));
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

async function validateDesignQaReview(designQa, comparisonHash, visualMatrix) {
  if (!designQa.trimEnd().endsWith("final result: passed")) {
    throw new Error("design-qa.md does not record the required final passed result");
  }
  const reviewedRevision = requiredDesignQaValue(
    designQa,
    "the reviewed implementation revision",
    /Reviewed implementation revision:\s*`([0-9a-f]{40})`/u,
  );
  const reviewedComparisonHash = requiredDesignQaValue(
    designQa,
    "the reviewed comparison SHA-256",
    /Reviewed comparison SHA-256:\s*`([0-9a-f]{64})`/u,
  );
  const reviewedReceiptCount = Number(
    requiredDesignQaValue(
      designQa,
      "the reviewed visual receipt count",
      /Reviewed visual receipt count:\s*`([0-9]+)`/u,
    ),
  );
  const reviewedReceiptDigest = requiredDesignQaValue(
    designQa,
    "the reviewed visual receipt digest",
    /Reviewed visual receipt digest SHA-256:\s*`([0-9a-f]{64})`/u,
  );
  if (reviewedComparisonHash !== comparisonHash) {
    throw new Error("design-qa.md is not bound to the generated UNIT-02 comparison");
  }
  if (reviewedReceiptCount !== visualMatrix.receipts.length) {
    throw new Error("design-qa.md is not bound to the complete UNIT-02 visual matrix");
  }
  const receiptDigest = visualReceiptDigest(visualMatrix.receipts);
  if (reviewedReceiptDigest !== receiptDigest) {
    throw new Error("design-qa.md is not bound to all UNIT-02 visual receipt hashes");
  }
  try {
    await execFileAsync(
      "git",
      ["merge-base", "--is-ancestor", reviewedRevision, implementationRevision],
      { cwd: repositoryRoot },
    );
  } catch {
    throw new Error("design-qa.md reviewed revision is not an ancestor of this verification");
  }
  const { stdout: changedOutput } = await execFileAsync(
    "git",
    ["diff", "--name-only", `${reviewedRevision}..${implementationRevision}`],
    { cwd: repositoryRoot },
  );
  const implementationChanges = changedOutput
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !isReviewOnlyPath(file));
  if (implementationChanges.length > 0) {
    throw new Error(
      `Runtime files changed after the reviewed UNIT-02 revision: ${implementationChanges.join(", ")}`,
    );
  }
  return {
    comparison_sha256: reviewedComparisonHash,
    implementation_revision: reviewedRevision,
    receipt_count: reviewedReceiptCount,
    receipt_digest_sha256: reviewedReceiptDigest,
  };
}

async function assertRepositoryStableAtEnd() {
  const { stdout: finalRevisionOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
  });
  if (finalRevisionOutput.trim() !== implementationRevision) {
    throw new Error("Repository HEAD changed during UNIT-02 verification");
  }
  const { stdout: finalStatusOutput } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot },
  );
  const currentRunPrefix = `${path.relative(repositoryRoot, runRoot).split(path.sep).join("/")}/`;
  const unexpected = finalStatusOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .flatMap((file) => (file.includes(" -> ") ? file.split(" -> ") : [file]))
    .filter(
      (file) => !file.startsWith(currentRunPrefix) && !generatedComparisonPaths.has(file),
    );
  if (unexpected.length > 0) {
    throw new Error(
      `Repository changed during UNIT-02 verification: ${[...new Set(unexpected)].join(", ")}`,
    );
  }
}

async function generateComparisonEvidence(visualMatrix) {
  const targetDirectory = path.join(runRoot, "evidence", "visual", "comparison");
  const visualRoot = path.join(runRoot, "evidence", "visual");
  const { approvedTarget, files, sources } = await generateUnit02Comparison({
    outputRoots: [path.resolve("output", "playwright"), targetDirectory],
    repositoryRoot,
    visualRoot,
  });
  const designQaPath = path.resolve("design-qa.md");
  const designQa = await readFile(designQaPath, "utf8");
  const comparisonHash = await sha256File(
    path.join(targetDirectory, "unit02-design-compare-final.png"),
  );
  const review = await validateDesignQaReview(
    designQa,
    comparisonHash,
    visualMatrix,
  );
  await writeJson("evidence/visual/comparison/receipt.json", {
    baseline_id: baselineId,
    approved_target: approvedTarget,
    files: await Promise.all(
      files.map(async (file) => ({
        file: `evidence/visual/comparison/${file}`,
        sha256: await sha256File(path.join(targetDirectory, file)),
      })),
    ),
    generated_from: Object.fromEntries(
      await Promise.all(
        Object.entries(sources).map(async ([name, file]) => [
          name,
          {
            file: path.relative(repositoryRoot, file),
            sha256: await sha256File(file),
          },
        ]),
      ),
    ),
    implementation_revision: implementationRevision,
    review: {
      ...review,
      design_qa: "design-qa.md",
      design_qa_sha256: await sha256File(designQaPath),
    },
    status: "passed",
    target_bundle_hash: targetBundleHash,
    verified_at: new Date().toISOString(),
  });
}

console.log(`UNIT-02 implementation revision: ${implementationRevision}`);
console.log(`Evidence directory: ${path.relative(repositoryRoot, runRoot)}`);

try {
  await runCommand("dependency-tree", "npm", ["ls", "--depth=0"]);
  await runCommand("dependency-audit", "npm", ["audit", "--audit-level=high"]);
  await runCommand("typecheck", "npm", ["run", "typecheck"]);
  await runCommand("lint", "npm", ["run", "lint"]);
  await runCommand("unit-tests", "npm", ["test"]);
  await runCommand("repository-hygiene", "npm", ["run", "verify:repository"]);
  await runCommand("build", "npm", ["run", "build"]);
  await runCommand(
    "real-postgres-unit02",
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/verify-unit02-postgres.ts",
    ],
  );
  await runCommand("e2e", "npm", ["run", "test:e2e", "--", "--trace=off"]);
  await runCommand("visual", "npm", ["run", "test:visual", "--", "--trace=off"]);
  await runCommand("unit02-e2e", "npm", [
    "run",
    "test:unit02:e2e",
    "--",
    "--trace=off",
  ]);
  await runCommand("unit02-visual", "npm", [
    "run",
    "test:unit02:visual",
    "--",
    "--trace=off",
  ]);

  const expectedVisualFiles = unit02VisualFiles();
  const requiredEvidence = [
    "evidence/architecture/boundary-review.json",
    "evidence/architecture/process-runtime-identities.json",
    "evidence/architecture/web-runtime-identity.json",
    "evidence/commands/index.json",
    "evidence/database/unit02-postgres-proof.json",
    "evidence/security/client-secret-boundary.json",
    "evidence/security/negative-client-import.json",
    "evidence/security/repository-secret-hygiene.json",
    "evidence/visual/unit02-visual-matrix.json",
    ...expectedVisualFiles,
  ];
  await Promise.all(requiredEvidence.map(requireEvidenceFile));

  const visualMatrix = JSON.parse(
    await readFile(
      path.join(runRoot, "evidence/visual/unit02-visual-matrix.json"),
      "utf8",
    ),
  );
  if (
    visualMatrix.status !== "passed" ||
    visualMatrix.implementation_revision !== implementationRevision ||
    visualMatrix.baseline_id !== baselineId ||
    visualMatrix.target_bundle_hash !== targetBundleHash ||
    !Array.isArray(visualMatrix.receipts) ||
    visualMatrix.receipts.length !== expectedVisualFiles.length ||
    visualMatrix.console_errors?.length !== 0
  ) {
    throw new Error("UNIT-02 visual matrix does not match the approved Baseline");
  }
  const capturedFiles = new Set(visualMatrix.receipts.map(({ file }) => file));
  for (const expectedFile of expectedVisualFiles) {
    if (!capturedFiles.has(expectedFile)) {
      throw new Error(`UNIT-02 visual matrix omits ${expectedFile}`);
    }
    const receipt = visualMatrix.receipts.find(({ file }) => file === expectedFile);
    if (receipt.sha256 !== (await sha256File(path.join(runRoot, expectedFile)))) {
      throw new Error(`UNIT-02 visual receipt hash mismatch: ${expectedFile}`);
    }
  }

  await captureAssetManifest();
  await generateComparisonEvidence(visualMatrix);

  const processIdentity = JSON.parse(
    await readFile(
      path.join(runRoot, "evidence/architecture/process-runtime-identities.json"),
      "utf8",
    ),
  );
  const webIdentity = JSON.parse(
    await readFile(
      path.join(runRoot, "evidence/architecture/web-runtime-identity.json"),
      "utf8",
    ),
  ).identity;
  const allIdentities = [...processIdentity.identities, webIdentity];
  if (
    new Set(allIdentities.map(({ appRevision }) => appRevision)).size !== 1 ||
    new Set(allIdentities.map(({ schemaRevision }) => schemaRevision)).size !== 1 ||
    allIdentities.some(({ appRevision }) => appRevision !== implementationRevision)
  ) {
    throw new Error("Web, worker, scheduler, and migration revisions differ");
  }
  await writeJson("evidence/architecture/runtime-revisions.json", {
    identities: allIdentities,
    shared_app_revision: allIdentities[0].appRevision,
    shared_schema_revision: allIdentities[0].schemaRevision,
    status: "passed",
    verified_at: new Date().toISOString(),
  });

  await writeEval("build.json", {
    evidence: [
      repositoryPath("evidence/commands/dependency-tree.txt"),
      repositoryPath("evidence/commands/dependency-audit.txt"),
      repositoryPath("evidence/commands/build.txt"),
      repositoryPath("evidence/architecture/runtime-revisions.json"),
    ],
    gate: "build",
  });
  await writeEval("typecheck-lint.json", {
    evidence: [
      repositoryPath("evidence/commands/typecheck.txt"),
      repositoryPath("evidence/commands/lint.txt"),
      repositoryPath("evidence/architecture/boundary-review.json"),
      repositoryPath("evidence/security/negative-client-import.json"),
    ],
    gate: "typecheck_lint",
  });
  await writeEval("tests.json", {
    evidence: [
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/e2e.txt"),
      repositoryPath("evidence/commands/visual.txt"),
      repositoryPath("evidence/commands/unit02-e2e.txt"),
      repositoryPath("evidence/commands/unit02-visual.txt"),
    ],
    gate: "tests",
  });
  await writeEval("catalog-read-model.json", {
    covered_checks: [
      "title and Author search",
      "Genre and Discount filters",
      "stable sorting and pagination",
      "integer-kopiyka actual price",
      "Book Page sample and paged reviews",
      "known unavailable Book and public DTO separation",
    ],
    evidence: [
      repositoryPath("evidence/commands/real-postgres-unit02.txt"),
      repositoryPath("evidence/database/unit02-postgres-proof.json"),
      repositoryPath("evidence/commands/unit02-e2e.txt"),
    ],
    gate: "catalog_read_model",
  });
  await writeEval("approved-visual-baseline-fidelity.json", {
    baseline_id: baselineId,
    comparison_mode: "S-01 exact target plus S-02 Aurora extension",
    evidence: [
      repositoryPath("evidence/commands/unit02-visual.txt"),
      repositoryPath("evidence/visual/unit02-visual-matrix.json"),
      repositoryPath("evidence/visual/unit02-assets.json"),
      repositoryPath("evidence/visual/comparison/receipt.json"),
      ...expectedVisualFiles.map(repositoryPath),
    ],
    gate: "approved_visual_baseline_fidelity",
    routes: ["/", "/books/{id}"],
    screens: ["S-01", "S-02"],
    states: [
      "default",
      "hover",
      "responsive",
      "filtered",
      "empty",
      "Discount active/inactive",
      "sample open",
      "reviews paged",
      "unavailable",
    ],
    target_bundle_hash: targetBundleHash,
    viewports: [390, 430, 768, 1280, 1440],
  });

  const initialEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit02-evidence-secret-scan.json", initialEvidenceScan);
  const finishedAt = new Date();
  await writeRunResult("passed", finishedAt);
  const finalEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit02-evidence-secret-scan.json", finalEvidenceScan);
  await assertRepositoryStableAtEnd();
  console.log(
    `UNIT-02 verification passed; evidence: ${path.relative(repositoryRoot, runRoot)}`,
  );
} catch (error) {
  const finishedAt = new Date();
  let summary = redactSensitiveValues(
    error instanceof Error ? error.message : String(error),
  );
  try {
    const failedRunScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit02-evidence-secret-scan.json", {
      ...failedRunScan,
      run_status: "failed",
    });
  } catch (hygieneError) {
    summary = `${summary}; ${redactSensitiveValues(
      hygieneError instanceof Error ? hygieneError.message : String(hygieneError),
    )}`;
  }
  try {
    await writeRunResult("failed", finishedAt, [
      { release_effect: "blocking", severity: "P1", summary },
    ]);
    const finalFailedRunScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit02-evidence-secret-scan.json", {
      ...finalFailedRunScan,
      run_status: "failed",
    });
  } catch (writeError) {
    console.error(
      `Unable to persist failed UNIT-02 run: ${redactSensitiveValues(
        writeError instanceof Error ? writeError.message : String(writeError),
      )}`,
    );
  }
  throw new Error(summary);
}
