import { pathToFileURL } from "node:url";

import { openPostgresDatabase } from "../db/postgres";
import {
  enqueueDurableJob,
  type DurableJob,
} from "../modules/platform/durable-jobs";
import type { JsonObject } from "../modules/platform/envelopes";
import { readServerEnvironment } from "../modules/platform/environment/runtime";
import { readRuntimeIdentity } from "../modules/platform/runtime-identity";
import { PLATFORM_SCHEMA_REVISION } from "../modules/platform/schema-revision";
import type { SqlDatabase } from "../modules/platform/sql-port";

export const SCHEDULER_SCHEMA_REVISION = PLATFORM_SCHEMA_REVISION;

export interface ScheduledJobDefinition {
  readonly scheduleId: string;
  readonly queue: string;
  readonly jobType: string;
  readonly jobVersion?: number;
  readonly payload: JsonObject;
  readonly intervalMs: number;
  readonly maxAttempts?: number;
}

export interface SchedulerOptions {
  readonly database: SqlDatabase;
  readonly schedules: readonly ScheduledJobDefinition[];
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}

function requireInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("intervalMs must be a positive integer");
  }

  return value;
}

export async function enqueueScheduleSlot(
  database: SqlDatabase,
  schedule: ScheduledJobDefinition,
  now = new Date(),
): Promise<DurableJob> {
  const intervalMs = requireInterval(schedule.intervalMs);
  const slotStart = new Date(
    Math.floor(now.getTime() / intervalMs) * intervalMs,
  ).toISOString();

  return enqueueDurableJob(database, {
    queue: schedule.queue,
    jobType: schedule.jobType,
    jobVersion: schedule.jobVersion,
    payload: schedule.payload,
    idempotencyKey: `schedule:${schedule.scheduleId}:${slotStart}`,
    correlationId: `schedule:${schedule.scheduleId}:${slotStart}`,
    availableAt: slotStart,
    maxAttempts: schedule.maxAttempts,
  });
}

export async function runSchedulerOnce(
  options: Pick<SchedulerOptions, "database" | "schedules" | "now">,
): Promise<DurableJob[]> {
  const now = options.now?.() ?? new Date();
  return Promise.all(
    options.schedules.map((schedule) =>
      enqueueScheduleSlot(options.database, schedule, now),
    ),
  );
}

export async function runScheduler(options: SchedulerOptions): Promise<void> {
  while (!options.signal?.aborted) {
    await runSchedulerOnce(options);
    await new Promise((resolve) =>
      setTimeout(resolve, options.pollIntervalMs ?? 1_000),
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(readRuntimeIdentity("scheduler")));
    return;
  }

  const environment = readServerEnvironment();
  const database = openPostgresDatabase(environment.DATABASE_URL);
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runScheduler({
      database,
      schedules: [],
      pollIntervalMs: environment.SCHEDULER_TICK_MS,
      signal: abortController.signal,
    });
  } finally {
    await database.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
