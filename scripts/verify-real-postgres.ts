import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../db/migrate";
import { platformFoundationMigration } from "../db/migrations/0001_platform_foundation";
import { DATABASE_SCHEMA_REVISION } from "../db/migrations";
import { openPostgresDatabase } from "../db/postgres";
import { enqueueDurableJob } from "../modules/platform/durable-jobs";
import { withDomainTransaction } from "../modules/platform/transaction";
import { SCHEDULER_SCHEMA_REVISION } from "../workers/scheduler";
import { runWorkerOnce, WORKER_SCHEMA_REVISION } from "../workers/worker";

const databaseUrl = process.env.REAL_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("REAL_DATABASE_URL is required for the real PostgreSQL acceptance proof");
}

const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR)
  : undefined;
const implementationRevision =
  process.env.APP_REVISION ?? process.env.IMPLEMENTATION_REVISION ?? "working-tree";
const expectedDatabaseName = "ukiebook_unit00";
const unit00Migrations = [platformFoundationMigration] as const;
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(
  parsedDatabaseUrl.pathname.replace(/^\//u, ""),
);
if (
  parsedDatabaseUrl.search ||
  parsedDatabaseUrl.hash ||
  !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
  !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
    parsedDatabaseUrl.hostname,
  ) ||
  databaseName !== expectedDatabaseName ||
  !parsedDatabaseUrl.username ||
  !parsedDatabaseUrl.password
) {
  throw new Error(
    `REAL_DATABASE_URL must use dedicated credentials without overrides for the exact loopback database ${expectedDatabaseName}`,
  );
}
const database = openPostgresDatabase(databaseUrl);

interface CountRow extends Record<string, unknown> {
  job_count: number;
  outbox_count: number;
}

