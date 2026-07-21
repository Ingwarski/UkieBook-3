import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const child = spawn(
  process.execPath,
  ["scripts/verify-source-boundaries.mjs", "--negative-fixture"],
  {
    cwd: process.cwd(),
    env: { ...process.env, UNIT_EVIDENCE_DIR: "" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});

const detected =
  exitCode !== 0 && stderr.includes("transitive-client-secret-boundary");
const result = {
  detected,
  expected_exit: "non-zero",
  fixture: [
    "tests/fixtures/client-boundary/client.fixture",
    "tests/fixtures/client-boundary/reexport.fixture",
  ],
  rule: "transitive-client-secret-boundary",
  status: detected ? "passed" : "failed",
  tool_exit_code: exitCode,
  verified_at: new Date().toISOString(),
};

if (process.env.UNIT_EVIDENCE_DIR) {
  const target = path.join(
    path.resolve(process.env.UNIT_EVIDENCE_DIR),
    "evidence/security/negative-client-import.json",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

if (!detected) {
  console.error("Negative client-boundary fixture was not rejected.");
  console.error(stdout);
  console.error(stderr);
  process.exitCode = 1;
} else {
  console.log("Negative transitive client import was rejected as expected.");
}
