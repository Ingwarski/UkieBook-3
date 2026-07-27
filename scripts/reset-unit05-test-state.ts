import { rm } from "node:fs/promises";
import path from "node:path";

import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  requireDedicatedUnit05DatabaseUrl,
  UNIT05_DATABASE_NAME,
} from "./unit05-database-guard";

if (process.env.APP_ENV !== "test") {
  throw new Error("UNIT-05 test-state reset requires APP_ENV=test");
}
if (process.env.UNIT05_ALLOW_TEST_RESET !== "1") {
  throw new Error(
    "Set UNIT05_ALLOW_TEST_RESET=1 to acknowledge the destructive reset",
  );
}

const databaseUrl = requireDedicatedUnit05DatabaseUrl(
  process.env.UNIT05_DATABASE_URL,
);
const repositoryDataRoot = path.resolve(".data");
const roots = [
  path.resolve(
    process.env.UNIT05_PRIVATE_OBJECT_ROOT ??
      process.env.PRIVATE_OBJECT_ROOT ??
      ".data/unit05-e2e-private",
  ),
  path.resolve(
    process.env.UNIT05_PUBLIC_ASSET_ROOT ??
      process.env.PUBLIC_CATALOG_ASSET_ROOT ??
      ".data/unit05-e2e-public",
  ),
  path.resolve(
    process.env.UNIT05_EMAIL_CAPTURE_ROOT ??
      ".data/unit05-e2e-email",
  ),
  path.resolve(
    process.env.UNIT05_MONO_STATE_ROOT ??
      ".data/unit05-e2e-mono",
  ),
];

for (const root of roots) {
  const relative = path.relative(repositoryDataRoot, root);
  if (
    path.dirname(root) !== repositoryDataRoot ||
    !relative.startsWith("unit05-") ||
    relative === "unit05-"
  ) {
    throw new Error(
      "UNIT-05 reset requires direct .data/unit05-* artifact directories",
    );
  }
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

for (const root of roots) {
  await rm(root, { force: true, recursive: true });
}

process.stdout.write(
  `${JSON.stringify({
    artifact_roots: roots.map((root) => path.basename(root)),
    database: UNIT05_DATABASE_NAME,
    schema: "reset-and-migrated",
    status: "passed",
  })}\n`,
);
