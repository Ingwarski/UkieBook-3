import "server-only";

import { openPostgresDatabase } from "../../../db/postgres";
import { readServerEnvironment } from "../environment/server";
import type { SqlDatabase } from "../sql-port";

let database: SqlDatabase | undefined;

/** One lazily-created PostgreSQL pool shared by the web process. */
export function productionDatabase(): SqlDatabase {
  database ??= openPostgresDatabase(readServerEnvironment().DATABASE_URL);
  return database;
}
