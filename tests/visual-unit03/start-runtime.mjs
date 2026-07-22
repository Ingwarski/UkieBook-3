import { spawn } from "node:child_process";

const port = process.argv[2];
if (!port || !/^\d+$/u.test(port)) throw new Error("A numeric port is required");

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown"}`));
    });
  });
}

await run("npx", ["tsx", "scripts/seed-unit03-e2e.ts"], {
  ...process.env,
  APP_ENV: "test",
  UNIT03_ALLOW_FIXTURE_SEED: "1",
});

const runtime = spawn(process.execPath, ["scripts/start-unit03-test-runtime.mjs", port], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
let runtimeExited = false;
let forceKillTimer;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (!runtimeExited) {
    runtime.kill(signal);
    forceKillTimer = setTimeout(() => {
      if (!runtimeExited) runtime.kill("SIGKILL");
    }, 5_000);
    forceKillTimer.unref();
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}

const outcome = await new Promise((resolve) => {
  runtime.once("error", (error) => resolve({ error }));
  runtime.once("exit", (code, signal) => resolve({ code, signal }));
});
runtimeExited = true;
if (forceKillTimer) clearTimeout(forceKillTimer);

if ("error" in outcome) {
  console.error(outcome.error);
  process.exitCode = 1;
} else if (!stopping) {
  console.error(
    `UNIT-03 visual runtime exited unexpectedly (${outcome.code ?? outcome.signal ?? "unknown"})`,
  );
  process.exitCode = outcome.code && outcome.code !== 0 ? outcome.code : 1;
}
