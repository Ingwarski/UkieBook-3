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

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V2";
const targetBundleHash =
  "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d";
const expectedDatabaseName = "ukiebook_unit01";
const realDatabaseUrl = process.env.REAL_DATABASE_URL;

if (!realDatabaseUrl) {
  throw new Error(
    "REAL_DATABASE_URL is required; UNIT-01 cannot pass on an emulated database",
  );
}

function requireDedicatedDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("REAL_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("REAL_DATABASE_URL must use postgres: or postgresql:");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopbackHosts.has(parsed.hostname)) {
    throw new Error(
      "UNIT-01 destructive database proofs require a loopback PostgreSQL host",
    );
  }
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `UNIT-01 destructive database proofs require the exact dedicated database ${expectedDatabaseName}`,
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
const { stdout: revisionOutput } = await execFileAsync(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: repositoryRoot },
);
const implementationRevision = revisionOutput.trim();
const { stdout: statusOutput } = await execFileAsync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: repositoryRoot },
);
if (statusOutput.trim()) {
  throw new Error(
    "UNIT-01 verification must start from a clean implementation commit",
  );
}

const startedAt = new Date();
const runId = `${startedAt
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/u, "Z")}-${implementationRevision.slice(0, 12)}`;
const runRoot = path.resolve("forge", "runs", "UNIT-01", runId);
const commandDirectory = path.join(runRoot, "evidence", "commands");
const evalDirectory = path.join(runRoot, "evals");
await mkdir(commandDirectory, { recursive: true });
await mkdir(evalDirectory, { recursive: true });

// The legacy UNIT00 name is intentional: the shared foundation boundary checks
// consume that variable. Pointing it at the actual auth secret proves that the
// UNIT-01 secret does not enter the repository, browser responses, or client bundle.
const authSecret = randomBytes(32).toString("base64url");
const privacySentinel = `unit01-privacy-${randomBytes(24).toString("hex")}`;
const sharedEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_ORIGIN: "https://unit01.invalid",
  APP_REVISION: implementationRevision,
  AUTH_SECRET: authSecret,
  CI: "1",
  DATABASE_URL: `postgres://unit01:${authSecret}@127.0.0.1:1/never_connect`,
  FACEBOOK_OAUTH_CLIENT_ID: "unit01-build-facebook-client",
  FACEBOOK_OAUTH_CLIENT_SECRET: "unit01-build-facebook-secret",
  GOOGLE_OAUTH_CLIENT_ID: "unit01-build-google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "unit01-build-google-secret",
  IMPLEMENTATION_REVISION: implementationRevision,
  PLAYWRIGHT_HTML_OPEN: "never",
  UNIT00_SECRET_SENTINEL: authSecret,
  UNIT01_PRIVACY_SENTINEL: privacySentinel,
  UNIT01_PAYOUT_SENTINEL: privacySentinel,
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
  console.log(`\n[UNIT-01] ${name}`);
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
    unit: "UNIT-01",
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
    owner: "Codex / identity and author-profile",
    rerun_of: null,
    status: value.status ?? "passed",
    timestamp: new Date().toISOString(),
    unit: "UNIT-01",
  });
}

