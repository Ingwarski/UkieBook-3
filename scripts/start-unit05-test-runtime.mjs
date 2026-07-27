import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const port = process.argv[2];
if (!port || !/^\d+$/u.test(port)) {
  throw new Error("A numeric app port is required");
}
if (process.env.APP_ENV !== "test") {
  throw new Error("UNIT-05 runtime requires APP_ENV=test");
}

const publicKeyFile = process.env.UNIT05_MONO_PUBLIC_KEY_FILE;
if (!publicKeyFile) {
  throw new Error("UNIT05_MONO_PUBLIC_KEY_FILE is required");
}
const publicKeyDocument = JSON.parse(
  await readFile(path.resolve(publicKeyFile), "utf8"),
);
if (
  typeof publicKeyDocument !== "object" ||
  publicKeyDocument === null ||
  publicKeyDocument.algorithm !== "ECDSA_SHA256" ||
  publicKeyDocument.encoding !== "spki-der-base64" ||
  typeof publicKeyDocument.key !== "string" ||
  !publicKeyDocument.key ||
  publicKeyDocument.origin !== process.env.MONO_API_ORIGIN
) {
  throw new Error("UNIT-05 mono simulator public-key document is invalid");
}

const runtimeEnvironment = {
  ...process.env,
  MONO_WEBHOOK_PUBLIC_KEY: publicKeyDocument.key,
};

function run(command, args, env = runtimeEnvironment) {
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
    "scripts/seed-unit05-e2e.ts",
  ],
  {
    ...runtimeEnvironment,
    UNIT05_ALLOW_FIXTURE_SEED: "1",
  },
);

const children = [
  spawn(process.execPath, ["scripts/start-production-test-server.mjs", port], {
    cwd: process.cwd(),
    env: runtimeEnvironment,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["dist/runtime/worker.js"], {
    cwd: process.cwd(),
    env: {
      ...runtimeEnvironment,
      WORKER_ID: `${process.env.WORKER_ID ?? "unit05-worker"}-commerce`,
      WORKER_QUEUE: "commerce",
    },
    stdio: "inherit",
  }),
  spawn(process.execPath, ["dist/runtime/worker.js"], {
    cwd: process.cwd(),
    env: {
      ...runtimeEnvironment,
      WORKER_ID: `${process.env.WORKER_ID ?? "unit05-worker"}-notifications`,
      WORKER_QUEUE: "notifications",
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
        `UNIT-05 child exited unexpectedly (${code ?? signal ?? "unknown"})`,
      );
      failureCode = typeof code === "number" && code > 0 ? code : 1;
      stop();
    }
    finishWhenClosed(child);
  });
}

await finished;
process.exitCode = failureCode;
