import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
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
const unitId = "UNIT-04";
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const targetBundleHash =
  "e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724";
const expectedDatabaseName = "ukiebook_unit04";
const expectedSchemaRevision = "0005_moderation_publication";
const expectedReceiptCount = 50;
const expectedAccessibilityChecks = [
  "s13-keyboard-order-focus-activation",
  "s13-reflow-200",
  "s18-queue-keyboard-list-detail",
  "s18-reason-validation-focus",
  "s18-removal-dialog-focus-trap-return",
  "s18-mobile-list-detail-back",
  "s18-reflow-200",
  "s02-unavailable-reflow-200",
];
const requiredCoreStates = [
  "s13:submitted",
  "s13:manual-review",
  "s13:rejected",
  "s13:published",
  "s13:removed",
  "s18:mixed-queue",
  "s18:book-selected",
  "s18:book-update-selected",
  "s18:review-selected",
  "s18:ai-unavailable",
  "s18:empty",
  "s18:removal-dialog",
  "s18:category-error",
  "s02:unavailable-after-removal",
];
const databaseUrl = process.env.UNIT04_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("UNIT04_DATABASE_URL is required for the UNIT-04 verifier");
}

function requireDedicatedDatabase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("UNIT04_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "UNIT04_DATABASE_URL must not contain connection override parameters",
    );
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(
      "UNIT04_DATABASE_URL must use postgres: or postgresql:",
    );
  }
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(parsed.hostname)) {
    throw new Error(
      "UNIT-04 database mutation is restricted to a loopback PostgreSQL host",
    );
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `UNIT-04 database mutation requires the exact database ${expectedDatabaseName}`,
    );
  }
  if (!parsed.username || !parsed.password) {
    throw new Error(
      "UNIT04_DATABASE_URL must include dedicated PostgreSQL credentials",
    );
  }
  return parsed;
}

const parsedDatabaseUrl = requireDedicatedDatabase(databaseUrl);

const { stdout: revisionOutput } = await execFileAsync(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: repositoryRoot },
);
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
  throw new Error(
    "UNIT-04 verification must start from a clean implementation commit",
  );
}

const manifestPath = "forge/sdd-manifest.json";
const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
if (
  manifest.approved_baseline_id !== baselineId ||
  manifest.active_baseline?.baseline_id !== baselineId ||
  manifest.active_baseline?.visual_target_hash !== targetBundleHash
) {
  throw new Error(
    "UNIT-04 verifier baseline binding does not match forge/sdd-manifest.json",
  );
}
const visualQaPath = manifest.active_baseline.visual_qa_evidence;
const expectedVisualQaHash =
  manifest.active_baseline.visual_qa_evidence_sha256;

const startedAt = new Date();
const runId = `${startedAt
  .toISOString()
  .replace(/[-:]/gu, "")
  .replace(/\.\d{3}Z$/u, "Z")}-${implementationRevision.slice(0, 12)}`;
const runRoot = path.resolve("forge", "runs", unitId, runId);
await mkdir(path.join(runRoot, "evidence", "commands"), { recursive: true });
await mkdir(path.join(runRoot, "evals"), { recursive: true });

const authSecret = randomBytes(32).toString("base64url");
const privacySentinel = `unit04-privacy-${randomBytes(24).toString("hex")}`;
const internalSignalSentinel = `unit04-internal-${randomBytes(24).toString("hex")}`;
const privateObjectRoot = path.resolve(".data/unit04-evidence-private");
const publicAssetRoot = path.resolve(".data/unit04-evidence-public");
const sharedEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_ORIGIN: "https://unit04.invalid",
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  CI: "1",
  DATABASE_URL: databaseUrl,
  IMPLEMENTATION_REVISION: implementationRevision,
  PLAYWRIGHT_HTML_OPEN: "never",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  PUBLIC_CATALOG_ASSET_ROOT: publicAssetRoot,
  UNIT00_SECRET_SENTINEL: authSecret,
  UNIT01_PRIVACY_SENTINEL: privacySentinel,
  UNIT01_PAYOUT_SENTINEL: privacySentinel,
  UNIT04_ALLOW_FIXTURE_SEED: "1",
  UNIT04_DATABASE_URL: databaseUrl,
  UNIT04_IMPLEMENTATION_REVISION: implementationRevision,
  UNIT04_INTERNAL_SIGNAL_SENTINEL: internalSignalSentinel,
  UNIT04_PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT04_PRIVACY_SENTINEL: privacySentinel,
  UNIT04_PUBLIC_ASSET_ROOT: publicAssetRoot,
  UNIT_EVIDENCE_DIR: runRoot,
  UNIT_ID: unitId,
  WORKER_ID: "unit04-verifier-worker",
};