async function writeRunResult(status, finishedAt, findings = []) {
  const sourceFiles = [
    "docs/architecture.md",
    "docs/design-brief.md",
    "docs/dod-evals.md",
    "docs/guardrails.md",
    "docs/prd.md",
    "docs/qa-checklist.md",
    "docs/development-plan.md",
    "docs/screen-map.md",
    "docs/user-journey.md",
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
    unit: "UNIT-01",
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
    // A failed proof must not leave the generated secrets behind either.
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
    throw new Error(`UNIT-01 evidence hygiene failed: ${details}`);
  }
  return {
    checked_files: files.length,
    checked_secret_categories: [
      "auth-secret",
      "privacy-sentinel",
      "real-database-password",
      "real-database-password-encoded",
      "real-database-url",
    ],
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

function unit01VisualFiles() {
  const files = [];
  for (const width of [390, 430, 768, 1280, 1440]) {
    files.push(`evidence/visual/s03-default-${width}@2x.png`);
    files.push(`evidence/visual/s03-oauth-error-${width}@2x.png`);
    files.push(`evidence/visual/s17-default-${width}@2x.png`);
    files.push(`evidence/visual/s17-validation-error-${width}@2x.png`);
    files.push(`evidence/visual/s17-saved-${width}@2x.png`);
  }
  files.push("evidence/visual/s03-focus-1280@2x.png");
  return files;
}

const deferredProviderFinding = {
  activation_effect: "production-provider-activation-blocking",
  release_effect: "advisory",
  severity: "P3",
  summary:
    "Live Google/Facebook consent and registered-redirect smoke is deferred to a credentialed pre-production environment; production adapters are exercised locally against the loopback protocol simulator.",
};

console.log(`UNIT-01 implementation revision: ${implementationRevision}`);
console.log(`Evidence directory: ${path.relative(repositoryRoot, runRoot)}`);

try {
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
  await runCommand(
    "real-postgres-unit01",
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/verify-unit01-postgres.ts",
    ],
    {
      AUTH_SECRET: authSecret,
      REAL_DATABASE_URL: realDatabaseUrl,
      UNIT01_AUTH_SECRET: authSecret,
      UNIT01_PRIVACY_SENTINEL: privacySentinel,
      UNIT01_PAYOUT_SENTINEL: privacySentinel,
    },
  );
  await runCommand("e2e", "npm", [
    "run",
    "test:e2e",
    "--",
    "--trace=off",
  ]);
  await runCommand("visual", "npm", [
    "run",
    "test:visual",
    "--",
    "--trace=off",
  ]);
  const unit01BrowserEnvironment = {
    UNIT01_AUTH_SECRET: authSecret,
    UNIT01_DATABASE_URL: realDatabaseUrl,
    UNIT01_PRIVACY_SENTINEL: privacySentinel,
  };
  await runCommand(
    "unit01-e2e",
    "npm",
    ["run", "test:unit01:e2e", "--", "--trace=off"],
    unit01BrowserEnvironment,
  );
  await runCommand(
    "unit01-visual",
    "npm",
    ["run", "test:unit01:visual", "--", "--trace=off"],
    unit01BrowserEnvironment,
  );

  const expectedVisualFiles = unit01VisualFiles();
  const requiredEvidence = [
    "evidence/architecture/boundary-review.json",
    "evidence/architecture/process-runtime-identities.json",
    "evidence/architecture/web-runtime-identity.json",
    "evidence/commands/index.json",
    "evidence/database/unit01-migration-roundtrip.json",
    "evidence/identity/author-profile-role.json",
    "evidence/identity/oauth-session-concurrency.json",
    "evidence/security/access-separation.json",
    "evidence/security/browser-secret-boundary.json",
    "evidence/security/client-secret-boundary.json",
    "evidence/security/negative-client-import.json",
    "evidence/security/repository-secret-hygiene.json",
    "evidence/visual/unit01-responsive-matrix.json",
    "evidence/visual/vis-tokens.json",
    "evidence/visual/vis-tokens.png",
    ...expectedVisualFiles,
  ];
  await Promise.all(requiredEvidence.map(requireEvidenceFile));

  const visualMatrix = JSON.parse(
    await readFile(
      path.join(runRoot, "evidence/visual/unit01-responsive-matrix.json"),
      "utf8",
    ),
  );
  if (
    !Array.isArray(visualMatrix.receipts) ||
    visualMatrix.status !== "passed" ||
    visualMatrix.baseline_id !== baselineId ||
    visualMatrix.target_bundle_hash !== targetBundleHash
  ) {
    throw new Error("UNIT-01 visual matrix does not match the approved Baseline");
  }
  const capturedFiles = new Set(
    visualMatrix.receipts
      .map((receipt) => receipt.file)
      .filter((file) => typeof file === "string"),
  );
  for (const expectedFile of expectedVisualFiles) {
    if (!capturedFiles.has(expectedFile)) {
      throw new Error(`UNIT-01 visual matrix omits ${expectedFile}`);
    }
  }
  const zoomReceipt = visualMatrix.receipts.find(
    (receipt) => receipt.screen === "s03" && receipt.state === "zoom-200",
  );
  if (
    !zoomReceipt ||
    zoomReceipt.reflow.scrollWidth > zoomReceipt.reflow.clientWidth
  ) {
    throw new Error("UNIT-01 visual matrix omits the passing 200% reflow proof");
  }

  const processIdentity = JSON.parse(
    await readFile(
      path.join(
        runRoot,
        "evidence/architecture/process-runtime-identities.json",
      ),
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
  const sharedAppRevisions = new Set(
    allIdentities.map((identity) => identity.appRevision),
  );
  const sharedSchemaRevisions = new Set(
    allIdentities.map((identity) => identity.schemaRevision),
  );
  if (sharedAppRevisions.size !== 1 || sharedSchemaRevisions.size !== 1) {
    throw new Error("Web, worker, scheduler, and migration revisions differ");
  }
  await writeJson("evidence/architecture/runtime-revisions.json", {
    identities: allIdentities,
    shared_app_revision: allIdentities[0].appRevision,
    shared_schema_revision: allIdentities[0].schemaRevision,
    status: "passed",
    verified_at: new Date().toISOString(),
  });

  await writeJson("evidence/identity/live-provider-smoke.json", {
    activation_effect: "production-provider-activation-blocking",
    local_protocol_evidence: [
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/unit01-e2e.txt"),
    ],
    providers: {
      facebook: {
        reason:
          "Production app credentials, registered callback and a live test account are not available to this local run.",
        status: "deferred",
      },
      google: {
        reason:
          "Production app credentials, registered callback and a live test account are not available to this local run.",
        status: "deferred",
      },
    },
    scope:
      "Live consent and registered-redirect smoke only; exact production adapter code is covered by the local HTTP protocol and browser flows.",
    status: "blocked",
    verified_at: new Date().toISOString(),
  });

  await writeEval("build.json", {
    evidence: [
      repositoryPath("evidence/commands/dependency-tree.txt"),
      repositoryPath("evidence/commands/dependency-audit.txt"),
      repositoryPath("evidence/commands/build.txt"),
      repositoryPath("evidence/architecture/runtime-revisions.json"),
      repositoryPath("evidence/security/client-secret-boundary.json"),
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
      repositoryPath("evidence/commands/unit01-e2e.txt"),
      repositoryPath("evidence/commands/unit01-visual.txt"),
    ],
    gate: "tests",
  });
  await writeEval("identity-integration.json", {
    covered_checks: [
      "OAuth callback to persistent session",
      "one-time flow claim and concurrent provider mapping",
      "role-aware redirect and negative route matrix",
      "author profile save and session rotation",
      "additive migration rollback and reapply",
    ],
    evidence: [
      repositoryPath("evidence/commands/real-postgres-unit01.txt"),
      repositoryPath("evidence/commands/unit01-e2e.txt"),
      repositoryPath("evidence/database/unit01-migration-roundtrip.json"),
      repositoryPath("evidence/identity/oauth-session-concurrency.json"),
      repositoryPath("evidence/identity/author-profile-role.json"),
    ],
    gate: "identity_integration",
  });
  await writeEval("auth-security.json", {
    covered_checks: [
      "OAuth state, nonce and PKCE",
      "unsafe return-target rejection",
      "opaque hashed and revocable sessions",
      "server-side authorization matrix",
      "public profile and payout-data separation",
      "append-only identity audit",
      "repository, bundle, browser and evidence secret boundaries",
    ],
    evidence: [
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/unit01-e2e.txt"),
      repositoryPath("evidence/security/access-separation.json"),
      repositoryPath("evidence/security/browser-secret-boundary.json"),
      repositoryPath("evidence/security/client-secret-boundary.json"),
      repositoryPath("evidence/security/negative-client-import.json"),
      repositoryPath("evidence/security/repository-secret-hygiene.json"),
      repositoryPath("evidence/security/unit01-evidence-secret-scan.json"),
    ],
    gate: "auth_security",
  });
  await writeEval("approved-visual-baseline-fidelity.json", {
    baseline_id: baselineId,
    comparison_mode: "approved Aurora extension; S-01 pixel lock not touched",
    evidence: [
      repositoryPath("evidence/commands/visual.txt"),
      repositoryPath("evidence/commands/unit01-visual.txt"),
      repositoryPath("evidence/visual/vis-tokens.json"),
      repositoryPath("evidence/visual/vis-tokens.png"),
      repositoryPath("evidence/visual/unit01-responsive-matrix.json"),
      ...expectedVisualFiles.map(repositoryPath),
    ],
    gate: "approved_visual_baseline_fidelity",
    routes: ["/login", "/author/profile"],
    screens: ["S-03", "S-17"],
    states: [
      "default",
      "oauth-error",
      "focus",
      "zoom-200",
      "validation-error",
      "saved",
    ],
    target_bundle_hash: targetBundleHash,
    viewports: [390, 430, 768, 1280, 1440],
  });
  await writeEval("live-google-facebook-provider-smoke.json", {
    deferred: true,
    evidence: [
      repositoryPath("evidence/identity/live-provider-smoke.json"),
      repositoryPath("evidence/commands/unit-tests.txt"),
      repositoryPath("evidence/commands/unit01-e2e.txt"),
    ],
    findings: [deferredProviderFinding],
    gate: "live_google_facebook_provider_smoke",
    status: "blocked",
  });

  const initialEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson(
    "evidence/security/unit01-evidence-secret-scan.json",
    initialEvidenceScan,
  );
  const finishedAt = new Date();
  await writeRunResult("passed", finishedAt, [deferredProviderFinding]);
  const finalEvidenceScan = await inspectEvidenceForSecretsAndTraces();
  await writeJson(
    "evidence/security/unit01-evidence-secret-scan.json",
    finalEvidenceScan,
  );
  console.log(
    `UNIT-01 verification passed; evidence: ${path.relative(repositoryRoot, runRoot)}`,
  );
} catch (error) {
  const finishedAt = new Date();
  let summary = redactSensitiveValues(
    error instanceof Error ? error.message : String(error),
  );
  try {
    const failedRunScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit01-evidence-secret-scan.json", {
      ...failedRunScan,
      run_status: "failed",
    });
  } catch (hygieneError) {
    const hygieneSummary = redactSensitiveValues(
      hygieneError instanceof Error ? hygieneError.message : String(hygieneError),
    );
    summary = `${summary}; ${hygieneSummary}`;
    // inspectEvidenceForSecretsAndTraces scrubs raw markers and removes any
    // trace/HAR before throwing. Prove that remediation before persisting run.json.
    try {
      const remediatedScan = await inspectEvidenceForSecretsAndTraces();
      await writeJson("evidence/security/unit01-evidence-secret-scan.json", {
        ...remediatedScan,
        remediation_triggered: true,
        run_status: "failed",
      });
    } catch (remediationError) {
      summary = `${summary}; evidence remediation failed: ${redactSensitiveValues(
        remediationError instanceof Error
          ? remediationError.message
          : String(remediationError),
      )}`;
    }
  }
  try {
    await writeRunResult("failed", finishedAt, [
      {
        release_effect: "blocking",
        severity: "P1",
        summary,
      },
    ]);
    const finalFailedRunScan = await inspectEvidenceForSecretsAndTraces();
    await writeJson("evidence/security/unit01-evidence-secret-scan.json", {
      ...finalFailedRunScan,
      run_status: "failed",
    });
  } catch (writeError) {
    console.error(
      `Unable to persist failed UNIT-01 run: ${redactSensitiveValues(
        writeError instanceof Error ? writeError.message : String(writeError),
      )}`,
    );
  }
  throw new Error(summary);
}
