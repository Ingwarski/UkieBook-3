import { constants as fsConstants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const unitId = "UNIT-03";
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const targetBundleHash =
  "e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724";
const expectedDatabaseName = "ukiebook_unit03";
const expectedSchemaRevision = "0004_publishing_pipeline";
const expectedAccessibilityChecks = [
  "s10-keyboard-order-focus-activation",
  "s10-reflow-200",
  "s11-file-input-focus-proxy",
  "s11-keyboard-activation",
  "s11-reflow-200",
  "s12-tab-keyboard-activation",
  "s12-reflow-200",
];
const databaseUrl = process.env.UNIT03_DATABASE_URL;
const ebookConvertPath = process.env.CALIBRE_EBOOK_CONVERT_PATH;

if (!databaseUrl) {
  throw new Error("UNIT03_DATABASE_URL is required for the UNIT-03 verifier");
}
if (!ebookConvertPath) {
  throw new Error("CALIBRE_EBOOK_CONVERT_PATH is required for the UNIT-03 verifier");
}

function requireDedicatedDatabase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("UNIT03_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("UNIT03_DATABASE_URL must not contain connection override parameters");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("UNIT03_DATABASE_URL must use postgres: or postgresql:");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(parsed.hostname)) {
    throw new Error("UNIT-03 database mutation is restricted to a loopback PostgreSQL host");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `UNIT-03 database mutation requires the exact database ${expectedDatabaseName}`,
    );
  }
  if (!parsed.username || !parsed.password) {
    throw new Error("UNIT03_DATABASE_URL must include dedicated PostgreSQL credentials");
  }
  return parsed;
}

const parsedDatabaseUrl = requireDedicatedDatabase(databaseUrl);
await access(ebookConvertPath, fsConstants.R_OK | fsConstants.X_OK);
const converterMetadata = await stat(ebookConvertPath);
if (!converterMetadata.isFile()) {
  throw new Error("CALIBRE_EBOOK_CONVERT_PATH must identify an executable file");
}

const { stdout: revisionOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
});
const implementationRevision = revisionOutput.trim();
const { stdout: treeOutput } = await execFileAsync(
  "git",
  ["rev-parse", "HEAD^{tree}"],
  { cwd: repositoryRoot },
);
const implementationTree = treeOutput.trim();
const { stdout: statusOutput } = await execFileAsync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all"],
  { cwd: repositoryRoot },
);
if (statusOutput.trim()) {
  throw new Error("UNIT-03 verification must start from a clean implementation commit");
}

const manifestPath = "forge/sdd-manifest.json";
const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
if (
  manifest.approved_baseline_id !== baselineId ||
  manifest.active_baseline?.baseline_id !== baselineId ||
  manifest.active_baseline?.visual_target_hash !== targetBundleHash
) {
  throw new Error("UNIT-03 verifier baseline binding does not match forge/sdd-manifest.json");
}
const visualQaPath = manifest.active_baseline.visual_qa_evidence;
const expectedVisualQaHash = manifest.active_baseline.visual_qa_evidence_sha256;

const startedAt = new Date();
const runId = `${startedAt
  .toISOString()
  .replace(/[-:]/gu, "")
  .replace(/\.\d{3}Z$/u, "Z")}-${implementationRevision.slice(0, 12)}`;
const runRoot = path.resolve("forge", "runs", unitId, runId);
await mkdir(path.join(runRoot, "evidence", "commands"), { recursive: true });
await mkdir(path.join(runRoot, "evals"), { recursive: true });

const authSecret = randomBytes(32).toString("base64url");
const privacySentinel = `unit03-privacy-${randomBytes(24).toString("hex")}`;
const privateObjectRoot = path.resolve(".data/unit03-e2e-private");
const sharedEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_ORIGIN: "https://unit03.invalid",
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  CALIBRE_EBOOK_CONVERT_PATH: ebookConvertPath,
  CI: "1",
  DATABASE_URL: databaseUrl,
  IMPLEMENTATION_REVISION: implementationRevision,
  PLAYWRIGHT_HTML_OPEN: "never",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT00_SECRET_SENTINEL: authSecret,
  UNIT01_PRIVACY_SENTINEL: privacySentinel,
  UNIT01_PAYOUT_SENTINEL: privacySentinel,
  UNIT03_ALLOW_FIXTURE_SEED: "1",
  UNIT03_DATABASE_URL: databaseUrl,
  UNIT03_IMPLEMENTATION_REVISION: implementationRevision,
  UNIT03_PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT03_PRIVACY_SENTINEL: privacySentinel,
  UNIT_EVIDENCE_DIR: runRoot,
  UNIT_ID: unitId,
  WORKER_ID: "unit03-verifier-worker",
};

