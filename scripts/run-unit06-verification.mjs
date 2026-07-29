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

import { UNIT06_DATABASE_NAME } from "./unit06-database-guard.ts";
import { openUnit06Database } from "./unit06-embedded-postgres.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const unitId = "UNIT-06";
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const targetBundleHash =
  "e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724";
const expectedSchemaRevision = "0007_library_reviews_refunds";
const expectedReceiptCount = 12;
const requiredVisualStates = [
  "s07:buyer-library",
  "s08:verified-review-form",
  "s09:refund-dialog",
  "s20:manager-refund-queue",
];
const requiredPostgresProofs = [
  "approved_version_resolution",
  "download_authorization",
  "entitlement_from_paid_sale",
  "exactly_once_refund_compensation",
  "migration_roundtrip",
  "post_refund_revocation",
  "review_manual_moderation",
];
const manifestPath = "forge/sdd-manifest.json";
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
    "UNIT-06 verification must start from a clean implementation commit",
  );
}

const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
if (
  manifest.approved_baseline_id !== baselineId ||
  manifest.active_baseline?.baseline_id !== baselineId ||
  manifest.active_baseline?.visual_target_hash !== targetBundleHash
) {
  throw new Error(
    "UNIT-06 verifier baseline binding does not match forge/sdd-manifest.json",
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

const verificationDatabase = await openUnit06Database();
const databaseUrl = verificationDatabase.url;
const parsedDatabaseUrl = new URL(databaseUrl);
const authSecret = randomBytes(32).toString("base64url");
const monoMerchantToken = randomBytes(32).toString("base64url");
const googleClientSecret = randomBytes(32).toString("base64url");
const facebookClientSecret = randomBytes(32).toString("base64url");
const privateObjectRoot = path.resolve(".data/unit06-evidence-private");
const publicAssetRoot = path.resolve(".data/unit06-evidence-public");
const sharedEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_ORIGIN: "https://unit06.invalid",
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  CI: "1",
  DATABASE_URL: databaseUrl,
  EMAIL_FROM: "purchases@ukiebook.invalid",
  FACEBOOK_OAUTH_CLIENT_ID: "unit06-facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: facebookClientSecret,
  GOOGLE_OAUTH_CLIENT_ID: "unit06-google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: googleClientSecret,
  IMPLEMENTATION_REVISION: implementationRevision,
  MONO_API_ORIGIN: "https://api.monobank.ua",
  MONO_MERCHANT_TOKEN: monoMerchantToken,
  PAYMENT_RECONCILIATION_INTERVAL_MS: "1000",
  PAYMENT_SESSION_VALIDITY_SECONDS: "3600",
  PAYMENT_WEBHOOK_MAX_BYTES: "65536",
  PLAYWRIGHT_HTML_OPEN: "never",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  PUBLIC_CATALOG_ASSET_ROOT: publicAssetRoot,
  UNIT06_ALLOW_FIXTURE_SEED: "1",
  UNIT06_DATABASE_URL: databaseUrl,
  UNIT06_IMPLEMENTATION_REVISION: implementationRevision,
  UNIT06_PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT_EVIDENCE_DIR: runRoot,
  UNIT_ID: unitId,
  WORKER_ID: "unit06-verifier-worker",
};
const sensitiveCandidates = [
  { category: "unit06-database-url", value: databaseUrl },
  {
    category: "unit06-database-password",
    value: decodeURIComponent(parsedDatabaseUrl.password),
  },
  {
    category: "unit06-database-password-encoded",
    value: parsedDatabaseUrl.password,
  },
  { category: "auth-secret", value: authSecret },
  { category: "mono-merchant-token", value: monoMerchantToken },
  { category: "google-client-secret", value: googleClientSecret },
  { category: "facebook-client-secret", value: facebookClientSecret },
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
  const commandStartedAt = new Date();
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
  const commandFinishedAt = new Date();
  const redactedStdout = redactSensitiveValues(stdout);
  const redactedStderr = redactSensitiveValues(stderr);
  const redactedExecutable = redactSensitiveValues(executable);
  const redactedArguments = arguments_.map((argument) =>
    redactSensitiveValues(String(argument)),
  );
  const commandText = `${redactedExecutable} ${redactedArguments.join(" ")}`;
  if (redactedStdout) process.stdout.write(redactedStdout);
  if (redactedStderr) process.stderr.write(redactedStderr);
  const receipt = `evidence/commands/${name}.txt`;
  await writeFile(
    path.join(runRoot, receipt),
    [
      `name: ${name}`,
      `command: ${commandText}`,
      `implementation_revision: ${implementationRevision}`,
      `started_at: ${commandStartedAt.toISOString()}`,
      `finished_at: ${commandFinishedAt.toISOString()}`,
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
    finished_at: commandFinishedAt.toISOString(),
    name,
    receipt,
    signal,
    started_at: commandStartedAt.toISOString(),
  });
  await writeJson("evidence/commands/index.json", {
    commands: commandResults,
    implementation_revision: implementationRevision,
    unit: unitId,
    updated_at: commandFinishedAt.toISOString(),
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
    owner: "Codex / library, reviews and refunds",
    status: value.status ?? "passed",
    timestamp: new Date().toISOString(),
    unit: unitId,
  });
}

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
      database_name: UNIT06_DATABASE_NAME,
      engine: "PostgreSQL",
      evidence: repositoryPath(
        "evidence/database/unit06-postgres-proof.json",
      ),
      host_class: verificationDatabase.embedded
        ? "loopback-embedded-dedicated"
        : "loopback-explicit-dedicated",
      schema_revision: expectedSchemaRevision,
    },
    evidence_index: {
      buyer_library_e2e: repositoryPath(
        "evidence/commands/unit06-e2e.txt",
      ),
      postgresql_integration: repositoryPath(
        "evidence/database/unit06-postgres-proof.json",
      ),
      responsive_visual_matrix: repositoryPath(
        "evidence/visual/unit06-responsive-matrix.json",
      ),
      visual_run: repositoryPath(
        "evidence/commands/unit06-visual.txt",
      ),
    },
    finished_at: finishedAt.toISOString(),
    findings,
    implementation_revision: implementationRevision,
    implementation_tree: implementationTree,
    prototype_reuse: "none",
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
    if (/trace/iu.test(path.basename(file)) || /\.har$/iu.test(file)) {
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
      // Keep looking for the verifier's final one-line JSON receipt.
    }
  }
  throw new Error("UNIT-06 PostgreSQL proof did not emit a passed JSON receipt");
}

