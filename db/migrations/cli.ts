import { pathToFileURL } from "node:url";

import { readServerEnvironment } from "../../modules/platform/environment/runtime";
import { readRuntimeIdentity } from "../../modules/platform/runtime-identity";
import { applyMigrations, rollbackLatestMigration } from "../migrate";
import { openPostgresDatabase } from "../postgres";

export async function runMigrationCommand(
  command: string | undefined,
): Promise<void> {
  if (command === "--check") {
    console.log(JSON.stringify(readRuntimeIdentity("db-migrate")));
    return;
  }

  if (command !== "up" && command !== "down") {
    throw new Error("Migration command must be either 'up' or 'down'");
  }

  const environment = readServerEnvironment();
  const database = openPostgresDatabase(environment.DATABASE_URL);

  try {
    if (command === "up") {
      const results = await applyMigrations(database);
      console.log(
        results.length === 0
          ? "Database schema is already current."
          : `Applied migrations: ${results.map((result) => result.id).join(", ")}`,
      );
      return;
    }

    const result = await rollbackLatestMigration(database);
    console.log(
      result
        ? `Rolled back migration: ${result.id}`
        : "No applied migration to roll back.",
    );
  } finally {
    await database.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void runMigrationCommand(process.argv[2]).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
