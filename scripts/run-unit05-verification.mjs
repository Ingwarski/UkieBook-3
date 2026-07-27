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

import { UNIT05_DATABASE_NAME } from "./unit05-database-guard.ts";
import { openUnit05Database } from "./unit05-embedded-postgres.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const unitId = "UNIT-05";
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const targetBundleHash =
  "e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724";
const expectedSchemaRevision = "0006_commerce_checkout";
const expectedReceiptCount = 30;
const expectedAccessibilityChecks = [
  "s04-keyboard-order-focus-activation",
  "s04-remove-item-focus-status",
  "s04-reflow-200",
  "s05-transition-status-announcement",
  "s06-status-announcement",
  "s06-success-keyboard-activation",
  "s06-failure-keyboard-activation",
  "s06-reflow-200",
];
const requiredCoreStates = [
  "s04:empty",
  "s04:auth-required",
  "s04:error",
  "s04:populated",
  "s05:redirecting",
  "s06:pending",
  "s06:failure",
  "s06:success",
];
const requiredPostgresProofs = [
  "card_data_non_persistence",
  "cart_merge_deduplication",
  "cart_persistence",
  "duplicate_checkout_reuses_session",
  "email_failure_independence",
  "equal_timestamp_reconciliation_recovery",
  "financial_snapshot_serialization",
  "migration_roundtrip",
  "missing_modified_date_reconciliation",
  "missing_webhook_reconciliation",
  "multi_book_single_invoice",
  "notification_isolation",
  "order_price_snapshot",
  "order_snapshot_sealed_after_payment_session",
  "paid_sale_append_only",
  "paid_sale_atomicity",
  "paid_sale_rollback_recovery",
  "provider_payload_binding",
  "provider_response_invoice_binding",
  "payment_session_item_sum_guard",
  "purchase_email_capture",
  "raw_cart_token_non_persistence",
  "reconciliation_horizon_continuity",
  "reconciliation_outage_continuity",
  "unpaid_cancelled_no_paid_sale",
  "webhook_idempotency",
  "webhook_out_of_order_guard",
  "webhook_signature_verification",
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
    "UNIT-05 verification must start from a clean implementation commit",
  );
}

