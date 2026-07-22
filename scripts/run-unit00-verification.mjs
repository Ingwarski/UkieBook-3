import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const expectedDatabaseName = "ukiebook_unit00";
const realDatabaseUrl = process.env.REAL_DATABASE_URL;
if (!realDatabaseUrl) {
  throw new Error(
    "REAL_DATABASE_URL is required; UNIT-00 cannot pass on an emulated database",
  );
}

function requireDedicatedDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("REAL_DATABASE_URL must be a valid PostgreSQL URL");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(parsed.hostname) ||
    databaseName !== expectedDatabaseName ||
    !parsed.username ||
    !parsed.password
  ) {
    throw new Error(
      `REAL_DATABASE_URL must use dedicated credentials without overrides for the exact loopback database ${expectedDatabaseName}`,
    );
  }
}

requireDedicatedDatabase(realDatabaseUrl);

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
    "UNIT-00 verification must start from a clean implementation commit",
  );
}

const startedAt = new Date();
const runId = `${startedAt
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z")}-${implementationRevision.slice(0, 12)}`;
const runRoot = path.resolve("forge", "runs", "UNIT-00", runId);
const commandDirectory = path.join(runRoot, "evidence", "commands");
const evalDirectory = path.join(runRoot, "evals");
await mkdir(commandDirectory, { recursive: true });
await mkdir(evalDirectory, { recursive: true });

const secretSentinel = `unit00-${randomBytes(18).toString("hex")}`;
const sharedEnvironment = {
  ...process.env,
  APP_REVISION: implementationRevision,
  DATABASE_URL: `postgres://unit00:${secretSentinel}@127.0.0.1:1/never_connect`,
  IMPLEMENTATION_REVISION: implementationRevision,
  UNIT00_SECRET_SENTINEL: secretSentinel,
  UNIT_EVIDENCE_DIR: runRoot,
};
const commandResults = [];

async function runCommand(name, executable, arguments_, extraEnvironment = {}) {
  const started = new Date();
  const child = spawn(executable, arguments_, {
    cwd: repositoryRoot,
    env: { ...sharedEnvironment, ...extraEnvironment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const finished = new Date();
  const receipt = [
    `name: ${name}`,
    `command: ${executable} ${arguments_.join(" ")}`,
    `implementation_revision: ${implementationRevision}`,
    `started_at: ${started.toISOString()}`,
    `finished_at: ${finished.toISOString()}`,
    `exit_code: ${exitCode}`,
    "",
    "[stdout]",
    stdout,
    "[stderr]",
    stderr,
  ].join("\n");
  const relativeReceipt = `evidence/commands/${name}.txt`;
  await writeFile(path.join(runRoot, relativeReceipt), receipt, "utf8");
  commandResults.push({
    command: `${executable} ${arguments_.join(" ")}`,
    exit_code: exitCode,
    finished_at: finished.toISOString(),
    name,
    receipt: relativeReceipt,
    started_at: started.toISOString(),
  });
  if (exitCode !== 0) {
    await writeRunResult("failed", finished, [
      {
        release_effect: "blocking",
        severity: "P1",
        summary: `${name} exited with code ${exitCode}`,
      },
    ]);
    throw new Error(`${name} failed with exit code ${exitCode}`);
  }
}

async function sha256File(relativePath) {
  const content = await readFile(path.resolve(relativePath));
  return createHash("sha256").update(content).digest("hex");
}

async function writeJson(relativePath, value) {
  const target = path.join(runRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    owner: "Codex / platform foundation",
    rerun_of: null,
    status: "passed",
    timestamp: new Date().toISOString(),
    unit: "UNIT-00",
  });
}

async function writeRunResult(status, finishedAt, findings = []) {
  const sourceFiles = [
    "docs/architecture.md",
    "docs/design-brief.md",
    "docs/dod-evals.md",
    "docs/guardrails.md",
    "docs/qa-checklist.md",
    "docs/development-plan.md",
    "forge/sdd-manifest.json",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [file, await sha256File(file)]),
    ),
  );
  await writeJson("run.json", {
    baseline_id: "AVB-UKIEBOOK-AURORA-7B-V2",
    commands: commandResults,
    finished_at: finishedAt.toISOString(),
    findings,
    implementation_revision: implementationRevision,
    prototype_reuse: "none",
    run_id: runId,
    source_hashes: sourceHashes,
    started_at: startedAt.toISOString(),
    status,
    target_bundle_hash:
      "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d",
    unit: "UNIT-00",
  });
}

console.log(`UNIT-00 implementation revision: ${implementationRevision}`);
console.log(`Evidence directory: ${path.relative(repositoryRoot, runRoot)}`);

await runCommand("dependency-tree", "npm", ["ls", "--depth=0"]);
await runCommand("dependency-audit", "npm", ["audit", "--audit-level=high"]);
await runCommand("typecheck", "npm", ["run", "typecheck"]);
await runCommand("lint", "npm", ["run", "lint"]);
await runCommand("unit-tests", "npm", ["test"]);
await runCommand("repository-hygiene", "npm", ["run", "verify:repository"]);
await runCommand("build", "npm", ["run", "build"]);
await runCommand(
  "real-postgres",
  "npx",
  ["--no-install", "tsx", "scripts/verify-real-postgres.ts"],
  { REAL_DATABASE_URL: realDatabaseUrl },
);
await runCommand("e2e", "npm", ["run", "test:e2e"]);
await runCommand("visual", "npm", ["run", "test:visual"]);

const requiredEvidence = [
  "evidence/architecture/boundary-review.json",
  "evidence/architecture/process-runtime-identities.json",
  "evidence/architecture/web-runtime-identity.json",
  "evidence/database/migration-roundtrip.json",
  "evidence/database/transaction-outbox-job.json",
  "evidence/security/browser-secret-boundary.json",
  "evidence/security/client-secret-boundary.json",
  "evidence/security/negative-client-import.json",
  "evidence/security/repository-secret-hygiene.json",
  "evidence/visual/vis-tokens.json",
  "evidence/visual/vis-tokens.png",
  "evidence/worker/idempotent-claim.json",
  "evidence/worker/lease-expiry-idempotency.json",
];
await Promise.all(
  requiredEvidence.map(async (relativePath) => {
    const metadata = await stat(path.join(runRoot, relativePath));
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error(`Required evidence is empty: ${relativePath}`);
    }
  }),
);

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

await writeEval("build.json", {
  evidence: [
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
    repositoryPath("evidence/security/browser-secret-boundary.json"),
  ],
  gate: "tests",
});
await writeEval("foundation-integration.json", {
  evidence: [
    repositoryPath("evidence/commands/real-postgres.txt"),
    repositoryPath("evidence/database/migration-roundtrip.json"),
    repositoryPath("evidence/database/transaction-outbox-job.json"),
    repositoryPath("evidence/worker/idempotent-claim.json"),
    repositoryPath("evidence/worker/lease-expiry-idempotency.json"),
  ],
  gate: "foundation-integration",
});
await writeEval("vis-tokens.json", {
  baseline_id: "AVB-UKIEBOOK-AURORA-7B-V2",
  evidence: [
    repositoryPath("evidence/commands/visual.txt"),
    repositoryPath("evidence/visual/vis-tokens.json"),
    repositoryPath("evidence/visual/vis-tokens.png"),
  ],
  gate: "vis-tokens",
});

const finishedAt = new Date();
await writeRunResult("passed", finishedAt);
console.log(
  `UNIT-00 verification passed; evidence: ${path.relative(repositoryRoot, runRoot)}`,
);