async function validateVisualEvidence() {
  const matrixPath = "evidence/visual/unit06-responsive-matrix.json";
  await requireEvidenceFile(matrixPath);
  const matrix = JSON.parse(
    await readFile(path.join(runRoot, matrixPath), "utf8"),
  );
  if (
    matrix.status !== "passed" ||
    matrix.baseline_id !== baselineId ||
    matrix.implementation_revision !== implementationRevision ||
    matrix.expected_receipt_count !== expectedReceiptCount ||
    matrix.receipts?.length !== expectedReceiptCount ||
    matrix.console_errors?.length !== 0 ||
    matrix.page_errors?.length !== 0
  ) {
    throw new Error("UNIT-06 visual matrix is incomplete or not revision-bound");
  }

  const receiptFiles = new Set();
  for (const receipt of matrix.receipts) {
    if (
      receipt.baseline_id !== baselineId ||
      receipt.implementation_revision !== implementationRevision ||
      typeof receipt.file !== "string" ||
      !receipt.file.startsWith("evidence/visual/") ||
      receiptFiles.has(receipt.file)
    ) {
      throw new Error(
        "UNIT-06 visual matrix contains an invalid or duplicate receipt",
      );
    }
    receiptFiles.add(receipt.file);
    await requireEvidenceFile(receipt.file);
    if (
      receipt.sha256 !==
      (await sha256File(path.join(runRoot, receipt.file)))
    ) {
      throw new Error(`UNIT-06 visual receipt hash mismatch: ${receipt.file}`);
    }
    if (
      receipt.accessibility?.semantic_main !== "passed" ||
      !Array.isArray(receipt.accessibility?.controls) ||
      receipt.accessibility.controls.some(
        ({ height, labelCount, tag }) =>
          !Number.isFinite(height) ||
          height < 43.9 ||
          (tag !== "button" && labelCount < 1),
      ) ||
      receipt.layout?.scrollWidth > receipt.layout?.clientWidth + 1 ||
      receipt.viewport?.device_scale_factor !== 2
    ) {
      throw new Error(
        `UNIT-06 accessibility/layout evidence failed: ${receipt.file}`,
      );
    }
  }

  const capturedStates = new Set(
    matrix.receipts.map(({ screen, state }) => `${screen}:${state}`),
  );
  const missingStates = requiredVisualStates.filter(
    (state) => !capturedStates.has(state),
  );
  if (missingStates.length > 0) {
    throw new Error(
      `UNIT-06 visual matrix omits states: ${missingStates.join(", ")}`,
    );
  }
  for (const state of requiredVisualStates) {
    const [screen, name] = state.split(":");
    const stateWidths = matrix.receipts
      .filter(
        ({ screen: value, state: valueState }) =>
          value === screen && valueState === name,
      )
      .map(({ viewport }) => viewport.width)
      .sort((left, right) => left - right);
    if (JSON.stringify(stateWidths) !== JSON.stringify([390, 768, 1280])) {
      throw new Error(`UNIT-06 visual state ${state} lacks required widths`);
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
    throw new Error("Repository revision or tree changed during UNIT-06 verification");
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
      `Repository changed during UNIT-06 verification: ${[
        ...new Set(unexpected),
      ].join(", ")}`,
    );
  }
}

