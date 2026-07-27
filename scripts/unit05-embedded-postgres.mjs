import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

import {
  requireDedicatedUnit05DatabaseUrl,
  UNIT05_DATABASE_NAME,
} from "./unit05-database-guard.ts";

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a loopback port for embedded PostgreSQL");
  }
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

export async function openUnit05Database(value = process.env.UNIT05_DATABASE_URL) {
  if (value) {
    return {
      embedded: false,
      url: requireDedicatedUnit05DatabaseUrl(value),
      close: async () => {},
    };
  }

  const databaseDir = await mkdtemp(
    path.join(os.tmpdir(), "ukiebook-unit05-postgres-"),
  );
  const port = await availableLoopbackPort();
  const user = "unit05";
  const password = randomBytes(24).toString("base64url");
  const errors = [];
  const postgres = new EmbeddedPostgres({
    authMethod: "scram-sha-256",
    databaseDir,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onError(message) {
      errors.push(
        message instanceof Error ? message.message : String(message),
      );
    },
    onLog() {},
    password,
    persistent: false,
    port,
    postgresFlags: [
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      "fsync=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      "full_page_writes=off",
    ],
    user,
  });

  let started = false;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    await postgres.createDatabase(UNIT05_DATABASE_NAME);
  } catch (error) {
    if (started) {
      await postgres.stop().catch(() => {});
    }
    await rm(databaseDir, { force: true, recursive: true });
    const detail = errors.filter(Boolean).slice(-3).join(" | ");
    throw new Error(
      `Unable to start embedded PostgreSQL${detail ? `: ${detail}` : ""}`,
      { cause: error },
    );
  }

  const url = requireDedicatedUnit05DatabaseUrl(
    `postgresql://${user}:${password}@127.0.0.1:${port}/${UNIT05_DATABASE_NAME}`,
  );
  let closed = false;
  return {
    embedded: true,
    url,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await postgres.stop();
      } finally {
        await rm(databaseDir, { force: true, recursive: true });
      }
    },
  };
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
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

const executedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
if (executedPath === fileURLToPath(import.meta.url)) {
  const separator = process.argv.indexOf("--");
  const command = separator >= 0 ? process.argv[separator + 1] : undefined;
  const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
  if (!command) {
    throw new Error(
      "Usage: node --import tsx scripts/unit05-embedded-postgres.mjs -- <command> [args...]",
    );
  }

  const database = await openUnit05Database();
  process.stdout.write(
    `${JSON.stringify({
      database: UNIT05_DATABASE_NAME,
      mode: database.embedded ? "embedded" : "explicit",
      status: "ready",
    })}\n`,
  );
  try {
    await run(command, args, {
      ...process.env,
      UNIT05_DATABASE_URL: database.url,
    });
  } finally {
    await database.close();
  }
}