const sensitiveCandidates = [
  { category: "unit03-database-url", value: databaseUrl },
  {
    category: "unit03-database-password",
    value: decodeURIComponent(parsedDatabaseUrl.password),
  },
  {
    category: "unit03-database-password-encoded",
    value: parsedDatabaseUrl.password,
  },
  { category: "auth-secret", value: authSecret },
  { category: "privacy-sentinel", value: privacySentinel },
  { category: "calibre-path", value: ebookConvertPath },
  ...Object.entries(process.env)
    .filter(
      ([name, value]) =>
        value &&
        value.length >= 8 &&
        /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|CREDENTIAL|COOKIE|DATABASE_URL|CONNECTION_STRING)/iu.test(
          name,
        ),
    )
    .map(([name, value]) => ({
      category: `inherited-${name.toLocaleLowerCase("en-US")}`,
      value,
    })),
];
const seenSensitiveValues = new Set();
const sensitiveValues = sensitiveCandidates
  .filter(({ value }) => {
    if (!value || seenSensitiveValues.has(value)) return false;
    seenSensitiveValues.add(value);
    return true;
  })
  .sort((left, right) => right.value.length - left.value.length);
const commandResults = [];
let calibreVersion = "unknown";
let visualReceiptDigest = null;

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
  console.log(`\n[${unitId}] ${name}`);
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
  const redactedExecutable = redactSensitiveValues(executable);
  const redactedArguments = arguments_.map((argument) =>
    redactSensitiveValues(String(argument)),
  );
  const commandText = `${redactedExecutable} ${redactedArguments.join(" ")}`;
  if (redactedStdout) process.stdout.write(redactedStdout);
  if (redactedStderr) process.stderr.write(redactedStderr);
  const relativeReceipt = `evidence/commands/${name}.txt`;
  await writeFile(
    path.join(runRoot, relativeReceipt),
    [
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
    ].join("\n"),
    "utf8",
  );
  commandResults.push({
    arguments: redactedArguments,
    command: commandText,
    executable: redactedExecutable,
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
    unit: unitId,
    updated_at: finished.toISOString(),
  });
  if (exitCode !== 0) {
    throw new Error(
      `${name} failed${
        exitCode === null ? ` after signal ${signal}` : ` with exit code ${exitCode}`
      }`,
    );
  }
  return { stderr, stdout };
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(path.resolve(file))).digest("hex");
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
    owner: "Codex / publishing and conversion",
    status: value.status ?? "passed",
    timestamp: new Date().toISOString(),
    unit: unitId,
  });
}

const sourceFiles = [
  "docs/architecture.md",
  "docs/canonical-terms.md",
  "docs/design-brief.md",
  "docs/development-plan.md",
  "docs/dod-evals.md",
  "docs/guardrails.md",
  "docs/prd.md",
  "docs/product-idea.md",
  "docs/project-context.md",
  "docs/qa-checklist.md",
  "docs/screen-map.md",
  "docs/user-journey.md",
  "docs/wireframes.md",
  manifestPath,
];