const sensitiveCandidates = [
  { category: "unit04-database-url", value: databaseUrl },
  {
    category: "unit04-database-password",
    value: decodeURIComponent(parsedDatabaseUrl.password),
  },
  {
    category: "unit04-database-password-encoded",
    value: parsedDatabaseUrl.password,
  },
  { category: "auth-secret", value: authSecret },
  { category: "privacy-sentinel", value: privacySentinel },
  { category: "internal-signal-sentinel", value: internalSignalSentinel },
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
let visualReceiptDigest = null;

function redactSensitiveValues(value) {
  let redacted = value;
  for (const marker of sensitiveValues) {
    redacted = redacted
      .split(marker.value)
      .join(`[REDACTED:${marker.category}]`);
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
        exitCode === null
          ? ` after signal ${signal}`
          : ` with exit code ${exitCode}`
      }`,
    );
  }
  return { stderr, stdout };
}

async function sha256File(file) {
  return createHash("sha256")
    .update(await readFile(path.resolve(file)))
    .digest("hex");
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
    owner: "Codex / moderation and publication",
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
    await Promise.all(
      sourceFiles.map(async (file) => [file, await sha256File(file)]),
    ),
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
          offset = contents.indexOf(
            markerBytes,
            offset + markerBytes.length,
          );
        }
      }
      await writeFile(target, contents);
    }
    for (const relative of forbiddenArtifacts) {
      await unlink(path.join(runRoot, relative));
    }
    throw new Error(
      `${unitId} evidence hygiene failed: ${[
        ...leaks.map(({ category, file }) => `${category} in ${file}`),
        ...forbiddenArtifacts.map((file) => `trace/HAR artifact ${file}`),
      ].join(", ")}`,
    );
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
      if (parsed && typeof parsed === "object" && parsed.status === "passed") {
        return parsed;
      }
    } catch {
      // Continue until the verifier's final one-line JSON receipt is found.
    }
  }
  throw new Error("UNIT-04 PostgreSQL proof did not emit a passed JSON receipt");
}

async function validateVisualEvidence() {
  const matrixPath = "evidence/visual/unit04-responsive-matrix.json";
  await requireEvidenceFile(matrixPath);
  const matrix = JSON.parse(
    await readFile(path.join(runRoot, matrixPath), "utf8"),
  );
  if (
    matrix.status !== "passed" ||
    matrix.baseline_id !== baselineId ||
    matrix.implementation_revision !== implementationRevision ||
    matrix.expected_receipts !== expectedReceiptCount ||
    matrix.receipts?.length !== expectedReceiptCount ||
    JSON.stringify([...(matrix.expected_accessibility_checks ?? [])].sort()) !==
      JSON.stringify([...expectedAccessibilityChecks].sort()) ||
    matrix.accessibility_receipts?.length !==
      expectedAccessibilityChecks.length ||
    matrix.console_errors?.length !== 0 ||
    matrix.page_errors?.length !== 0
  ) {
    throw new Error("UNIT-04 visual matrix is incomplete or not revision-bound");
  }

  const completedAccessibilityChecks = matrix.accessibility_receipts
    .map(({ check }) => check)
    .sort();
  if (
    JSON.stringify(completedAccessibilityChecks) !==
      JSON.stringify([...expectedAccessibilityChecks].sort()) ||
    matrix.accessibility_receipts.some(
      ({ implementation_revision: revision }) =>
        revision !== implementationRevision,
    )
  ) {
    throw new Error(
      "UNIT-04 accessibility receipts are incomplete or not revision-bound",
    );
  }

  const receiptFiles = new Set();
  for (const receipt of matrix.receipts) {
    if (
      typeof receipt.file !== "string" ||
      !receipt.file.startsWith("evidence/visual/") ||
      receiptFiles.has(receipt.file)
    ) {
      throw new Error(
        "UNIT-04 visual matrix contains an invalid or duplicate receipt",
      );
    }
    receiptFiles.add(receipt.file);
    await requireEvidenceFile(receipt.file);
    if (
      receipt.sha256 !==
      (await sha256File(path.join(runRoot, receipt.file)))
    ) {
      throw new Error(
        `UNIT-04 visual receipt hash mismatch: ${receipt.file}`,
      );
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
          !logoTextExemption &&
          (!Number.isFinite(ratio) || ratio < threshold),
      ) ||
      accessibility.controlContrast.some(
        ({ ratio, threshold }) =>
          !Number.isFinite(ratio) || ratio < threshold,
      ) ||
      accessibility.placeholderContrast.some(
        ({ ratio, threshold }) =>
          !Number.isFinite(ratio) || ratio < threshold,
      ) ||
      accessibility.formControls.some(
        ({ describedByExists, labelCount }) =>
          describedByExists !== true || labelCount < 1,
      ) ||
      accessibility.mobileInputs.some(
        ({ fontSize }) => !Number.isFinite(fontSize) || fontSize < 16,
      ) ||
      accessibility.alerts.some(
        ({ text }) => typeof text !== "string" || !text.trim(),
      )
    ) {
      throw new Error(
        `UNIT-04 accessibility evidence failed or is malformed: ${receipt.file}`,
      );
    }
  }

  const capturedCoreStates = new Set(
    matrix.receipts.map(({ screen, state }) => `${screen}:${state}`),
  );
  const missingStates = requiredCoreStates.filter(
    (state) => !capturedCoreStates.has(state),
  );
  const widths = [
    ...new Set(matrix.receipts.map(({ viewport }) => viewport?.width)),
  ].sort((left, right) => left - right);
  if (
    missingStates.length > 0 ||
    JSON.stringify(widths) !== JSON.stringify([390, 430, 768, 1280, 1440])
  ) {
    throw new Error(
      `UNIT-04 visual matrix coverage is incomplete: ${missingStates.join(", ")}`,
    );
  }
  for (const state of requiredCoreStates) {
    const [screen, name] = state.split(":");
    const stateWidths = matrix.receipts
      .filter(({ screen: value, state: valueState }) =>
        value === screen && valueState === name,
      )
      .map(({ viewport }) => viewport.width);
    for (const requiredWidth of [390, 768, 1280]) {
      if (!stateWidths.includes(requiredWidth)) {
        throw new Error(
          `UNIT-04 core visual state ${state} omits ${requiredWidth}px`,
        );
      }
    }
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
  const { stdout: finalRevisionOutput } = await execFileAsync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: repositoryRoot },
  );
  const { stdout: finalTreeOutput } = await execFileAsync(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    { cwd: repositoryRoot },
  );
  if (
    finalRevisionOutput.trim() !== implementationRevision ||
    finalTreeOutput.trim() !== implementationTree
  ) {
    throw new Error("Repository revision or tree changed during UNIT-04 verification");
  }
  const { stdout: finalStatusOutput } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot },
  );
  const currentRunPrefix = `${path
    .relative(repositoryRoot, runRoot)
    .split(path.sep)
    .join("/")}/`;
  const unexpected = finalStatusOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .flatMap((file) => (file.includes(" -> ") ? file.split(" -> ") : [file]))
    .filter((file) => !file.startsWith(currentRunPrefix));
  if (unexpected.length > 0) {
    throw new Error(
      `Repository changed during UNIT-04 verification: ${[
        ...new Set(unexpected),
      ].join(", ")}`,
    );
  }
}

console.log(`${unitId} implementation revision: ${implementationRevision}`);
console.log(`Evidence directory: ${path.relative(repositoryRoot, runRoot)}`);

try {
  if ((await sha256File(visualQaPath)) !== expectedVisualQaHash) {
    throw new Error("Approved Baseline visual-QA evidence hash mismatch");
  }

  await runCommand("dependency-tree", "npm", ["ls", "--depth=0"]);
  await runCommand("dependency-audit", "npm", [
    "audit",
    "--audit-level=high",
  ]);
  await runCommand("typecheck", "npm", ["run", "typecheck"]);
  await runCommand("lint", "npm", ["run", "lint"]);
  await runCommand(
    "unit-tests",
    "npm",
    ["test"],
    { UNIT04_DATABASE_URL: "" },
  );
  await runCommand("repository-hygiene", "npm", [
    "run",
    "verify:repository",
  ]);
  await runCommand("build", "npm", ["run", "build"]);

  const postgresResult = await runCommand("real-postgres-unit04", "npm", [
    "run",
    "verify:unit04:postgres",
  ]);
  const postgresProof = parseProofJson(postgresResult.stdout);
  const requiredProofKeys = [
    "migration_roundtrip",
    "book_submitted_idempotency",
    "author_decision_denied",
    "safe_auto_publication",
    "risky_manual_routing",
    "ai_outage_safe_fail",
    "book_approval",
    "book_rejection_reason_only",
    "update_decision_contract",
    "review_decision_contract",
    "decision_concurrency",
    "active_version_invariant",
    "catalog_activation",
    "removal_unavailable",
    "append_only_audit",
    "internal_signal_non_disclosure",
  ];
  const missingProofs = requiredProofKeys.filter(
    (key) => postgresProof[key] !== "passed",
  );
  if (missingProofs.length > 0) {
    throw new Error(
      `UNIT-04 PostgreSQL proof is incomplete: ${missingProofs.join(", ")}`,
    );
  }
  await writeJson("evidence/database/unit04-postgres-proof.json", {
    baseline_id: baselineId,
    database_name: expectedDatabaseName,
    implementation_revision: implementationRevision,
    proof: postgresProof,
    schema_revision: expectedSchemaRevision,
    status: "passed",
    target_bundle_hash: targetBundleHash,
    verified_at: new Date().toISOString(),
  });

  const resetEnvironment = {
    APP_ENV: "test",
    UNIT04_ALLOW_TEST_RESET: "1",
  };
  for (const phase of ["e2e", "visual"]) {
    await runCommand(
      `reset-before-unit04-${phase}`,
      "npx",
      [
        "--no-install",
        "tsx",
        "--conditions=react-server",
        "scripts/reset-unit04-test-state.ts",
      ],
      resetEnvironment,
    );
    await runCommand(`unit04-${phase}`, "npm", [
      "run",
      `test:unit04:${phase}`,
      "--",
      "--trace=off",
    ]);
  }

  await Promise.all(
    [
      "evidence/architecture/boundary-review.json",
      "evidence/architecture/process-runtime-identities.json",
      "evidence/commands/index.json",
      "evidence/database/unit04-postgres-proof.json",
      "evidence/security/client-secret-boundary.json",
      "evidence/security/negative-client-import.json",
      "evidence/security/repository-secret-hygiene.json",
    ].map(requireEvidenceFile),
  );
  const visualMatrix = await validateVisualEvidence();

  const processIdentity = JSON.parse(
    await readFile(
      path.join(
        runRoot,
        "evidence/architecture/process-runtime-identities.json",
      ),
      "utf8",
    ),
  );
  if (
    !Array.isArray(processIdentity.identities) ||
    processIdentity.identities.some(
      ({ appRevision, schemaRevision }) =>
        appRevision !== implementationRevision ||
        schemaRevision !== expectedSchemaRevision,
    )
  ) {
    throw new Error(
      "Worker, scheduler, and migration runtimes are not UNIT-04 revision-bound",
    );
  }

  const visualReceiptEvidence = visualMatrix.receipts.map(({ file }) =>
    repositoryPath(file),
  );
  const capturedStates = [
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
  const maximumHorizontalOverflow = Math.max(
    ...visualMatrix.receipts.map(
      ({ layout }) => layout.scrollWidth - layout.clientWidth,
    ),
  );
  const minimumTouchTargetHeight = Math.min(
    ...touchTargets.map(({ height }) => height),
  );
  const minimumTouchTargetWidth = Math.min(
    ...touchTargets.map(({ width }) => width),
  );
  const accessibilitySamples = visualMatrix.receipts.map(
    ({ accessibility }) => accessibility,
  );
  const textContrast = accessibilitySamples
    .flatMap(({ textContrast: samples }) => samples)
    .filter(({ logoTextExemption }) => !logoTextExemption);
  const controlContrast = accessibilitySamples.flatMap(
    ({ controlContrast: samples }) => samples,
  );
  const placeholderContrast = accessibilitySamples.flatMap(
    ({ placeholderContrast: samples }) => samples,
  );
  const formControls = accessibilitySamples.flatMap(
    ({ formControls: samples }) => samples,
  );
  const mobileInputs = accessibilitySamples.flatMap(
    ({ mobileInputs: samples }) => samples,
  );
  const minimumTextContrast = Math.min(
    ...textContrast.map(({ ratio }) => ratio),
  );
  const minimumControlContrast = Math.min(
    ...controlContrast.map(({ ratio }) => ratio),
  );
  const minimumPlaceholderContrast = placeholderContrast.length > 0
    ? Math.min(...placeholderContrast.map(({ ratio }) => ratio))
    : null;
  const minimumMobileInputFont = Math.min(
    ...mobileInputs.map(({ fontSize }) => fontSize),
  );
  if (
    touchTargets.length === 0 ||
    !Number.isFinite(maximumHorizontalOverflow) ||
    !Number.isFinite(minimumTouchTargetHeight) ||
    !Number.isFinite(minimumTouchTargetWidth) ||
    !Number.isFinite(minimumTextContrast) ||
    !Number.isFinite(minimumControlContrast) ||
    (minimumPlaceholderContrast !== null &&
      !Number.isFinite(minimumPlaceholderContrast)) ||
    !Number.isFinite(minimumMobileInputFont) ||
    formControls.some(
      ({ describedByExists, labelCount }) =>
        describedByExists !== true || labelCount < 1,
    )
  ) {
    throw new Error("UNIT-04 accessibility evidence summary is incomplete");
  }

  const commonTestEvidence = [
    repositoryPath("evidence/commands/unit-tests.txt"),
    repositoryPath("evidence/commands/unit04-e2e.txt"),
    repositoryPath("evidence/commands/unit04-visual.txt"),
  ];
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
  await writeEval("tests.json", {
    evidence: commonTestEvidence,
    gate: "tests",
  });
  await writeEval("moderation-flow.json", {
    covered_checks: requiredProofKeys.slice(1, 11),
    evidence: [
      repositoryPath("evidence/commands/real-postgres-unit04.txt"),
      repositoryPath("evidence/database/unit04-postgres-proof.json"),
      repositoryPath("evidence/commands/unit04-e2e.txt"),
    ],
    gate: "moderation_flow",
  });
  await writeEval("access-separation.json", {
    covered_checks: [
      "Guest cannot enter Manager routes",
      "Author cannot enter Manager routes or execute Manager decisions",
      "Author/public DTOs omit internal AI signals and decision criteria",
      "invalid Origin/CSRF cannot mutate moderation state",
    ],
    evidence: [
      repositoryPath("evidence/database/unit04-postgres-proof.json"),
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/unit04-e2e.txt"),
    ],
    gate: "access_separation",
    scope_limit: "UNIT-04 moderation roles; rewards/founder visibility remains later",
  });
  await writeEval("publication-lifecycle.json", {
    covered_checks: [
      "one active immutable BookVersion publication per Book",
      "Catalog activation is replay-safe",
      "FR-LIC-4 removal is confirmed, audited, replay-safe and produces known unavailable S-02",
    ],
    evidence: [
      repositoryPath("evidence/database/unit04-postgres-proof.json"),
      repositoryPath("evidence/commands/unit04-e2e.txt"),
    ],
    gate: "publication_lifecycle",
  });
  await writeEval("catalog-read-model.json", {
    evidence: [
      repositoryPath("evidence/database/unit04-postgres-proof.json"),
      repositoryPath("evidence/commands/unit04-e2e.txt"),
    ],
    gate: "catalog_read_model",
    scope: "publication activation and unavailable projection only",
  });
  await writeEval("journey-author-e2e.json", {
    covered_checks: [
      "current-revision Author submission reaches moderation",
      "safe and risky paths reach authoritative Author and public states",
      "rejection returns only a neutral ReasonCategory",
      "Author never enters Manager UI",
    ],
    evidence: [
      repositoryPath("evidence/commands/unit04-e2e.txt"),
      repositoryPath("evidence/database/unit04-postgres-proof.json"),
    ],
    gate: "journey_author_e2e",
    not_claimed: [
      "Discount/S-14/250 UAH update lifecycle",
      "review submission and public review rendering",
    ],
  });
  await writeEval("screen-states-coverage.json", {
    captured_states: capturedStates,
    evidence: [
      repositoryPath("evidence/commands/unit04-e2e.txt"),
      repositoryPath("evidence/commands/unit04-visual.txt"),
      repositoryPath("evidence/visual/unit04-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    expected_receipts: expectedReceiptCount,
    gate: "screen_states_coverage",
    receipt_count: visualMatrix.receipts.length,
    screens: ["S-02", "S-13", "S-18"],
  });
  await writeEval("accessibility-floor.json", {
    accessibility_checks: expectedAccessibilityChecks,
    evidence: [
      repositoryPath("evidence/commands/unit04-e2e.txt"),
      repositoryPath("evidence/commands/unit04-visual.txt"),
      repositoryPath("evidence/visual/unit04-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    form_control_samples: formControls.length,
    gate: "accessibility_floor",
    maximum_horizontal_overflow_css_px: maximumHorizontalOverflow,
    minimum_computed_control_contrast: minimumControlContrast,
    minimum_computed_placeholder_contrast: minimumPlaceholderContrast,
    minimum_computed_text_contrast: minimumTextContrast,
    minimum_mobile_input_font_css_px: minimumMobileInputFont,
    minimum_touch_target_height_css_px: minimumTouchTargetHeight,
    minimum_touch_target_width_css_px: minimumTouchTargetWidth,
    placeholder_samples: placeholderContrast.length,
    placeholder_contrast_not_applicable: placeholderContrast.length === 0,
    not_claimed:
      "A complete WCAG conformance audit or release-wide AT/browser coverage",
  });
  await writeEval("responsive-viewports.json", {
    evidence: [
      repositoryPath("evidence/commands/unit04-visual.txt"),
      repositoryPath("evidence/visual/unit04-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "responsive_viewports",
    maximum_horizontal_overflow_css_px: maximumHorizontalOverflow,
    receipt_count: visualMatrix.receipts.length,
    screens: ["S-02", "S-13", "S-18"],
    viewports: capturedViewports,
  });
  await writeEval("approved-visual-baseline-fidelity.json", {
    baseline_id: baselineId,
    comparison_mode:
      "Aurora V3 Author/Manager/Public extension; no S-01 pixel-lock claim",
    evidence: [
      repositoryPath("evidence/commands/unit04-visual.txt"),
      repositoryPath("evidence/visual/unit04-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "approved_visual_baseline_fidelity",
    screens: ["S-02", "S-13", "S-18"],
    target_bundle_hash: targetBundleHash,
    viewports: capturedViewports,
    visual_receipt_digest_sha256: visualReceiptDigest,
  });

  const initialEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson(
    "evidence/security/unit04-evidence-secret-scan.json",
    initialEvidenceScan,
  );
  const finishedAt = new Date();
  await writeRunResult("passed", finishedAt);
  const finalEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit04-evidence-secret-scan.json", {
    ...finalEvidenceScan,
    file_set_includes_run_json: true,
    file_set_includes_scan_receipt: true,
    scan_phase: "post-run-json-final",
  });
  if ((await listFiles(runRoot)).length !== finalEvidenceScan.checked_files) {
    throw new Error(
      "UNIT-04 final evidence scan file count became stale while sealing",
    );
  }
  await assertRepositoryStableAtEnd();
  console.log(
    `${unitId} verification passed; evidence: ${path.relative(
      repositoryRoot,
      runRoot,
    )}`,
  );
} catch (error) {
  const finishedAt = new Date();
  let summary = redactSensitiveValues(
    error instanceof Error ? error.message : String(error),
  );
  try {
    const failedScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit04-evidence-secret-scan.json", {
      ...failedScan,
      run_status: "failed",
    });
  } catch (hygieneError) {
    summary = `${summary}; ${redactSensitiveValues(
      hygieneError instanceof Error
        ? hygieneError.message
        : String(hygieneError),
    )}`;
  }
  try {
    await writeRunResult("failed", finishedAt, [
      { release_effect: "blocking", severity: "P1", summary },
    ]);
    const finalFailedScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit04-evidence-secret-scan.json", {
      ...finalFailedScan,
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
