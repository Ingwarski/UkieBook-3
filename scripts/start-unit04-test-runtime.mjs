import { spawn } from "node:child_process";

const port = process.argv[2];
if (!port || !/^\d+$/u.test(port)) {
  throw new Error("A numeric port is required");
}

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
      else {
        reject(
          new Error(
            `${command} exited with ${code ?? signal ?? "unknown"}`,
          ),
        );
      }
    });
  });
}

await run(
  "npx",
  [
    "--no-install",
    "tsx",
    "--conditions=react-server",
    "scripts/seed-unit04-e2e.ts",
  ],
  {
    ...process.env,
    APP_ENV: "test",
    UNIT04_ALLOW_FIXTURE_SEED: "1",
  },
);

const children = [
  spawn(process.execPath, ["scripts/start-production-test-server.mjs", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["dist/runtime/worker.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_QUEUE: "publishing",
    },
    stdio: "inherit",
  }),
];

let stopping = false;
let failureCode = 0;
let forceStopTimer;
const closedChildren = new Set();
let finish;
const finished = new Promise((resolve) => {
  finish = resolve;
});

function finishWhenClosed(child) {
  closedChildren.add(child);
  if (closedChildren.size === children.length) {
    if (forceStopTimer) clearTimeout(forceStopTimer);
    finish();
  }
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  forceStopTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5_000);
  forceStopTimer.unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    failureCode = 1;
    stop();
  });
  child.once("close", (code, signal) => {
    if (!stopping) {
      console.error(
        `UNIT-04 child exited unexpectedly (${code ?? signal ?? "unknown"})`,
      );
      failureCode = typeof code === "number" && code > 0 ? code : 1;
      stop();
    }
    finishWhenClosed(child);
  });
}

await finished;
process.exitCode = failureCode;
