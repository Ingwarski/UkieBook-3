import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const allowedEnvironmentFile = ".env.example";
const { stdout } = await execFileAsync("git", ["ls-files"], {
  cwd: process.cwd(),
});
const trackedFiles = stdout.split("\n").filter(Boolean);
const trackedEnvironmentFiles = trackedFiles.filter(
  (file) =>
    /(^|\/)\.env(?:\..+)?$/.test(file) && file !== allowedEnvironmentFile,
);
const sentinel = process.env.UNIT00_SECRET_SENTINEL;
const sentinelLeaks = [];

if (sentinel) {
  for (const file of trackedFiles) {
    const absolutePath = path.resolve(file);
    let contents;
    try {
      contents = await readFile(absolutePath);
    } catch {
      continue;
    }
    if (contents.includes(Buffer.from(sentinel))) {
      sentinelLeaks.push(file);
    }
  }
}

if (trackedEnvironmentFiles.length > 0 || sentinelLeaks.length > 0) {
  console.error("Repository secret hygiene verification failed:");
  for (const file of trackedEnvironmentFiles) {
    console.error(`- tracked environment file: ${file}`);
  }
  for (const file of sentinelLeaks) {
    console.error(`- sentinel found in tracked file: ${file}`);
  }
  process.exitCode = 1;
} else {
  if (process.env.UNIT_EVIDENCE_DIR) {
    const target = path.join(
      path.resolve(process.env.UNIT_EVIDENCE_DIR),
      "evidence/security/repository-secret-hygiene.json",
    );
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify(
        {
          allowed_environment_file: allowedEnvironmentFile,
          checked_tracked_files: trackedFiles.length,
          sentinel_leaks: sentinelLeaks,
          status: "passed",
          tracked_environment_files: trackedEnvironmentFiles,
          verified_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  console.log(
    `Repository hygiene passed across ${trackedFiles.length} tracked files; only ${allowedEnvironmentFile} is allowed.`,
  );
}
