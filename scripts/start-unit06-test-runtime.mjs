import { spawn } from "node:child_process";

const port = process.argv[2];
if (!port || !/^\d+$/u.test(port)) throw new Error("A numeric app port is required");
if (process.env.APP_ENV !== "test") throw new Error("UNIT-06 runtime requires APP_ENV=test");

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown"}`));
    });
  });
}

await run(
  "npx",
  ["--no-install", "tsx", "--conditions=react-server", "scripts/seed-unit06-e2e.ts"],
  { ...process.env, UNIT06_ALLOW_FIXTURE_SEED: "1" },
);

const children = [
  spawn(process.execPath, ["scripts/start-production-test-server.mjs", port], {
    cwd: process.cwd(), env: process.env, stdio: "inherit",
  }),
  spawn(process.execPath, ["dist/runtime/worker.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_ID: `${process.env.WORKER_ID ?? "unit06-worker"}-publishing`,
      WORKER_QUEUE: "publishing",
    },
    stdio: "inherit",
  }),
];

let stopping = false;
let failureCode = 0;
const closed = new Set();
let finish;
const finished = new Promise((resolve) => { finish = resolve; });

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5_000);
  timer.unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(signal));
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    failureCode = 1;
    stop();
  });
  child.once("close", (code, signal) => {
    if (!stopping) {
      console.error(`UNIT-06 child exited unexpectedly (${code ?? signal ?? "unknown"})`);
      failureCode = typeof code === "number" && code > 0 ? code : 1;
      stop();
    }
    closed.add(child);
    if (closed.size === children.length) finish();
  });
}

await finished;
process.exitCode = failureCode;