async function writeRunResult(status, finishedAt, findings = []) {
  const sourceHashes = Object.fromEntries(
    await Promise.all(sourceFiles.map(async (file) => [file, await sha256File(file)])),
  );
  await writeJson("run.json", {
    baseline_binding: {
      baseline_id: baselineId,
      manifest: manifestPath,
      manifest_sha256: sourceHashes[manifestPath],
      target_bundle_hash: targetBundleHash,
      visual_qa_evidence: visualQaPath,
      visual_qa_evidence_sha256: expectedVisualQaHash,
    },
    baseline_id: baselineId,
    calibre_runtime: {
      executable_sha256: await sha256File(ebookConvertPath),
      version: calibreVersion,
    },
    commands: commandResults,
    database_proof: {
      database_name: expectedDatabaseName,
      engine: "PostgreSQL",
      host_class: "loopback-dedicated",
      schema_revision: expectedSchemaRevision,
    },
    finished_at: finishedAt.toISOString(),
    findings,
    implementation_revision: implementationRevision,
    implementation_tree: implementationTree,
    run_id: runId,
    source_hashes: sourceHashes,
    started_at: startedAt.toISOString(),
    status,
    target_bundle_hash: targetBundleHash,
    unit: unitId,
    visual_receipt_digest_sha256: visualReceiptDigest,
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
    if (/trace/iu.test(baseName) || /\.har$/iu.test(baseName)) {
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
    throw new Error(`${unitId} evidence hygiene failed: ${details}`);
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

function parseProofJson(stdout) {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.status === "passed") return parsed;
    } catch {
      // Keep looking for the verifier's final one-line JSON receipt.
    }
  }
  throw new Error("UNIT-03 PostgreSQL proof did not emit its passed JSON receipt");
}

async function validateVisualEvidence() {
  const matrixPath = "evidence/visual/unit03-responsive-matrix.json";
  await requireEvidenceFile(matrixPath);
  const matrix = JSON.parse(await readFile(path.join(runRoot, matrixPath), "utf8"));
  if (
    matrix.status !== "passed" ||
    matrix.baseline_id !== baselineId ||
    matrix.implementation_revision !== implementationRevision ||
    matrix.expected_receipts !== 30 ||
    matrix.receipts?.length !== 30 ||
    JSON.stringify([...(matrix.expected_accessibility_checks ?? [])].sort()) !==
      JSON.stringify([...expectedAccessibilityChecks].sort()) ||
    matrix.accessibility_receipts?.length !== expectedAccessibilityChecks.length ||
    matrix.console_errors?.length !== 0 ||
    matrix.page_errors?.length !== 0
  ) {
    throw new Error("UNIT-03 visual matrix is incomplete or not revision-bound");
  }
  const completedAccessibilityChecks = matrix.accessibility_receipts
    .map(({ check }) => check)
    .sort();
  if (
    JSON.stringify(completedAccessibilityChecks) !==
      JSON.stringify([...expectedAccessibilityChecks].sort()) ||
    matrix.accessibility_receipts.some(
      ({ implementation_revision: revision }) => revision !== implementationRevision,
    )
  ) {
    throw new Error("UNIT-03 accessibility receipts are incomplete or not revision-bound");
  }
  const receiptFiles = new Set();
  for (const receipt of matrix.receipts) {
    if (
      typeof receipt.file !== "string" ||
      !receipt.file.startsWith("evidence/visual/") ||
      receiptFiles.has(receipt.file)
    ) {
      throw new Error("UNIT-03 visual matrix contains an invalid or duplicate receipt");
    }
    receiptFiles.add(receipt.file);
    await requireEvidenceFile(receipt.file);
    if (receipt.sha256 !== (await sha256File(path.join(runRoot, receipt.file)))) {
      throw new Error(`UNIT-03 visual receipt hash mismatch: ${receipt.file}`);
    }
    const accessibility = receipt.accessibility;
    if (
      !accessibility ||
      !Array.isArray(accessibility.textContrast) ||
      !Array.isArray(accessibility.controlContrast) ||
      !Array.isArray(accessibility.placeholderContrast) ||
      !Array.isArray(accessibility.formControls) ||
      !Array.isArray(accessibility.mobileInputs) ||
      !Array.isArray(accessibility.alerts) ||
      accessibility.textContrast.some(
        ({ logoTextExemption, ratio, threshold }) =>
          !logoTextExemption && (!Number.isFinite(ratio) || ratio < threshold),
      ) ||
      accessibility.controlContrast.some(
        ({ ratio, threshold }) => !Number.isFinite(ratio) || ratio < threshold,
      ) ||
      accessibility.placeholderContrast.some(
        ({ ratio, threshold }) => !Number.isFinite(ratio) || ratio < threshold,
      ) ||
      accessibility.formControls.some(
        ({ describedByExists, labelCount }) => describedByExists !== true || labelCount < 1,
      ) ||
      accessibility.mobileInputs.some(({ fontSize }) => !Number.isFinite(fontSize) || fontSize < 16) ||
      accessibility.alerts.some(({ text }) => typeof text !== "string" || !text.trim())
    ) {
      throw new Error(`UNIT-03 accessibility evidence failed or is malformed: ${receipt.file}`);
    }
  }
  const widths = new Set(matrix.receipts.map(({ viewport }) => viewport?.width));
  const screens = new Set(matrix.receipts.map(({ screen }) => screen));
  if (
    JSON.stringify([...widths].sort((a, b) => a - b)) !==
      JSON.stringify([390, 430, 768, 1280, 1440]) ||
    !["s10", "s11", "s12"].every((screen) => screens.has(screen))
  ) {
    throw new Error("UNIT-03 visual matrix omits a required screen or viewport");
  }
  const allAccessibility = matrix.receipts.map(({ accessibility }) => accessibility);
  if (
    allAccessibility.flatMap(({ textContrast }) => textContrast).length === 0 ||
    allAccessibility.flatMap(({ controlContrast }) => controlContrast).length === 0 ||
    allAccessibility.flatMap(({ placeholderContrast }) => placeholderContrast).length === 0 ||
    allAccessibility.flatMap(({ formControls }) => formControls).length === 0 ||
    allAccessibility.flatMap(({ mobileInputs }) => mobileInputs).length === 0
  ) {
    throw new Error("UNIT-03 accessibility matrix omits a required measured category");
  }
  visualReceiptDigest = createHash("sha256")
    .update(
      JSON.stringify(
        matrix.receipts.map(({ file, sha256 }) => ({ file, sha256 })),
      ),
    )
    .digest("hex");
  return matrix;
}

async function assertRepositoryStableAtEnd() {
  const { stdout: finalRevisionOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
  });
  if (finalRevisionOutput.trim() !== implementationRevision) {
    throw new Error("Repository HEAD changed during UNIT-03 verification");
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
    .filter((file) => !file.startsWith(currentRunPrefix));
  if (unexpected.length > 0) {
    throw new Error(
      `Repository changed during UNIT-03 verification: ${[
        ...new Set(unexpected),
      ].join(", ")}`,
    );
  }
}

console.log(`${unitId} implementation revision: ${implementationRevision}`);
console.log(`Evidence directory: ${path.relative(repositoryRoot, runRoot)}`);

try {
  const calibreVersionResult = await runCommand(
    "calibre-version",
    ebookConvertPath,
    ["--version"],
  );
  calibreVersion = `${calibreVersionResult.stdout}\n${calibreVersionResult.stderr}`
    .match(/(?:calibre\s+)?([0-9]+(?:\.[0-9]+){1,3})/iu)?.[1] ?? "unknown";
  if (calibreVersion === "unknown") {
    throw new Error("Unable to identify the configured Calibre version");
  }
  const actualVisualQaHash = await sha256File(visualQaPath);
  if (actualVisualQaHash !== expectedVisualQaHash) {
    throw new Error("Approved Baseline visual-QA evidence hash mismatch");
  }
  await writeJson("evidence/conversion/calibre-runtime.json", {
    executable_sha256: await sha256File(ebookConvertPath),
    implementation_revision: implementationRevision,
    status: "passed",
    version: calibreVersion,
  });

  await runCommand("dependency-tree", "npm", ["ls", "--depth=0"]);
  await runCommand("dependency-audit", "npm", ["audit", "--audit-level=high"]);
  await runCommand("typecheck", "npm", ["run", "typecheck"]);
  await runCommand("lint", "npm", ["run", "lint"]);
  await runCommand("unit-tests", "npm", ["test"], {
    CALIBRE_EBOOK_CONVERT_PATH: "",
    UNIT03_DATABASE_URL: "",
  });
  await runCommand("repository-hygiene", "npm", ["run", "verify:repository"]);
  await runCommand("build", "npm", ["run", "build"]);

  const postgresResult = await runCommand("real-postgres-unit03", "npm", [
    "run",
    "verify:unit03:postgres",
  ]);
  const postgresProof = parseProofJson(postgresResult.stdout);
  const provenSources = postgresProof.conversion_sources
    ?.map(({ source }) => source)
    .sort();
  if (
    JSON.stringify(provenSources) !==
      JSON.stringify(["docx", "google_docs", "txt"]) ||
    postgresProof.conversion_error_retry !== "passed"
  ) {
    throw new Error(
      "UNIT-03 PostgreSQL proof must cover DOCX, TXT, Google Docs, and successful conversion retry",
    );
  }
  await writeJson("evidence/database/unit03-postgres-proof.json", {
    baseline_id: baselineId,
    calibre_version: calibreVersion,
    database_name: expectedDatabaseName,
    implementation_revision: implementationRevision,
    proof: postgresProof,
    status: "passed",
    target_bundle_hash: targetBundleHash,
    verified_at: new Date().toISOString(),
  });

  const resetEnvironment = {
    APP_ENV: "test",
    UNIT03_ALLOW_TEST_RESET: "1",
  };
  await runCommand(
    "reset-before-unit03-e2e",
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/reset-unit03-test-state.ts",
    ],
    resetEnvironment,
  );
  await runCommand("unit03-e2e", "npm", [
    "run",
    "test:unit03:e2e",
    "--",
    "--trace=off",
  ]);
  await runCommand(
    "reset-before-unit03-visual",
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/reset-unit03-test-state.ts",
    ],
    resetEnvironment,
  );
  await runCommand("unit03-visual", "npm", [
    "run",
    "test:unit03:visual",
    "--",
    "--trace=off",
  ]);

  await Promise.all(
    [
      "evidence/architecture/boundary-review.json",
      "evidence/architecture/process-runtime-identities.json",
      "evidence/commands/index.json",
      "evidence/conversion/calibre-runtime.json",
      "evidence/database/unit03-postgres-proof.json",
      "evidence/security/client-secret-boundary.json",
      "evidence/security/negative-client-import.json",
      "evidence/security/repository-secret-hygiene.json",
    ].map(requireEvidenceFile),
  );
  const visualMatrix = await validateVisualEvidence();

  const processIdentity = JSON.parse(
    await readFile(
      path.join(runRoot, "evidence/architecture/process-runtime-identities.json"),
      "utf8",
    ),
  );
  const runtimeIdentityMismatch =
    !Array.isArray(processIdentity.identities) ||
    processIdentity.identities.some(
      ({ appRevision, schemaRevision }) =>
        appRevision !== implementationRevision ||
        schemaRevision !== expectedSchemaRevision,
    );
  if (runtimeIdentityMismatch) {
    throw new Error("Worker, scheduler, and migration runtimes are not revision-bound");
  }

  const visualReceiptEvidence = visualMatrix.receipts.map(({ file }) =>
    repositoryPath(file),
  );
  const capturedScreenStates = [
    ...new Set(
      visualMatrix.receipts.map(({ screen, state }) => `${screen}:${state}`),
    ),
  ].sort();
  const capturedViewports = [
    ...new Set(
      visualMatrix.receipts.map(({ viewport }) => viewport.width),
    ),
  ].sort((left, right) => left - right);
  const touchTargets = visualMatrix.receipts.flatMap(
    ({ touch_targets: targets }) => targets ?? [],
  );
  const minimumTouchTargetHeight = Math.min(
    ...touchTargets.map(({ height }) => height),
  );
  const minimumTouchTargetWidth = Math.min(
    ...touchTargets.map(({ width }) => width),
  );
  const maximumHorizontalOverflow = Math.max(
    ...visualMatrix.receipts.map(
      ({ layout }) => layout.scrollWidth - layout.clientWidth,
    ),
  );
  if (
    touchTargets.length === 0 ||
    !Number.isFinite(minimumTouchTargetHeight) ||
    !Number.isFinite(minimumTouchTargetWidth) ||
    !Number.isFinite(maximumHorizontalOverflow)
  ) {
    throw new Error("UNIT-03 visual receipts omit accessibility measurements");
  }
  const accessibilitySamples = visualMatrix.receipts.map(
    ({ accessibility }) => accessibility,
  );
  const textContrastSamples = accessibilitySamples
    .flatMap(({ textContrast }) => textContrast)
    .filter(({ logoTextExemption }) => !logoTextExemption);
  const logoTextExemptions = accessibilitySamples
    .flatMap(({ textContrast }) => textContrast)
    .filter(({ logoTextExemption }) => logoTextExemption);
  const controlContrastSamples = accessibilitySamples.flatMap(
    ({ controlContrast }) => controlContrast,
  );
  const placeholderContrastSamples = accessibilitySamples.flatMap(
    ({ placeholderContrast }) => placeholderContrast,
  );
  const formControlSamples = accessibilitySamples.flatMap(
    ({ formControls }) => formControls,
  );
  const mobileInputSamples = accessibilitySamples.flatMap(
    ({ mobileInputs }) => mobileInputs,
  );
  const minimumTextContrast = Math.min(
    ...textContrastSamples.map(({ ratio }) => ratio),
  );
  const minimumControlContrast = Math.min(
    ...controlContrastSamples.map(({ ratio }) => ratio),
  );
  const minimumPlaceholderContrast = Math.min(
    ...placeholderContrastSamples.map(({ ratio }) => ratio),
  );
  const minimumMobileInputFont = Math.min(
    ...mobileInputSamples.map(({ fontSize }) => fontSize),
  );
  const reflowReceipts = visualMatrix.accessibility_receipts.filter(
    ({ check }) => check.endsWith("-reflow-200"),
  );
  const focusReceipts = visualMatrix.accessibility_receipts.filter(
    ({ check }) => check.includes("keyboard") || check.includes("focus"),
  );
  if (
    !Number.isFinite(minimumTextContrast) ||
    !Number.isFinite(minimumControlContrast) ||
    !Number.isFinite(minimumPlaceholderContrast) ||
    !Number.isFinite(minimumMobileInputFont) ||
    reflowReceipts.length !== 3 ||
    focusReceipts.length !== 4 ||
    formControlSamples.some(({ describedByExists, labelCount }) =>
      describedByExists !== true || labelCount < 1
    )
  ) {
    throw new Error("UNIT-03 accessibility evidence summary is incomplete");
  }

  await writeEval("build.json", {
    evidence: [
      repositoryPath("evidence/commands/dependency-tree.txt"),
      repositoryPath("evidence/commands/dependency-audit.txt"),
      repositoryPath("evidence/commands/build.txt"),
      repositoryPath("evidence/architecture/process-runtime-identities.json"),
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
  await writeEval("conversion-pipeline.json", {
    covered_checks: [
      "real DOCX, TXT, and bounded Google Docs export to valid EPUB and legacy MOBI",
      "normalization meaning hashes and inline-illustration preservation",
      "immutable BookVersion and declarations",
      "stale-job, conversion failure, and successful retry with preserved manuscript",
      "private catalog boundary",
    ],
    evidence: [
      repositoryPath("evidence/commands/real-postgres-unit03.txt"),
      repositoryPath("evidence/database/unit03-postgres-proof.json"),
      repositoryPath("evidence/conversion/calibre-runtime.json"),
    ],
    gate: "conversion_pipeline",
  });
  await writeEval("tests.json", {
    evidence: [
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/unit03-e2e.txt"),
      repositoryPath("evidence/commands/unit03-visual.txt"),
    ],
    gate: "tests",
  });
  await writeEval("journey-author-e2e.json", {
    covered_checks: [
      "Author moves from S-10 through the six-step S-11 wizard and S-12 preview",
      "S-12 announces conversion failure, retries the same draft to ready, preserves manuscript, cover, title, description, genre, and price, then requires sample reselection against the new preview artifact",
      "separate rights and five-year-license confirmations gate submission",
      "BookSubmitted persists one immutable BookVersion, two declarations, and one outbox event",
      "Author remains denied from the Manager route",
    ],
    evidence: [
      repositoryPath("evidence/commands/unit03-e2e.txt"),
      repositoryPath("evidence/database/unit03-postgres-proof.json"),
    ],
    gate: "journey_author_e2e",
    not_claimed: [
      "Manager moderation or review decisions",
      "catalog publication or a public catalog projection",
    ],
    scope_end: "author submission and BookSubmitted",
  });
  await writeEval("screen-states-coverage.json", {
    captured_states: capturedScreenStates,
    covered_functional_states: [
      "S-11 unsupported and malformed source errors with inline recovery",
      "S-11 Google Docs validation error with draft preservation",
      "S-12 conversion_failed, same-draft retry, and ready preview",
      "S-12 separate rights and five-year-license confirmations",
      "S-12 submitted confirmation after BookSubmitted",
    ],
    evidence: [
      repositoryPath("evidence/commands/unit03-e2e.txt"),
      repositoryPath("evidence/commands/unit03-visual.txt"),
      repositoryPath("evidence/visual/unit03-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    expected_receipts: 30,
    gate: "screen_states_coverage",
    not_claimed: [
      "UNIT-04 Manager moderation and rejected states",
      "UNIT-04 published catalog state",
    ],
    receipt_count: visualMatrix.receipts.length,
    screens: ["S-10", "S-11", "S-12"],
  });
  await writeEval("accessibility-floor.json", {
    claims: [
      "visible main-surface interactive targets passed the 44 CSS px floor with the suite's 0.01px measurement tolerance",
      "computed functional text and placeholder contrast passed 4.5:1 normal-text or 3:1 large-text thresholds; selected/control boundaries passed 3:1",
      "the locked UkieBook wordmark is explicitly recorded under the WCAG logotype exemption rather than misclassified as functional text",
      "S-10/S-11/S-12 expose visible 3px keyboard focus, deterministic order and keyboard activation; S-12 tabs implement the roving tab pattern",
      "form controls retain semantic labels and valid description/error references; textual errors are announced and recover focus",
      "mobile editable controls use at least 16 CSS px text",
      "200% zoom receipts keep essential headings, fields and CTAs visible, hit-testable and free of horizontal overflow on S-10/S-11/S-12",
      "the semantic-role-driven author journey completed with zero captured console or page errors",
    ],
    evidence: [
      repositoryPath("evidence/commands/unit03-e2e.txt"),
      repositoryPath("evidence/commands/unit03-visual.txt"),
      repositoryPath("evidence/visual/unit03-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "accessibility_floor",
    accessibility_checks: expectedAccessibilityChecks,
    form_control_samples: formControlSamples.length,
    logo_text_exemption_samples: logoTextExemptions.length,
    maximum_horizontal_overflow_css_px: maximumHorizontalOverflow,
    minimum_computed_control_contrast: minimumControlContrast,
    minimum_computed_placeholder_contrast: minimumPlaceholderContrast,
    minimum_computed_text_contrast: minimumTextContrast,
    minimum_mobile_input_font_css_px: minimumMobileInputFont,
    minimum_touch_target_height_css_px: minimumTouchTargetHeight,
    minimum_touch_target_width_css_px: minimumTouchTargetWidth,
    not_claimed: "A complete WCAG conformance audit beyond the measured UNIT-03 floor",
  });
  await writeEval("responsive-viewports.json", {
    evidence: [
      repositoryPath("evidence/commands/unit03-visual.txt"),
      repositoryPath("evidence/visual/unit03-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "responsive_viewports",
    maximum_horizontal_overflow_css_px: maximumHorizontalOverflow,
    receipt_count: visualMatrix.receipts.length,
    screens: ["S-10", "S-11", "S-12"],
    viewports: capturedViewports,
  });
  await writeEval("approved-visual-baseline-fidelity.json", {
    baseline_id: baselineId,
    comparison_mode:
      "Aurora V3 Author-surface extension; no S-01 pixel-lock or moderation/catalog claim",
    evidence: [
      repositoryPath("evidence/commands/unit03-visual.txt"),
      repositoryPath("evidence/visual/unit03-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "approved_visual_baseline_fidelity",
    screens: ["S-10", "S-11", "S-12"],
    target_bundle_hash: targetBundleHash,
    viewports: [390, 430, 768, 1280, 1440],
    visual_receipt_digest_sha256: visualReceiptDigest,
  });

  const initialEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit03-evidence-secret-scan.json", initialEvidenceScan);
  const finishedAt = new Date();
  await writeRunResult("passed", finishedAt);
  const finalEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit03-evidence-secret-scan.json", {
    ...finalEvidenceScan,
    file_set_includes_run_json: true,
    file_set_includes_scan_receipt: true,
    scan_phase: "post-run-json-final",
  });
  const sealedFileCount = (await listFiles(runRoot)).length;
  if (sealedFileCount !== finalEvidenceScan.checked_files) {
    throw new Error("UNIT-03 final evidence scan file count became stale while sealing");
  }
  await assertRepositoryStableAtEnd();
  console.log(
    `${unitId} verification passed; evidence: ${path.relative(repositoryRoot, runRoot)}`,
  );
} catch (error) {
  const finishedAt = new Date();
  let summary = redactSensitiveValues(
    error instanceof Error ? error.message : String(error),
  );
  try {
    const failedRunScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit03-evidence-secret-scan.json", {
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
    await writeJson("evidence/security/unit03-evidence-secret-scan.json", {
      ...finalFailedRunScan,
      run_status: "failed",
    });
  } catch (writeError) {
    console.error(
      `Unable to persist failed ${unitId} run: ${redactSensitiveValues(
        writeError instanceof Error ? writeError.message : String(writeError),
      )}`,
    );
  }
  throw new Error(summary);
}
