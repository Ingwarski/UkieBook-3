import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../../db/migrate";
import { DATABASE_SCHEMA_REVISION } from "../../db/migrations";
import { platformFoundationMigration } from "../../db/migrations/0001_platform_foundation";
import { identitySessionsAuthorProfileMigration } from "../../db/migrations/0002_identity_sessions_author_profile";
import { catalogReadModelMigration } from "../../db/migrations/0003_catalog_read_model";
import { publishingPipelineMigration } from "../../db/migrations/0004_publishing_pipeline";
import { adaptPGlite } from "../../db/pglite";
import type { SqlDatabase } from "../../db/query";
import {
  claimNextJob,
  enqueueDurableJob,
  recoverExpiredJobs,
} from "../../modules/platform/durable-jobs";
import { appendOutboxEvent } from "../../modules/platform/outbox";
import { withDomainTransaction } from "../../modules/platform/transaction";
import { SCHEDULER_SCHEMA_REVISION } from "../../workers/scheduler";
import { runWorkerOnce, WORKER_SCHEMA_REVISION } from "../../workers/worker";

describe("UNIT-00 PostgreSQL foundation", () => {
  let pglite: PGlite;
  let database: SqlDatabase;

  beforeEach(async () => {
    pglite = await PGlite.create();
    database = adaptPGlite(pglite);
  });

  afterEach(async () => {
    await database.close?.();
  });

  it("applies the foundation migration idempotently and rolls it back", async () => {
    await expect(applyMigrations(database)).resolves.toEqual([
      { id: "0001_platform_foundation", direction: "up" },
      { id: "0002_identity_sessions_author_profile", direction: "up" },
      { id: "0003_catalog_read_model", direction: "up" },
      { id: "0004_publishing_pipeline", direction: "up" },
    ]);
    await expect(applyMigrations(database)).resolves.toEqual([]);
    await expect(listAppliedMigrations(database)).resolves.toHaveLength(4);

    const tables = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('outbox_events', 'durable_jobs')
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "durable_jobs",
      "outbox_events",
    ]);

    await expect(rollbackLatestMigration(database)).resolves.toEqual({
      id: "0004_publishing_pipeline",
      direction: "down",
    });
    await expect(rollbackLatestMigration(database)).resolves.toEqual({
      id: "0003_catalog_read_model",
      direction: "down",
    });
    await expect(rollbackLatestMigration(database)).resolves.toEqual({
      id: "0002_identity_sessions_author_profile",
      direction: "down",
    });
    await expect(rollbackLatestMigration(database)).resolves.toEqual({
      id: "0001_platform_foundation",
      direction: "down",
    });
    await expect(listAppliedMigrations(database)).resolves.toEqual([]);

    const remaining = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('outbox_events', 'durable_jobs')
    `);
    expect(remaining.rows).toEqual([]);
    await expect(applyMigrations(database)).resolves.toEqual([
      { id: "0001_platform_foundation", direction: "up" },
      { id: "0002_identity_sessions_author_profile", direction: "up" },
      { id: "0003_catalog_read_model", direction: "up" },
      { id: "0004_publishing_pipeline", direction: "up" },
    ]);

    await expect(
      applyMigrations(database, [
        { ...platformFoundationMigration, checksum: "edited-history" },
        identitySessionsAuthorProfileMigration,
        catalogReadModelMigration,
        publishingPipelineMigration,
      ]),
    ).rejects.toThrow(/checksum does not match/i);
  });

  it("commits exactly one outbox event and one job in the domain transaction", async () => {
    await applyMigrations(database);

    await withDomainTransaction(database, async (transaction) => {
      await transaction.emit({
        topic: "platform.foundation",
        eventType: "PlatformFoundationProbed",
        aggregateType: "platform_probe",
        aggregateId: "probe-1",
        payload: { probeId: "probe-1" },
        idempotencyKey: "event:probe-1",
        correlationId: "probe-1",
      });
      await transaction.enqueue({
        queue: "foundation",
        jobType: "platform.noop",
        payload: { probeId: "probe-1" },
        idempotencyKey: "job:probe-1",
        correlationId: "probe-1",
      });
    });

    const counts = await database.query<{
      outbox_count: number;
      job_count: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM outbox_events) AS outbox_count,
        (SELECT COUNT(*)::int FROM durable_jobs) AS job_count
    `);
    expect(counts.rows[0]).toMatchObject({ outbox_count: 1, job_count: 1 });

    await expect(
      withDomainTransaction(database, async (transaction) => {
        await transaction.emit({
          topic: "platform.foundation",
          eventType: "PlatformFoundationProbed",
          aggregateType: "platform_probe",
          aggregateId: "probe-rollback",
          payload: { probeId: "probe-rollback" },
          idempotencyKey: "event:probe-rollback",
          correlationId: "probe-rollback",
        });
        await transaction.enqueue({
          queue: "foundation",
          jobType: "platform.noop",
          payload: { probeId: "probe-rollback" },
          idempotencyKey: "job:probe-rollback",
          correlationId: "probe-rollback",
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const afterRollback = await database.query<{
      outbox_count: number;
      job_count: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM outbox_events) AS outbox_count,
        (SELECT COUNT(*)::int FROM durable_jobs) AS job_count
    `);
    expect(afterRollback.rows[0]).toMatchObject({
      outbox_count: 1,
      job_count: 1,
    });
  });

  it("enqueues and claims a job idempotently", async () => {
    await applyMigrations(database);
    const input = {
      queue: "foundation",
      jobType: "platform.noop",
      payload: { probeId: "probe-2" },
      idempotencyKey: "job:probe-2",
      correlationId: "probe-2",
    } as const;

    const first = await enqueueDurableJob(database, input);
    const duplicate = await enqueueDurableJob(database, input);
    expect(duplicate.id).toBe(first.id);

    const competingClaims = await Promise.all([
      claimNextJob(database, {
        queue: "foundation",
        workerId: "worker-1",
      }),
      claimNextJob(database, {
        queue: "foundation",
        workerId: "worker-2",
      }),
    ]);
    const claimed = competingClaims.find((job) => job !== null);
    expect(competingClaims.filter((job) => job !== null)).toHaveLength(1);
    expect(claimed).toMatchObject({
      id: first.id,
      status: "running",
      attempts: 1,
    });
    expect(["worker-1", "worker-2"]).toContain(claimed?.lockedBy);

    const count = await database.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM durable_jobs",
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it("rejects idempotency-key reuse for different semantic work", async () => {
    await applyMigrations(database);
    const jobInput = {
      queue: "foundation",
      jobType: "platform.noop",
      payload: { probeId: "semantic-job" },
      idempotencyKey: "job:semantic-conflict",
      correlationId: "semantic-job",
    } as const;
    await enqueueDurableJob(database, jobInput);
    await expect(
      enqueueDurableJob(database, {
        ...jobInput,
        payload: { probeId: "different-job" },
      }),
    ).rejects.toThrow(/idempotency conflict.*payload/i);

    const eventInput = {
      topic: "platform.foundation",
      eventType: "PlatformFoundationProbed",
      aggregateType: "platform_probe",
      aggregateId: "semantic-event",
      payload: { probeId: "semantic-event" },
      idempotencyKey: "event:semantic-conflict",
      correlationId: "semantic-event",
    } as const;
    await appendOutboxEvent(database, eventInput);
    await expect(
      appendOutboxEvent(database, {
        ...eventInput,
        eventType: "DifferentEvent",
      }),
    ).rejects.toThrow(/idempotency conflict.*eventType/i);

    const counts = await database.query<{ job_count: number; outbox_count: number }>(`
      SELECT
        (SELECT COUNT(*)::int FROM durable_jobs) AS job_count,
        (SELECT COUNT(*)::int FROM outbox_events) AS outbox_count
    `);
    expect(counts.rows[0]).toEqual({ job_count: 1, outbox_count: 1 });
  });

  it("runs one idempotently enqueued job through the worker once", async () => {
    await applyMigrations(database);
    const input = {
      queue: "foundation",
      jobType: "platform.noop",
      payload: { probeId: "probe-3" },
      idempotencyKey: "job:probe-3",
      correlationId: "probe-3",
    } as const;
    await enqueueDurableJob(database, input);
    await enqueueDurableJob(database, input);
    let calls = 0;

    await expect(
      runWorkerOnce({
        database,
        queue: "foundation",
        workerId: "worker-1",
        handlers: {
          "platform.noop": async () => {
            calls += 1;
          },
        },
      }),
    ).resolves.toBe(true);
    await expect(
      runWorkerOnce({
        database,
        queue: "foundation",
        workerId: "worker-1",
        handlers: {},
      }),
    ).resolves.toBe(false);
    expect(calls).toBe(1);

    const job = await database.query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM durable_jobs",
    );
    expect(job.rows[0]).toMatchObject({ status: "completed", attempts: 1 });
  });

  it("does not execute inherited Object prototype properties as handlers", async () => {
    await applyMigrations(database);
    await enqueueDurableJob(database, {
      queue: "foundation",
      jobType: "constructor",
      payload: { probeId: "prototype-handler" },
      idempotencyKey: "job:prototype-handler",
      correlationId: "prototype-handler",
      maxAttempts: 1,
    });

    await expect(
      runWorkerOnce({
        database,
        queue: "foundation",
        workerId: "worker-prototype-proof",
        handlers: {},
        retryDelayMs: 1,
      }),
    ).resolves.toBe(true);

    const result = await database.query<{ last_error: string; status: string }>(
      "SELECT last_error, status FROM durable_jobs",
    );
    expect(result.rows[0]).toMatchObject({
      last_error: "No handler registered for constructor",
      status: "dead_letter",
    });
  });

  it("recovers expired claims and dead-letters an exhausted job", async () => {
    await applyMigrations(database);
    await enqueueDurableJob(database, {
      queue: "foundation",
      jobType: "platform.noop",
      payload: { probeId: "probe-expired" },
      idempotencyKey: "job:probe-expired",
      correlationId: "probe-expired",
      maxAttempts: 1,
    });
    const claimed = await claimNextJob(database, {
      queue: "foundation",
      workerId: "worker-expired",
    });
    expect(claimed?.attempts).toBe(1);
    await database.query(`
      UPDATE durable_jobs
      SET locked_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes'
      WHERE id = $1
    `, [claimed?.id]);

    await expect(
      recoverExpiredJobs(database, {
        queue: "foundation",
        leaseSeconds: 60,
      }),
    ).resolves.toBe(1);

    const job = await database.query<{
      status: string;
      dead_lettered_at: string | Date | null;
    }>("SELECT status, dead_lettered_at FROM durable_jobs");
    expect(job.rows[0]?.status).toBe("dead_letter");
    expect(job.rows[0]?.dead_lettered_at).not.toBeNull();
  });

  it("renews a slow handler lease so a competing recovery cannot duplicate it", async () => {
    await applyMigrations(database);
    await enqueueDurableJob(database, {
      queue: "slow-foundation",
      jobType: "platform.slow-noop",
      payload: { probeId: "slow-handler" },
      idempotencyKey: "job:slow-handler",
      correlationId: "slow-handler",
      maxAttempts: 2,
    });
    let sideEffects = 0;
    const worker = runWorkerOnce({
      database,
      queue: "slow-foundation",
      workerId: "worker-slow",
      leaseSeconds: 1,
      handlers: {
        "platform.slow-noop": async (_job, context) => {
          await new Promise((resolve) => setTimeout(resolve, 1_250));
          expect(context.signal.aborted).toBe(false);
          sideEffects += 1;
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(
      recoverExpiredJobs(database, {
        queue: "slow-foundation",
        leaseSeconds: 1,
      }),
    ).resolves.toBe(0);
    await expect(worker).resolves.toBe(true);
    expect(sideEffects).toBe(1);
  });

  it("exposes one schema revision to both process roles", () => {
    expect(WORKER_SCHEMA_REVISION).toBe(DATABASE_SCHEMA_REVISION);
    expect(SCHEDULER_SCHEMA_REVISION).toBe(DATABASE_SCHEMA_REVISION);
  });
});
