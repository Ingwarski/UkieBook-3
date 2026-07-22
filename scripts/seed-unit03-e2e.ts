import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import { requireDedicatedUnit03DatabaseUrl } from "./unit03-database-guard";

const databaseUrl = requireDedicatedUnit03DatabaseUrl(process.env.UNIT03_DATABASE_URL);
if (process.env.APP_ENV === "production") {
  throw new Error("UNIT-03 browser fixtures cannot be seeded in production");
}
if (process.env.UNIT03_ALLOW_FIXTURE_SEED !== "1") {
  throw new Error("Set UNIT03_ALLOW_FIXTURE_SEED=1 to acknowledge fixture seeding");
}
const database = openPostgresDatabase(databaseUrl);
try {
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
  process.stdout.write("UNIT-03 browser genres seeded.\n");
} finally {
  await database.close?.();
}