const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
if (
  manifest.approved_baseline_id !== baselineId ||
  manifest.active_baseline?.baseline_id !== baselineId ||
  manifest.active_baseline?.visual_target_hash !== targetBundleHash
) {
  throw new Error(
    "UNIT-05 verifier baseline binding does not match forge/sdd-manifest.json",
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

const verificationDatabase = await openUnit05Database();
const databaseUrl = verificationDatabase.url;
const parsedDatabaseUrl = new URL(databaseUrl);
const authSecret = randomBytes(32).toString("base64url");
const merchantToken = randomBytes(32).toString("base64url");
const monoControlToken = randomBytes(32).toString("base64url");
const googleClientSecret = randomBytes(32).toString("base64url");
const facebookClientSecret = randomBytes(32).toString("base64url");
const privacySentinel = `unit05-privacy-${randomBytes(24).toString("hex")}`;
const privateObjectRoot = path.resolve(".data/unit05-evidence-private");
const publicAssetRoot = path.resolve(".data/unit05-evidence-public");
const emailCaptureRoot = path.resolve(".data/unit05-evidence-email");
const monoStateRoot = path.resolve(".data/unit05-evidence-mono");
const sharedEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_ORIGIN: "https://unit05.invalid",
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  CI: "1",
  DATABASE_URL: databaseUrl,
  EMAIL_FROM: "purchases@ukiebook.invalid",
  FACEBOOK_OAUTH_CLIENT_ID: "unit05-facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: facebookClientSecret,
  GOOGLE_OAUTH_CLIENT_ID: "unit05-google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: googleClientSecret,
  IMPLEMENTATION_REVISION: implementationRevision,
  MONO_API_ORIGIN: "https://api.monobank.ua",
  MONO_MERCHANT_TOKEN: merchantToken,
  PAYMENT_RECONCILIATION_INTERVAL_MS: "1000",
  PAYMENT_SESSION_VALIDITY_SECONDS: "3600",
  PAYMENT_WEBHOOK_MAX_BYTES: "65536",
  PLAYWRIGHT_HTML_OPEN: "never",
  PRIVATE_OBJECT_ROOT: privateObjectRoot,
  PUBLIC_CATALOG_ASSET_ROOT: publicAssetRoot,
  UNIT00_SECRET_SENTINEL: authSecret,
  UNIT01_PRIVACY_SENTINEL: privacySentinel,
  UNIT05_ALLOW_FIXTURE_SEED: "1",
  UNIT05_DATABASE_URL: databaseUrl,
  UNIT05_EMAIL_CAPTURE_ROOT: emailCaptureRoot,
  UNIT05_IMPLEMENTATION_REVISION: implementationRevision,
  UNIT05_MONO_CONTROL_TOKEN: monoControlToken,
  UNIT05_MONO_STATE_ROOT: monoStateRoot,
  UNIT05_PRIVATE_OBJECT_ROOT: privateObjectRoot,
  UNIT05_PRIVACY_SENTINEL: privacySentinel,
  UNIT05_PUBLIC_ASSET_ROOT: publicAssetRoot,
  UNIT_EVIDENCE_DIR: runRoot,
  UNIT_ID: unitId,
  WORKER_ID: "unit05-verifier-worker",
};
const sensitiveCandidates = [
  { category: "unit05-database-url", value: databaseUrl },
  {
    category: "unit05-database-password",
    value: decodeURIComponent(parsedDatabaseUrl.password),
  },
  {
    category: "unit05-database-password-encoded",
    value: parsedDatabaseUrl.password,
  },
  { category: "auth-secret", value: authSecret },
  { category: "mono-merchant-token", value: merchantToken },
  { category: "mono-control-token", value: monoControlToken },
  { category: "google-client-secret", value: googleClientSecret },
  { category: "facebook-client-secret", value: facebookClientSecret },
  { category: "privacy-sentinel", value: privacySentinel },
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
    owner: "Codex / commerce and purchase notification",
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
      database_name: UNIT05_DATABASE_NAME,
      engine: "PostgreSQL",
      host_class: verificationDatabase.embedded
        ? "loopback-embedded-dedicated"
        : "loopback-explicit-dedicated",
      schema_revision: expectedSchemaRevision,
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
  throw new Error("UNIT-05 PostgreSQL proof did not emit a passed JSON receipt");
}

async function captureSanitizedPurchaseEmailEvidence() {
  await mkdir(emailCaptureRoot, { recursive: true });
  const files = (await readdir(emailCaptureRoot)).filter((file) =>
    file.endsWith(".json"),
  );
  const messages = [];
  for (const file of files) {
    const envelope = JSON.parse(
      await readFile(path.join(emailCaptureRoot, file), "utf8"),
    );
    const message = envelope?.message;
    if (
      typeof message?.subject !== "string" ||
      typeof message?.text !== "string"
    ) {
      continue;
    }
    messages.push({
      contains_library_link: /\/library/u.test(message.text),
      purchase_title_count: message.text
        .split("\n")
        .filter((line) => line.trimStart().startsWith("• ")).length,
      subject: message.subject,
    });
  }
  const purchaseMessage = messages.find(
    ({ contains_library_link, purchase_title_count: count, subject }) =>
      contains_library_link &&
      count === 2 &&
      subject === "Ваші книжки вже в бібліотеці · UkieBook",
  );
  if (!purchaseMessage) {
    throw new Error("UNIT-05 E-01 sanitized purchase-email proof is missing");
  }
  await writeJson("evidence/notifications/unit05-purchase-email.json", {
    captured_message_count: messages.length,
    direct_recipient_omitted: true,
    message: purchaseMessage,
    status: "passed",
    verified_at: new Date().toISOString(),
  });
}

async function validateVisualEvidence() {
  const matrixPath = "evidence/visual/unit05-responsive-matrix.json";
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
    JSON.stringify(
      [...(matrix.expected_accessibility_check_ids ?? [])].sort(),
    ) !== JSON.stringify([...expectedAccessibilityChecks].sort()) ||
    matrix.accessibility_receipts?.length !==
      expectedAccessibilityChecks.length ||
    matrix.console_errors?.length !== 0 ||
    matrix.page_errors?.length !== 0
  ) {
    throw new Error("UNIT-05 visual matrix is incomplete or not revision-bound");
  }

  const completedAccessibilityChecks = matrix.accessibility_receipts
    .map(({ check_id: checkId }) => checkId)
    .sort();
  if (
    JSON.stringify(completedAccessibilityChecks) !==
      JSON.stringify([...expectedAccessibilityChecks].sort()) ||
    matrix.accessibility_receipts.some(
      ({ baseline_id: receiptBaseline, implementation_revision: revision, status }) =>
        receiptBaseline !== baselineId ||
        revision !== implementationRevision ||
        status !== "passed",
    )
  ) {
    throw new Error(
      "UNIT-05 accessibility receipts are incomplete or not revision-bound",
    );
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
        "UNIT-05 visual matrix contains an invalid or duplicate receipt",
      );
    }
    receiptFiles.add(receipt.file);
    await requireEvidenceFile(receipt.file);
    if (
      receipt.sha256 !==
      (await sha256File(path.join(runRoot, receipt.file)))
    ) {
      throw new Error(`UNIT-05 visual receipt hash mismatch: ${receipt.file}`);
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
      accessibility.formControls.some(({ labelCount }) => labelCount < 1) ||
      accessibility.mobileInputs.some(
        ({ fontSize }) => !Number.isFinite(fontSize) || fontSize < 16,
      ) ||
      accessibility.alerts.some(
        ({ text }) => typeof text !== "string" || !text.trim(),
      ) ||
      receipt.layout?.scrollWidth > receipt.layout?.clientWidth + 1 ||
      receipt.viewport?.device_scale_factor !== 2 ||
      !Array.isArray(receipt.touch_targets) ||
      receipt.touch_targets.some(
        ({ height, width }) =>
          !Number.isFinite(height) ||
          !Number.isFinite(width) ||
          Math.min(height, width) < 44,
      )
    ) {
      throw new Error(
        `UNIT-05 accessibility/layout evidence failed: ${receipt.file}`,
      );
    }
  }

  const capturedStates = new Set(
    matrix.receipts.map(({ screen, state }) => `${screen}:${state}`),
  );
  const missingStates = requiredCoreStates.filter(
    (state) => !capturedStates.has(state),
  );
  const widths = [
    ...new Set(matrix.receipts.map(({ viewport }) => viewport?.width)),
  ].sort((left, right) => left - right);
  if (
    missingStates.length > 0 ||
    JSON.stringify(widths) !== JSON.stringify([390, 430, 768, 1280, 1440])
  ) {
    throw new Error(
      `UNIT-05 visual matrix coverage is incomplete: ${missingStates.join(", ")}`,
    );
  }
  for (const state of requiredCoreStates) {
    const [screen, name] = state.split(":");
    const stateWidths = matrix.receipts
      .filter(
        ({ screen: value, state: valueState }) =>
          value === screen && valueState === name,
      )
      .map(({ viewport }) => viewport.width);
    for (const requiredWidth of [390, 768, 1280]) {
      if (!stateWidths.includes(requiredWidth)) {
        throw new Error(
          `UNIT-05 core visual state ${state} omits ${requiredWidth}px`,
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
    throw new Error("Repository revision or tree changed during UNIT-05 verification");
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
      `Repository changed during UNIT-05 verification: ${[
        ...new Set(unexpected),
      ].join(", ")}`,
    );
  }
}

function minimum(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

const advisoryFindings = [
  {
    activation_effect: "production-provider-activation-blocking",
    release_effect: "advisory",
    severity: "P3",
    summary:
      "Live mono acquiring checkout and wallet-method smoke is deferred to a credentialed sandbox or pre-production environment; the production adapter is exercised locally against a signed protocol simulator.",
  },
];

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
  await runCommand("dependency-audit", "npm", [
    "audit",
    "--audit-level=high",
  ]);
  await runCommand("typecheck", "npm", ["run", "typecheck"]);
  await runCommand("lint", "npm", ["run", "lint"]);
  await runCommand("unit-tests", "npm", ["test"]);
  await runCommand("repository-hygiene", "npm", [
    "run",
    "verify:repository",
  ]);
  await runCommand("build", "npm", ["run", "build"]);

  const postgresResult = await runCommand("real-postgres-unit05", "npm", [
    "run",
    "verify:unit05:postgres",
  ]);
  const postgresProof = parseProofJson(postgresResult.stdout);
  const missingPostgresProofs = requiredPostgresProofs.filter(
    (key) => postgresProof[key] !== "passed",
  );
  if (
    postgresProof.schema_revision !== expectedSchemaRevision ||
    missingPostgresProofs.length > 0
  ) {
    throw new Error(
      `UNIT-05 PostgreSQL proof is incomplete: ${missingPostgresProofs.join(", ")}`,
    );
  }
  await writeJson("evidence/database/unit05-postgres-proof.json", {
    baseline_id: baselineId,
    database_name: UNIT05_DATABASE_NAME,
    implementation_revision: implementationRevision,
    proof: postgresProof,
    schema_revision: expectedSchemaRevision,
    status: "passed",
    target_bundle_hash: targetBundleHash,
    verified_at: new Date().toISOString(),
  });
  await writeJson("evidence/commerce/mono-contract.json", {
    checks: {
      exact_raw_body_signature: postgresProof.webhook_signature_verification,
      idempotent_delivery: postgresProof.webhook_idempotency,
      missed_webhook_reconciliation:
        postgresProof.missing_webhook_reconciliation,
      out_of_order_guard: postgresProof.webhook_out_of_order_guard,
      provider_payload_binding: postgresProof.provider_payload_binding,
      provider_response_invoice_binding:
        postgresProof.provider_response_invoice_binding,
      reconciliation_horizon_continuity:
        postgresProof.reconciliation_horizon_continuity,
      reconciliation_outage_continuity:
        postgresProof.reconciliation_outage_continuity,
    },
    implementation_revision: implementationRevision,
    official_sources: {
      create_invoice:
        "https://monobank.ua/api-docs/acquiring/methods/ia/post--api--merchant--invoice--create",
      get_invoice_status:
        "https://monobank.ua/api-docs/acquiring/methods/ia/get--api--merchant--invoice--status",
      get_webhook_public_key:
        "https://monobank.ua/en/api-docs/acquiring/dev/webhooks/get--api--merchant--pubkey",
      testing:
        "https://monobank.ua/api-docs/acquiring/dev/test/docs--testing",
      verify_webhook:
        "https://monobank.ua/api-docs/acquiring/dev/webhooks/verify",
    },
    provider_surface:
      "mono acquiring create-invoice, invoice-status, public-key and signed webhook protocol",
    status: "passed",
    verified_against_official_sources_at: "2026-07-27",
    verified_at: new Date().toISOString(),
  });

  const resetEnvironment = {
    APP_ENV: "test",
    UNIT05_ALLOW_TEST_RESET: "1",
  };
  await runCommand(
    "reset-before-unit05-e2e",
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/reset-unit05-test-state.ts",
    ],
    resetEnvironment,
  );
  await runCommand("unit05-e2e", "npm", [
    "run",
    "test:unit05:e2e",
    "--",
    "--trace=off",
  ]);
  await captureSanitizedPurchaseEmailEvidence();
  await runCommand(
    "reset-before-unit05-visual",
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/reset-unit05-test-state.ts",
    ],
    resetEnvironment,
  );
  await runCommand("unit05-visual", "npm", [
    "run",
    "test:unit05:visual",
    "--",
    "--trace=off",
  ]);

  await Promise.all(
    [
      "evidence/architecture/boundary-review.json",
      "evidence/architecture/process-runtime-identities.json",
      "evidence/commands/index.json",
      "evidence/commerce/mono-contract.json",
      "evidence/database/unit05-postgres-proof.json",
      "evidence/notifications/unit05-purchase-email.json",
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
      "Worker, scheduler, and migration runtimes are not UNIT-05 revision-bound",
    );
  }
  const standaloneServer = ".next/standalone/server.js";
  await stat(path.resolve(standaloneServer));
  await writeJson("evidence/architecture/web-runtime-identity.json", {
    app_revision: implementationRevision,
    executable: standaloneServer,
    executable_sha256: await sha256File(standaloneServer),
    schema_revision: expectedSchemaRevision,
    status: "passed",
    verified_at: new Date().toISOString(),
  });
  await writeJson("evidence/architecture/runtime-revisions.json", {
    process_identities: processIdentity.identities.map(
      ({ appRevision, role, schemaRevision }) => ({
        app_revision: appRevision,
        role,
        schema_revision: schemaRevision,
      }),
    ),
    status: "passed",
    web: {
      app_revision: implementationRevision,
      schema_revision: expectedSchemaRevision,
    },
  });
  await writeJson("evidence/security/access-separation.json", {
    checks: [
      "guest Cart is isolated by an opaque hashed cookie token",
      "authenticated checkout requires the owning Buyer session",
      "checkout result and payment redirect are ownership-checked",
      "forged mono webhook signatures are rejected",
      "card data and raw Cart tokens are never persisted",
    ],
    evidence: [
      repositoryPath("evidence/database/unit05-postgres-proof.json"),
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    status: "passed",
    verified_at: new Date().toISOString(),
  });
  await writeJson("evidence/commerce/live-mono-provider-smoke.json", {
    activation_effect: "production-provider-activation-blocking",
    local_protocol_evidence: [
      repositoryPath("evidence/commerce/mono-contract.json"),
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    provider: {
      reason:
        "Credentialed mono sandbox or pre-production merchant access is not available to this local run.",
      status: "deferred",
    },
    scope:
      "Live checkout, registered webhook and Apple Pay/Google Pay presentation only; exact production adapter code is covered by the signed local HTTP protocol and browser flow.",
    status: "blocked",
    verified_at: new Date().toISOString(),
  });

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
  const mobileInputs = accessibilitySamples.flatMap(
    ({ mobileInputs: samples }) => samples,
  );
  const maximumHorizontalOverflow = Math.max(
    ...visualMatrix.receipts.map(
      ({ layout }) => layout.scrollWidth - layout.clientWidth,
    ),
  );
  const minimumTouchTargetHeight = minimum(
    touchTargets.map(({ height }) => height),
  );
  const minimumTouchTargetWidth = minimum(
    touchTargets.map(({ width }) => width),
  );
  const minimumTextContrast = minimum(textContrast.map(({ ratio }) => ratio));
  const minimumControlContrast = minimum(
    controlContrast.map(({ ratio }) => ratio),
  );
  const minimumPlaceholderContrast = minimum(
    placeholderContrast.map(({ ratio }) => ratio),
  );
  const minimumMobileInputFont = minimum(
    mobileInputs.map(({ fontSize }) => fontSize),
  );
  if (
    touchTargets.length === 0 ||
    !Number.isFinite(maximumHorizontalOverflow) ||
    minimumTouchTargetHeight === null ||
    minimumTouchTargetWidth === null ||
    minimumTextContrast === null
  ) {
    throw new Error("UNIT-05 accessibility evidence summary is incomplete");
  }

  const commonTestEvidence = [
    repositoryPath("evidence/commands/unit-tests.txt"),
    repositoryPath("evidence/commands/unit05-e2e.txt"),
    repositoryPath("evidence/commands/unit05-visual.txt"),
  ];
  const postgresEvidence = [
    repositoryPath("evidence/commands/real-postgres-unit05.txt"),
    repositoryPath("evidence/database/unit05-postgres-proof.json"),
  ];
  await writeEval("build.json", {
    evidence: [
      repositoryPath("evidence/commands/dependency-tree.txt"),
      repositoryPath("evidence/commands/dependency-audit.txt"),
      repositoryPath("evidence/commands/build.txt"),
      repositoryPath("evidence/architecture/process-runtime-identities.json"),
      repositoryPath("evidence/architecture/web-runtime-identity.json"),
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
  await writeEval("webhook-idempotency.json", {
    covered_checks: [
      "signed exact raw body",
      "duplicate delivery produces one paid order and one PaidSale",
      "stale and out-of-order observations cannot regress payment state",
    ],
    evidence: [
      ...postgresEvidence,
      repositoryPath("evidence/commerce/mono-contract.json"),
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    gate: "webhook_idempotency",
  });
  await writeEval("paid-sale-only.json", {
    covered_checks: [
      "PaidSale is transactional and append-only",
      "injected PaidSale outbox failure rolls back observation, order, sale, notification and outbox before a clean retry",
      "unpaid or cancelled orders produce no PaidSale",
      "one provider session produces one paid order and event",
    ],
    evidence: [...postgresEvidence, repositoryPath("evidence/commands/unit05-e2e.txt")],
    gate: "paid_sale_only",
  });
  await writeEval("mono-contract-reconciliation.json", {
    covered_checks: [
      "signed webhook and provider-status observations converge",
      "missing provider modifiedDate remains audit-only on webhook and is promoted by an authoritative status read",
      "equal provider timestamps remain webhook-audit-only until authoritative reconciliation promotion",
      "misrouted invoice-status responses cannot advance another payment session",
      "provider outage leaves a durable successor",
      "reconciliation continues beyond the provider-expiry horizon",
      "terminal recovery resolves the overdue issue without duplicate PaidSale",
    ],
    evidence: [
      ...postgresEvidence,
      repositoryPath("evidence/commerce/mono-contract.json"),
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    gate: "mono_contract_reconciliation",
  });
  await writeEval("access-separation.json", {
    evidence: [
      repositoryPath("evidence/security/access-separation.json"),
      ...postgresEvidence,
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    gate: "access_separation",
  });
  await writeEval("purchase-notification.json", {
    covered_checks: [
      "E-01 contains the purchased titles and Library link",
      "notification failure cannot roll back PaidSale",
      "notification delivery is isolated and idempotent",
    ],
    evidence: [
      ...postgresEvidence,
      repositoryPath("evidence/notifications/unit05-purchase-email.json"),
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    gate: "purchase_notification",
  });
  await writeEval("journey-buyer-e2e.json", {
    covered_checks: [
      "guest multi-book Cart persists and merges at OAuth return",
      "one signed checkout creates one provider invoice",
      "success reaches S-06 and failure preserves Cart",
      "missing webhook reaches the same result through reconciliation",
      "E-01 is captured after paid confirmation",
    ],
    evidence: [
      repositoryPath("evidence/commands/unit05-e2e.txt"),
      ...postgresEvidence,
      repositoryPath("evidence/notifications/unit05-purchase-email.json"),
    ],
    gate: "journey_buyer_e2e",
    scope_limit:
      "The journey reaches the UNIT-06 Library handoff; entitlement delivery remains UNIT-06-owned.",
  });
  await writeEval("screen-states.json", {
    captured_states: capturedStates,
    evidence: [
      repositoryPath("evidence/commands/unit05-visual.txt"),
      repositoryPath("evidence/visual/unit05-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    expected_receipts: expectedReceiptCount,
    gate: "screen_states",
    receipt_count: visualMatrix.receipts.length,
    screens: ["S-04", "S-05 transition", "S-06"],
  });
  await writeEval("accessibility.json", {
    accessibility_checks: expectedAccessibilityChecks,
    evidence: [
      repositoryPath("evidence/commands/unit05-visual.txt"),
      repositoryPath("evidence/visual/unit05-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "accessibility",
    maximum_horizontal_overflow_css_px: maximumHorizontalOverflow,
    minimum_computed_control_contrast: minimumControlContrast,
    minimum_computed_placeholder_contrast: minimumPlaceholderContrast,
    minimum_computed_text_contrast: minimumTextContrast,
    minimum_mobile_input_font_css_px: minimumMobileInputFont,
    minimum_touch_target_height_css_px: minimumTouchTargetHeight,
    minimum_touch_target_width_css_px: minimumTouchTargetWidth,
    not_claimed:
      "A complete WCAG conformance audit or release-wide AT/browser coverage",
  });
  await writeEval("responsive-layout.json", {
    evidence: [
      repositoryPath("evidence/commands/unit05-visual.txt"),
      repositoryPath("evidence/visual/unit05-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "responsive_layout",
    maximum_horizontal_overflow_css_px: maximumHorizontalOverflow,
    receipt_count: visualMatrix.receipts.length,
    viewports: capturedViewports,
  });
  await writeEval("approved-visual-baseline-fidelity.json", {
    baseline_id: baselineId,
    comparison_mode:
      "Aurora V3 public commerce extension; provider-owned payment entry is not pixel-controlled",
    evidence: [
      repositoryPath("evidence/commands/unit05-visual.txt"),
      repositoryPath("evidence/visual/unit05-responsive-matrix.json"),
      ...visualReceiptEvidence,
    ],
    gate: "approved_visual_baseline_fidelity",
    screens: ["S-04", "S-05 transition", "S-06"],
    target_bundle_hash: targetBundleHash,
    viewports: capturedViewports,
    visual_receipt_digest_sha256: visualReceiptDigest,
  });
  await writeEval("live-mono-provider-smoke.json", {
    deferred: true,
    evidence: [
      repositoryPath("evidence/commerce/live-mono-provider-smoke.json"),
      repositoryPath("evidence/commerce/mono-contract.json"),
      repositoryPath("evidence/commands/unit05-e2e.txt"),
    ],
    findings: advisoryFindings,
    gate: "live_mono_provider_smoke",
    status: "blocked",
  });

  const initialEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson(
    "evidence/security/unit05-evidence-secret-scan.json",
    initialEvidenceScan,
  );
  const finishedAt = new Date();
  await writeRunResult("passed", finishedAt, advisoryFindings);
  const finalEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson("evidence/security/unit05-evidence-secret-scan.json", {
    ...finalEvidenceScan,
    file_set_includes_run_json: true,
    file_set_includes_scan_receipt: true,
    scan_phase: "post-run-json-final",
  });
  if ((await listFiles(runRoot)).length !== finalEvidenceScan.checked_files) {
    throw new Error(
      "UNIT-05 final evidence scan file count became stale while sealing",
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
    await writeJson("evidence/security/unit05-evidence-secret-scan.json", {
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
    await writeJson("evidence/security/unit05-evidence-secret-scan.json", {
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
