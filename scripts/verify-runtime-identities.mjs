import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const executables = [
  ["worker", "dist/runtime/worker.js"],
  ["scheduler", "dist/runtime/scheduler.js"],
  ["db-migrate", "dist/runtime/db-migrate.js"],
];
const identities = [];

for (const [role, executable] of executables) {
  const { stdout } = await execFileAsync(process.execPath, [executable, "--check"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_REVISION: process.env.APP_REVISION ?? "development",
    },
  });
  const identity = JSON.parse(stdout.trim());
  if (identity.role !== role) {
    throw new Error(`${executable} reported role ${identity.role}; expected ${role}`);
  }
  identities.push(identity);
}

const appRevisions = new Set(identities.map((identity) => identity.appRevision));
const schemaRevisions = new Set(
  identities.map((identity) => identity.schemaRevision),
);
if (appRevisions.size !== 1 || schemaRevisions.size !== 1) {
  throw new Error("Worker, scheduler, and migration runtimes do not share one identity");
}

const result = {
  identities,
  shared_app_revision: identities[0].appRevision,
  shared_schema_revision: identities[0].schemaRevision,
  status: "passed",
  verified_at: new Date().toISOString(),
};

if (process.env.UNIT_EVIDENCE_DIR) {
  const target = path.join(
    path.resolve(process.env.UNIT_EVIDENCE_DIR),
    "evidence/architecture/process-runtime-identities.json",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

console.log(
  `Runtime identities passed for ${identities.map(({ role }) => role).join(", ")}.`,
);
