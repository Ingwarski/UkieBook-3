import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { startOAuthProviderSimulator } from "./oauth-provider-simulator.ts";
import { openUnit06Database } from "./unit06-embedded-postgres.mjs";

let foregroundChild;

function numericPort(value, label) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${label} must be a numeric TCP port`);
  }
  const port = Number(value);
  if (port < 1_024 || port > 65_535) {
    throw new Error(`${label} must be between 1024 and 65535`);
  }
  return port;
}

async function assertPortAvailable(port, label) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      reject(
        new Error(
          `${label} port ${port} is unavailable; stop the existing preview or choose another port`,
          { cause: error },
        ),
      );
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    });
    foregroundChild = child;
    child.once("error", (error) => {
      if (foregroundChild === child) foregroundChild = undefined;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (foregroundChild === child) foregroundChild = undefined;
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

async function waitForUrl(url, isStopping) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline && !isStopping()) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`, { cause: lastError });
}

const appPort = numericPort(process.argv[2] ?? "3131", "App");
const oauthPort = numericPort(process.argv[3] ?? "3231", "OAuth");
if (appPort === oauthPort) {
  throw new Error("App and OAuth ports must be different");
}

await Promise.all([
  access(path.resolve(".next/standalone/server.js")),
  access(path.resolve("dist/runtime/worker.js")),
  assertPortAvailable(appPort, "App"),
  assertPortAvailable(oauthPort, "OAuth"),
]);

const database = await openUnit06Database();
let simulator;
const children = [];
let stopping = false;
let failureCode = 0;
let forceStopTimer;
let receivedSignal;
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
  if (
    foregroundChild &&
    foregroundChild.exitCode === null &&
    foregroundChild.signalCode === null
  ) {
    foregroundChild.kill(signal);
  }
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
  forceStopTimer = setTimeout(() => {
    if (
      foregroundChild &&
      foregroundChild.exitCode === null &&
      foregroundChild.signalCode === null
    ) {
      foregroundChild.kill("SIGKILL");
    }
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 5_000);
  forceStopTimer.unref();
  if (children.length === 0) finish();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    receivedSignal = signal;
    stop(signal);
  });
}

try {
  simulator = await startOAuthProviderSimulator(oauthPort);
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const privateObjectRoot = path.resolve(".data/local-preview-private");
  const environment = {
    ...process.env,
    APP_ENV: "test",
    APP_ORIGIN: appOrigin,
    APP_REVISION: process.env.APP_REVISION ?? "local-preview",
    AUTH_SECRET: randomBytes(32).toString("base64url"),
    AUTH_TEST_PROVIDER_ORIGIN: simulator.origin,
    DATABASE_URL: database.url,
    FACEBOOK_OAUTH_CLIENT_ID: "facebook-client",
    FACEBOOK_OAUTH_CLIENT_SECRET: "facebook-secret",
    GOOGLE_OAUTH_CLIENT_ID: "google-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    LOCAL_PREVIEW_ALLOW_FIXTURE_SEED: "1",
    PRIVATE_OBJECT_ROOT: privateObjectRoot,
    UNIT06_ALLOW_FIXTURE_SEED: "1",
    UNIT06_DATABASE_URL: database.url,
    UNIT06_PRIVATE_OBJECT_ROOT: privateObjectRoot,
    WORKER_ID: "local-preview-worker",
  };

  await run(
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/seed-unit06-e2e.ts",
    ],
    environment,
  );
  await run(
    "npx",
    [
      "--no-install",
      "tsx",
      "--conditions=react-server",
      "scripts/seed-local-preview.ts",
    ],
    environment,
  );

  children.push(
    spawn(
      process.execPath,
      ["scripts/start-production-test-server.mjs", String(appPort)],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: "inherit",
      },
    ),
    spawn(process.execPath, ["dist/runtime/worker.js"], {
      cwd: process.cwd(),
      env: {
        ...environment,
        WORKER_ID: "local-preview-publishing-worker",
        WORKER_QUEUE: "publishing",
      },
      stdio: "inherit",
    }),
  );

  for (const child of children) {
    child.once("error", (error) => {
      console.error(error);
      failureCode = 1;
      stop();
    });
    child.once("close", (code, signal) => {
      if (!stopping) {
        console.error(
          `Local preview child exited unexpectedly (${code ?? signal ?? "unknown"})`,
        );
        failureCode = typeof code === "number" && code > 0 ? code : 1;
        stop();
      }
      finishWhenClosed(child);
    });
  }

  await waitForUrl(`${appOrigin}/api/health`, () => stopping);
  process.stdout.write(
    `${JSON.stringify({
      app: appOrigin,
      catalog: appOrigin,
      database: "ukiebook_unit06",
      oauth: simulator.origin,
      status: "ready",
    })}\n`,
  );
  await finished;
} catch (error) {
  failureCode =
    receivedSignal === "SIGINT" ? 130 : receivedSignal === "SIGTERM" ? 143 : 1;
  stop();
  if (children.length > 0) await finished;
  if (!receivedSignal) throw error;
} finally {
  await simulator?.close().catch(() => {});
  await database.close();
}

process.exitCode = failureCode;