async function writeEvidence(relativePath: string, value: unknown): Promise<void> {
  if (!evidenceRoot) {
    return;
  }

  const target = path.join(evidenceRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function applicationTables(): Promise<string[]> {
  const result = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('outbox_events', 'durable_jobs')
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function platformCounts(): Promise<CountRow> {
  const result = await database.query<CountRow>(`
    SELECT
      (SELECT COUNT(*)::int FROM outbox_events) AS outbox_count,
      (SELECT COUNT(*)::int FROM durable_jobs) AS job_count
  `);
  const counts = result.rows[0];
  assert.ok(counts, "PostgreSQL did not return platform table counts");
  return counts;
}

async function resetKnownFoundation(): Promise<void> {
  for (;;) {
    const rolledBack = await rollbackLatestMigration(database, unit00Migrations);
    if (!rolledBack) {
      break;
    }
  }
  assert.deepEqual(
    await applicationTables(),
    [],
    "The dedicated acceptance database contains unmanaged foundation tables",
  );
}

try {
  const identity = await database.query<{
    database_name: string;
    server_version: string;
  }>(`
    SELECT current_database() AS database_name,
           current_setting('server_version') AS server_version
  `);
  const databaseIdentity = identity.rows[0];
  assert.equal(
    databaseIdentity?.database_name,
    expectedDatabaseName,
    `Refusing to run destructive migration proof outside ${expectedDatabaseName}`,
  );

  await resetKnownFoundation();
  const emptyTables = await applicationTables();
  assert.deepEqual(emptyTables, []);

  const firstApply = await applyMigrations(database, unit00Migrations);
  assert.deepEqual(firstApply, [
    { direction: "up", id: platformFoundationMigration.id },
  ]);
  assert.deepEqual(await applicationTables(), ["durable_jobs", "outbox_events"]);

  const constraints = await database.query<{
    constraint_name: string;
    table_name: string;
  }>(`
    SELECT con.conname AS constraint_name, cls.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND cls.relname IN ('outbox_events', 'durable_jobs')
    ORDER BY cls.relname, con.conname
  `);
  const indexes = await database.query<{ indexname: string; tablename: string }>(`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('outbox_events', 'durable_jobs')
    ORDER BY tablename, indexname
  `);
  assert.ok(
    constraints.rows.some(
      (row) =>
        row.table_name === "durable_jobs" &&
        row.constraint_name.includes("idempotency_key"),
    ),
    "Durable-job idempotency constraint is missing",
  );
  assert.ok(
    constraints.rows.some(
      (row) =>
        row.table_name === "outbox_events" &&
        row.constraint_name.includes("idempotency_key"),
    ),
    "Outbox idempotency constraint is missing",
  );

  const rolledBack = await rollbackLatestMigration(database, unit00Migrations);
  assert.deepEqual(rolledBack, {
    direction: "down",
    id: platformFoundationMigration.id,
  });
  const tablesAfterRollback = await applicationTables();
  assert.deepEqual(tablesAfterRollback, []);
  assert.deepEqual(await listAppliedMigrations(database), []);

  const migratorA = openPostgresDatabase(databaseUrl);
  const migratorB = openPostgresDatabase(databaseUrl);
  let concurrentReapply: Awaited<ReturnType<typeof applyMigrations>>[];
  try {
    concurrentReapply = await Promise.all([
      applyMigrations(migratorA, unit00Migrations),
      applyMigrations(migratorB, unit00Migrations),
    ]);
  } finally {
    await Promise.all([migratorA.close(), migratorB.close()]);
  }
  assert.deepEqual(
    concurrentReapply.map((result) => result.length).sort(),
    [0, 1],
  );
  const appliedHistory = await listAppliedMigrations(database);
  assert.equal(appliedHistory[0]?.checksum?.length, 64);

  const migrationEvidence = {
    applied_revision: platformFoundationMigration.id,
    constraints: constraints.rows,
    database: databaseIdentity,
    empty_application_tables_before_apply: emptyTables,
    first_apply: firstApply,
    indexes: indexes.rows,
    implementation_revision: implementationRevision,
    concurrent_reapply: concurrentReapply,
    rollback: rolledBack,
    tables_after_rollback: tablesAfterRollback,
    verified_at: new Date().toISOString(),
  };
  await writeEvidence(
    "evidence/database/migration-roundtrip.json",
    migrationEvidence,
  );

  await withDomainTransaction(database, async (transaction) => {
    await transaction.emit({
      aggregateId: "commit-proof",
      aggregateType: "platform_probe",
      correlationId: "commit-proof",
      eventType: "PlatformFoundationProbed",
      idempotencyKey: "event:commit-proof",
      payload: { proof: "commit" },
      topic: "platform.foundation",
    });
    await transaction.enqueue({
      correlationId: "commit-proof",
      idempotencyKey: "job:commit-proof",
      jobType: "platform.noop",
      payload: { proof: "commit" },
      queue: "transaction-proof",
    });
  });
  const committedCounts = await platformCounts();
  assert.deepEqual(committedCounts, { job_count: 1, outbox_count: 1 });

  await assert.rejects(
    withDomainTransaction(database, async (transaction) => {
      await transaction.emit({
        aggregateId: "rollback-proof",
        aggregateType: "platform_probe",
        correlationId: "rollback-proof",
        eventType: "PlatformFoundationProbed",
        idempotencyKey: "event:rollback-proof",
        payload: { proof: "rollback" },
        topic: "platform.foundation",
      });
      await transaction.enqueue({
        correlationId: "rollback-proof",
        idempotencyKey: "job:rollback-proof",
        jobType: "platform.noop",
        payload: { proof: "rollback" },
        queue: "transaction-proof",
      });
      throw new Error("intentional transaction rollback proof");
    }),
    /intentional transaction rollback proof/,
  );
  const afterRollbackCounts = await platformCounts();
  assert.deepEqual(afterRollbackCounts, committedCounts);

  await writeEvidence("evidence/database/transaction-outbox-job.json", {
    after_rollback: afterRollbackCounts,
    committed: committedCounts,
    implementation_revision: implementationRevision,
    rollback_preserved_counts: true,
    verified_at: new Date().toISOString(),
  });

  const jobInput = {
    correlationId: "worker-proof",
    idempotencyKey: "job:worker-proof",
    jobType: "platform.noop",
    payload: { proof: "worker" },
    queue: "worker-proof",
  } as const;
  const firstJob = await enqueueDurableJob(database, jobInput);
  const duplicateJob = await enqueueDurableJob(database, jobInput);
  assert.equal(duplicateJob.id, firstJob.id);
  await assert.rejects(
    enqueueDurableJob(database, {
      ...jobInput,
      payload: { proof: "different-work" },
    }),
    /idempotency conflict.*payload/i,
  );

  const competitorA = openPostgresDatabase(databaseUrl);
  const competitorB = openPostgresDatabase(databaseUrl);
  let sideEffects = 0;
  const handler = async (): Promise<void> => {
    sideEffects += 1;
  };
  let workerResults: boolean[];
  try {
    workerResults = await Promise.all([
      runWorkerOnce({
        database: competitorA,
        handlers: { "platform.noop": handler },
        queue: "worker-proof",
        workerId: "worker-proof-a",
      }),
      runWorkerOnce({
        database: competitorB,
        handlers: { "platform.noop": handler },
        queue: "worker-proof",
        workerId: "worker-proof-b",
      }),
    ]);
  } finally {
    await Promise.all([competitorA.close(), competitorB.close()]);
  }
  assert.equal(workerResults.filter(Boolean).length, 1);
  assert.equal(sideEffects, 1);

  const workerRows = await database.query<{
    attempts: number;
    count: number;
    status: string;
  }>(`
    SELECT COUNT(*)::int AS count,
           MAX(attempts)::int AS attempts,
           MAX(status) AS status
    FROM durable_jobs
    WHERE queue = 'worker-proof'
  `);
  assert.deepEqual(workerRows.rows[0], {
    attempts: 1,
    count: 1,
    status: "completed",
  });
  await writeEvidence("evidence/worker/idempotent-claim.json", {
    competing_worker_results: workerResults,
    duplicate_job_id: duplicateJob.id,
    first_job_id: firstJob.id,
    implementation_revision: implementationRevision,
    persisted_result: workerRows.rows[0],
    side_effect_count: sideEffects,
    mismatched_idempotency_retry_rejected: true,
    verified_at: new Date().toISOString(),
  });

  await enqueueDurableJob(database, {
    correlationId: "lease-proof",
    idempotencyKey: "job:lease-proof",
    jobType: "platform.slow-noop",
    maxAttempts: 2,
    payload: { proof: "lease-heartbeat" },
    queue: "lease-proof",
  });
  const slowWorkerDatabase = openPostgresDatabase(databaseUrl);
  const recoveryWorkerDatabase = openPostgresDatabase(databaseUrl);
  let signalHandlerStarted: (() => void) | undefined;
  const handlerStarted = new Promise<void>((resolve) => {
    signalHandlerStarted = resolve;
  });
  let slowSideEffects = 0;
  try {
    const slowWorker = runWorkerOnce({
      database: slowWorkerDatabase,
      handlers: {
        "platform.slow-noop": async (_job, context) => {
          signalHandlerStarted?.();
          await new Promise((resolve) => setTimeout(resolve, 1_600));
          assert.equal(context.signal.aborted, false);
          slowSideEffects += 1;
        },
      },
      leaseSeconds: 1,
      queue: "lease-proof",
      workerId: "lease-proof-primary",
    });
    await handlerStarted;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const recoveryWorkerClaimed = await runWorkerOnce({
      database: recoveryWorkerDatabase,
      handlers: {
        "platform.slow-noop": async () => {
          slowSideEffects += 1;
        },
      },
      leaseSeconds: 1,
      queue: "lease-proof",
      workerId: "lease-proof-competitor",
    });
    assert.equal(recoveryWorkerClaimed, false);
    assert.equal(await slowWorker, true);
    assert.equal(slowSideEffects, 1);

    const persistedLeaseProof = await database.query<{
      attempts: number;
      status: string;
    }>(`
      SELECT attempts, status
      FROM durable_jobs
      WHERE queue = 'lease-proof'
    `);
    assert.deepEqual(persistedLeaseProof.rows[0], {
      attempts: 1,
      status: "completed",
    });
    await writeEvidence("evidence/worker/lease-expiry-idempotency.json", {
      competitor_claimed: recoveryWorkerClaimed,
      handler_duration_ms: 1_600,
      implementation_revision: implementationRevision,
      lease_seconds: 1,
      persisted_result: persistedLeaseProof.rows[0],
      side_effect_count: slowSideEffects,
      status: "passed",
      verified_at: new Date().toISOString(),
    });
  } finally {
    await Promise.all([
      slowWorkerDatabase.close(),
      recoveryWorkerDatabase.close(),
    ]);
  }

  assert.equal(WORKER_SCHEMA_REVISION, DATABASE_SCHEMA_REVISION);
  assert.equal(SCHEDULER_SCHEMA_REVISION, DATABASE_SCHEMA_REVISION);
  await writeEvidence("evidence/architecture/runtime-revisions.json", {
    database: DATABASE_SCHEMA_REVISION,
    implementation_revision: implementationRevision,
    scheduler: SCHEDULER_SCHEMA_REVISION,
    verified_at: new Date().toISOString(),
    worker: WORKER_SCHEMA_REVISION,
  });

  console.log(
    JSON.stringify({
      database: databaseIdentity,
      migration_revision: platformFoundationMigration.id,
      status: "passed",
      transaction: { afterRollbackCounts, committedCounts },
      worker: { sideEffects, workerResults },
    }),
  );
} finally {
  await database.close();
}