console.log(`${unitId} implementation revision: ${implementationRevision}`);
console.log(`Evidence directory: ${path.relative(repositoryRoot, runRoot)}`);
console.log(
  `Database mode: ${verificationDatabase.embedded ? "embedded" : "explicit"}`,
);

try {
  if ((await sha256File(visualQaPath)) !== expectedVisualQaHash) {
    throw new Error("Approved Baseline visual-QA evidence hash mismatch");
  }

  await runCommand("dependency-tree", "npm", ["ls", "--depth=0"]);
  await runCommand("typecheck", "npm", ["run", "typecheck"]);
  await runCommand("lint", "npm", ["run", "lint"]);
  await runCommand("unit-tests", "npm", ["test"]);
  await runCommand("repository-hygiene", "npm", [
    "run",
    "verify:repository",
  ]);
  await runCommand("build", "npm", ["run", "build"]);

  const postgresResult = await runCommand("real-postgres-unit06", "npm", [
    "run",
    "verify:unit06:postgres",
  ]);
  const postgresProof = parseProofJson(postgresResult.stdout);
  const missingPostgresProofs = requiredPostgresProofs.filter(
    (key) => postgresProof.proof?.[key] !== "passed",
  );
  if (
    postgresProof.database_name !== UNIT06_DATABASE_NAME ||
    postgresProof.schema_revision !== expectedSchemaRevision ||
    missingPostgresProofs.length > 0
  ) {
    throw new Error(
      `UNIT-06 PostgreSQL proof is incomplete: ${missingPostgresProofs.join(", ")}`,
    );
  }

  await runCommand("unit06-e2e", "npm", [
    "run",
    "test:unit06:e2e",
    "--",
    "--trace=off",
  ]);
  await runCommand("unit06-visual", "npm", [
    "run",
    "test:unit06:visual",
    "--",
    "--trace=off",
  ]);

  await Promise.all(
    [
      "evidence/commands/index.json",
      "evidence/database/unit06-postgres-proof.json",
    ].map(requireEvidenceFile),
  );
  const visualMatrix = await validateVisualEvidence();
  const visualReceiptEvidence = visualMatrix.receipts.map(({ file }) =>
    repositoryPath(file),
  );
  const postgresEvidence = [
    repositoryPath("evidence/commands/real-postgres-unit06.txt"),
    repositoryPath("evidence/database/unit06-postgres-proof.json"),
  ];
  const journeyEvidence = [
    repositoryPath("evidence/commands/unit06-e2e.txt"),
    ...postgresEvidence,
  ];

  await writeEval("build.json", {
    evidence: [
      repositoryPath("evidence/commands/dependency-tree.txt"),
      repositoryPath("evidence/commands/build.txt"),
    ],
    gate: "build",
  });
  await writeEval("typecheck-lint.json", {
    evidence: [
      repositoryPath("evidence/commands/typecheck.txt"),
      repositoryPath("evidence/commands/lint.txt"),
    ],
    gate: "typecheck_lint",
  });
  await writeEval("tests.json", {
    evidence: [
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/unit06-e2e.txt"),
      repositoryPath("evidence/commands/unit06-visual.txt"),
    ],
    gate: "tests",
  });
  await writeEval("postgres-integration.json", {
    covered_checks: requiredPostgresProofs,
    evidence: postgresEvidence,
    gate: "postgres_integration",
  });
  await writeEval("buyer-library-e2e.json", {
    covered_checks: [
      "PaidSale creates one Buyer entitlement",
      "EPUB and MOBI use signed Buyer-only delivery",
      "active approved version supersedes the purchased version",
      "approved Refund revokes all file delivery",
    ],
    evidence: journeyEvidence,
    gate: "buyer_library_e2e",
  });
  await writeEval("review-moderation-e2e.json", {
    covered_checks: [
      "only a verified Buyer can submit",
      "review enters manual moderation",
      "Manager publication updates the public review projection",
    ],
    evidence: journeyEvidence,
    gate: "review_moderation_e2e",
  });
  await writeEval("refund-compensation.json", {
    covered_checks: [
      "Buyer requests a Refund",
      "Manager approves the Refund",
      "one append-only compensation and one RefundApproved event are recorded",
      "entitlement and future review eligibility are revoked",
    ],
    evidence: journeyEvidence,
    gate: "refund_compensation",
  });
  await writeEval("visual-responsive.json", {
    baseline_id: baselineId,
    evidence: [
      repositoryPath("evidence/commands/unit06-visual.txt"),
      repositoryPath("evidence/visual/unit06-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "visual_responsive",
    receipt_count: visualMatrix.receipts.length,
    screens: ["S-07", "S-08", "S-09", "S-20"],
    target_bundle_hash: targetBundleHash,
    viewports: [390, 768, 1280],
    visual_receipt_digest_sha256: visualReceiptDigest,
  });

  const initialEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson(
    "evidence/security/unit06-evidence-secret-scan.json",
    initialEvidenceScan,
  );
  await writeEval("evidence-hygiene.json", {
    evidence: [
      repositoryPath(
        "evidence/security/unit06-evidence-secret-scan.json",
      ),
    ],
    gate: "evidence_hygiene",
  });
  const finishedAt = new Date();
  await writeRunResult("passed", finishedAt);
  const finalEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit06-evidence-secret-scan.json", {
    ...finalEvidenceScan,
    file_set_includes_run_json: true,
    file_set_includes_scan_receipt: true,
    scan_phase: "post-run-json-final",
  });
  if ((await listFiles(runRoot)).length !== finalEvidenceScan.checked_files) {
    throw new Error(
      "UNIT-06 final evidence scan file count became stale while sealing",
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
    await writeJson("evidence/security/unit06-evidence-secret-scan.json", {
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
    await writeJson("evidence/security/unit06-evidence-secret-scan.json", {
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
} finally {
  await verificationDatabase.close();
}
