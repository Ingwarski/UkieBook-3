import { rm } from "node:fs/promises";
import path from "node:path";

import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  requireDedicatedUnit03DatabaseUrl,
  UNIT03_DATABASE_NAME,
} from "./unit03-database-guard";

if (process.env.APP_ENV !== "test") {
  throw new Error("UNIT-03 test-state reset requires APP_ENV=test");
}
if (process.env.UNIT03_ALLOW_TEST_RESET !== "1") {
  throw new Error("Set UNIT03_ALLOW_TEST_RESET=1 to acknowledge the destructive reset");
}

const databaseUrl = requireDedicatedUnit03DatabaseUrl(
  process.env.UNIT03_DATABASE_URL,
);
const repositoryDataRoot = path.resolve(".data");
const privateObjectRoot = path.resolve(
  process.env.UNIT03_PRIVATE_OBJECT_ROOT ??
    process.env.PRIVATE_OBJECT_ROOT ??
    ".data/unit03-e2e-private",
);
const relativeObjectRoot = path.relative(repositoryDataRoot, privateObjectRoot);
if (
  path.dirname(privateObjectRoot) !== repositoryDataRoot ||
  !relativeObjectRoot.startsWith("unit03-") ||
  relativeObjectRoot === "unit03-"
) {
  throw new Error(
    "UNIT-03 reset requires a direct .data/unit03-* private-object directory",
  );
}

const database = openPostgresDatabase(databaseUrl);
try {
  await database.query("DROP SCHEMA public CASCADE");
  await database.query("CREATE SCHEMA public");
  await applyMigrations(database);
  await database.query(
    `
      INSERT INTO catalog_genres (slug, label) VALUES
        ('proza', 'Проза'),
        ('fantastyka', 'Фантастика'),
        ('dityacha', 'Дитяча література'),
        ('eseistyka', 'Есеїстика')
      ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label
    `,
  );
} finally {
  await database.close?.();
}
await rm(privateObjectRoot, { force: true, recursive: true });

process.stdout.write(
  `${JSON.stringify({
    database: UNIT03_DATABASE_NAME,
    private_object_root: path.basename(privateObjectRoot),
    schema: "reset-and-migrated",
    status: "passed",
  })}\n`,
);
