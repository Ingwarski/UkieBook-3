import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { SqlExecutor, SqlRow } from "./sql-port";
import {
  type JsonObject,
  requireNonEmpty,
  requirePositiveInteger,
  toIsoTimestamp,
} from "./envelopes";

export type DurableJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "dead_letter";

export interface DurableJobInput {
  readonly queue: string;
  readonly jobType: string;
  readonly jobVersion?: number;
  readonly payload: JsonObject;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly availableAt?: string;
  readonly maxAttempts?: number;
}

export interface DurableJob {
  readonly id: string;
  readonly queue: string;
  readonly jobType: string;
  readonly jobVersion: number;
  readonly payload: JsonObject;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly status: DurableJobStatus;
  readonly availableAt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lockedAt: string | null;
  readonly lockedBy: string | null;
  readonly completedAt: string | null;
  readonly deadLetteredAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DurableJobRow extends SqlRow {
  id: string;
  queue: string;
  job_type: string;
  job_version: number;
  payload: JsonObject;
  idempotency_key: string;
  correlation_id: string;
  status: DurableJobStatus;
  available_at: string | Date;
  attempts: number;
  max_attempts: number;
  locked_at: string | Date | null;
  locked_by: string | null;
  completed_at: string | Date | null;
  dead_lettered_at: string | Date | null;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const jobProjection = `
  id,
  queue,
  job_type,
  job_version,
  payload,
  idempotency_key,
  correlation_id,
  status,
  available_at,
  attempts,
  max_attempts,
  locked_at,
  locked_by,
  completed_at,
  dead_lettered_at,
  last_error,
  created_at,
  updated_at
`;

function mapDurableJob(row: DurableJobRow): DurableJob {
  const availableAt = toIsoTimestamp(row.available_at);
  const createdAt = toIsoTimestamp(row.created_at);
  const updatedAt = toIsoTimestamp(row.updated_at);

  if (!availableAt || !createdAt || !updatedAt) {
    throw new Error(`Durable job ${row.id} has an invalid timestamp`);
  }

  return {
    id: row.id,
    queue: row.queue,
    jobType: row.job_type,
    jobVersion: row.job_version,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    status: row.status,
    availableAt,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedAt: toIsoTimestamp(row.locked_at),
    lockedBy: row.locked_by,
    completedAt: toIsoTimestamp(row.completed_at),
    deadLetteredAt: toIsoTimestamp(row.dead_lettered_at),
    lastError: row.last_error,
    createdAt,
    updatedAt,
  };
}

export async function enqueueDurableJob(
  connection: SqlExecutor,
  input: DurableJobInput,
): Promise<DurableJob> {
  const idempotencyKey = requireNonEmpty(
    input.idempotencyKey,
    "idempotencyKey",
  );
  const queue = requireNonEmpty(input.queue, "queue");
  const values = [
    randomUUID(),
    queue,
    requireNonEmpty(input.jobType, "jobType"),
    requirePositiveInteger(input.jobVersion ?? 1, "jobVersion"),
    JSON.stringify(input.payload),
    idempotencyKey,
    requireNonEmpty(input.correlationId, "correlationId"),
    input.availableAt ?? new Date().toISOString(),
    requirePositiveInteger(input.maxAttempts ?? 5, "maxAttempts"),
  ] as const;

  const inserted = await connection.query<DurableJobRow>(
    `
      INSERT INTO durable_jobs (
        id, queue, job_type, job_version, payload, idempotency_key,
        correlation_id, available_at, max_attempts
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
      ON CONFLICT (queue, idempotency_key) DO NOTHING
      RETURNING ${jobProjection}
    `,
    values,
  );

  if (inserted.rows[0]) {
    return mapDurableJob(inserted.rows[0]);
  }

  const existing = await connection.query<DurableJobRow>(
    `
      SELECT ${jobProjection}
      FROM durable_jobs
      WHERE queue = $1 AND idempotency_key = $2
    `,
    [queue, idempotencyKey],
  );

  if (!existing.rows[0]) {
    throw new Error(`Unable to recover durable job ${queue}/${idempotencyKey}`);
  }

  const recovered = mapDurableJob(existing.rows[0]);
  const requestedAvailableAt = input.availableAt
    ? new Date(input.availableAt).toISOString()
    : undefined;
  const conflicts = [
    recovered.jobType !== input.jobType && "jobType",
    recovered.jobVersion !== (input.jobVersion ?? 1) && "jobVersion",
    !isDeepStrictEqual(recovered.payload, input.payload) && "payload",
    recovered.correlationId !== input.correlationId && "correlationId",
    recovered.maxAttempts !== (input.maxAttempts ?? 5) && "maxAttempts",
    requestedAvailableAt !== undefined &&
      recovered.availableAt !== requestedAvailableAt &&
      "availableAt",
  ].filter((field): field is string => Boolean(field));

  if (conflicts.length > 0) {
    throw new Error(
      `Durable job idempotency conflict for ${queue}/${idempotencyKey}: ${conflicts.join(", ")}`,
    );
  }

  return recovered;
}

export async function claimNextJob(
  connection: SqlExecutor,
  input: { readonly queue: string; readonly workerId: string },
): Promise<DurableJob | null> {
  const claimed = await connection.query<DurableJobRow>(
    `
      WITH candidate AS (
        SELECT id
        FROM durable_jobs
        WHERE queue = $1
          AND status = 'pending'
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY available_at ASC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE durable_jobs AS job
      SET status = 'running',
          attempts = job.attempts + 1,
          locked_at = CURRENT_TIMESTAMP,
          locked_by = $2,
          updated_at = CURRENT_TIMESTAMP
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING ${jobProjection
        .split(",")
        .map((column) => `job.${column.trim()}`)
        .join(", ")}
    `,
    [
      requireNonEmpty(input.queue, "queue"),
      requireNonEmpty(input.workerId, "workerId"),
    ],
  );

  return claimed.rows[0] ? mapDurableJob(claimed.rows[0]) : null;
}

export async function recoverExpiredJobs(
  connection: SqlExecutor,
  input: { readonly queue: string; readonly leaseSeconds: number },
): Promise<number> {
  const leaseSeconds = requirePositiveInteger(
    input.leaseSeconds,
    "leaseSeconds",
  );
  const recovered = await connection.query<{ id: string }>(
    `
      UPDATE durable_jobs AS job
      SET status = CASE
            WHEN job.attempts >= job.max_attempts THEN 'dead_letter'
            ELSE 'pending'
          END,
          available_at = CASE
            WHEN job.attempts >= job.max_attempts THEN job.available_at
            ELSE CURRENT_TIMESTAMP
          END,
          dead_lettered_at = CASE
            WHEN job.attempts >= job.max_attempts THEN CURRENT_TIMESTAMP
            ELSE NULL
          END,
          locked_at = NULL,
          locked_by = NULL,
          last_error = 'Worker lease expired',
          updated_at = CURRENT_TIMESTAMP
      WHERE job.queue = $1
        AND job.status = 'running'
        AND job.locked_at IS NOT NULL
        AND job.locked_at <= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 second')
      RETURNING job.id
    `,
    [requireNonEmpty(input.queue, "queue"), leaseSeconds],
  );

  return recovered.rows.length;
}

export async function renewDurableJobLease(
  connection: SqlExecutor,
  input: { readonly jobId: string; readonly workerId: string },
): Promise<boolean> {
  const renewed = await connection.query<{ id: string }>(
    `
      UPDATE durable_jobs
      SET locked_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'running' AND locked_by = $2
      RETURNING id
    `,
    [
      requireNonEmpty(input.jobId, "jobId"),
      requireNonEmpty(input.workerId, "workerId"),
    ],
  );

  return renewed.rows.length === 1;
}

export async function completeDurableJob(
  connection: SqlExecutor,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const completed = await connection.query<{ id: string }>(
    `
      UPDATE durable_jobs
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          locked_at = NULL,
          locked_by = NULL,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'running' AND locked_by = $2
      RETURNING id
    `,
    [requireNonEmpty(jobId, "jobId"), requireNonEmpty(workerId, "workerId")],
  );

  return completed.rows.length === 1;
}

export async function failDurableJob(
  connection: SqlExecutor,
  input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly error: string;
    readonly retryAt?: string;
  },
): Promise<DurableJob | null> {
  const failed = await connection.query<DurableJobRow>(
    `
      UPDATE durable_jobs AS job
      SET status = CASE
            WHEN job.attempts >= job.max_attempts THEN 'dead_letter'
            ELSE 'pending'
          END,
          available_at = CASE
            WHEN job.attempts >= job.max_attempts THEN job.available_at
            ELSE $4::timestamptz
          END,
          dead_lettered_at = CASE
            WHEN job.attempts >= job.max_attempts THEN CURRENT_TIMESTAMP
            ELSE NULL
          END,
          locked_at = NULL,
          locked_by = NULL,
          last_error = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE job.id = $1 AND job.status = 'running' AND job.locked_by = $2
      RETURNING ${jobProjection
        .split(",")
        .map((column) => `job.${column.trim()}`)
        .join(", ")}
    `,
    [
      requireNonEmpty(input.jobId, "jobId"),
      requireNonEmpty(input.workerId, "workerId"),
      requireNonEmpty(input.error, "error"),
      input.retryAt ?? new Date().toISOString(),
    ],
  );

  return failed.rows[0] ? mapDurableJob(failed.rows[0]) : null;
}
