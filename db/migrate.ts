import { migrations, type Migration } from "./migrations";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
} from "../modules/platform/sql-port";
import { withSqlTransaction } from "../modules/platform/sql-port";

interface AppliedMigrationRow extends SqlRow {
  id: string;
  checksum: string | null;
  applied_at: string | Date;
}

const MIGRATION_ADVISORY_LOCK_ID = 1_912_251_317;

export interface MigrationResult {
  readonly id: string;
  readonly direction: "up" | "down";
}

async function ensureMigrationTable(database: SqlExecutor): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await database.query(
    "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT",
  );
}

export async function listAppliedMigrations(
  database: SqlDatabase,
): Promise<AppliedMigrationRow[]> {
  await ensureMigrationTable(database);
  const result = await database.query<AppliedMigrationRow>(`
    SELECT id, checksum, applied_at
    FROM schema_migrations
    ORDER BY applied_at ASC, id ASC
  `);

  return result.rows;
}

function assertMigrationHistoryIsKnown(
  applied: readonly AppliedMigrationRow[],
  available: readonly Migration[],
): void {
  const availableById = new Map(
    available.map((migration) => [migration.id, migration]),
  );
  const unknown = applied.find(
    (migration) => !availableById.has(migration.id),
  );

  if (unknown) {
    throw new Error(
      `Database migration ${unknown.id} is not present in this revision`,
    );
  }

  const edited = applied.find(
    (migration) =>
      migration.checksum !== availableById.get(migration.id)?.checksum,
  );
  if (edited) {
    throw new Error(
      `Database migration ${edited.id} checksum does not match this revision`,
    );
  }
}

async function withMigrationLock<Result>(
  database: SqlDatabase,
  operation: (lockedDatabase: SqlDatabase) => Promise<Result>,
): Promise<Result> {
  if (!database.connect) {
    return operation(database);
  }

  const connection = await database.connect();
  await connection.query("SELECT pg_advisory_lock($1)", [
    MIGRATION_ADVISORY_LOCK_ID,
  ]);
  const lockedDatabase: SqlDatabase = {
    query: (text, parameters) => connection.query(text, parameters),
  };
  try {
    return await operation(lockedDatabase);
  } finally {
    try {
      await connection.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_ADVISORY_LOCK_ID,
      ]);
    } finally {
      connection.release?.();
    }
  }
}

export async function applyMigrations(
  database: SqlDatabase,
  available: readonly Migration[] = migrations,
): Promise<MigrationResult[]> {
  return withMigrationLock(database, async (lockedDatabase) => {
    const applied = await listAppliedMigrations(lockedDatabase);
    assertMigrationHistoryIsKnown(applied, available);
    const appliedIds = new Set(applied.map((migration) => migration.id));
    const results: MigrationResult[] = [];

    for (const migration of available) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      await withSqlTransaction(lockedDatabase, async (connection) => {
        await migration.up(connection);
        await connection.query(
          "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)",
          [migration.id, migration.checksum],
        );
      });
      results.push({ id: migration.id, direction: "up" });
    }

    return results;
  });
}

export async function rollbackLatestMigration(
  database: SqlDatabase,
  available: readonly Migration[] = migrations,
): Promise<MigrationResult | null> {
  return withMigrationLock(database, async (lockedDatabase) => {
    const applied = await listAppliedMigrations(lockedDatabase);
    assertMigrationHistoryIsKnown(applied, available);
    const latest = applied.at(-1);

    if (!latest) {
      return null;
    }

    const migration = available.find((candidate) => candidate.id === latest.id);
    if (!migration) {
      throw new Error(`Cannot roll back unknown migration ${latest.id}`);
    }

    await withSqlTransaction(lockedDatabase, async (connection) => {
      await migration.down(connection);
      await connection.query("DELETE FROM schema_migrations WHERE id = $1", [
        migration.id,
      ]);
    });

    return { id: migration.id, direction: "down" };
  });
}
