import { pathToFileURL } from "node:url";

import { openPostgresDatabase } from "../db/postgres";
import {
  claimNextJob,
  completeDurableJob,
  failDurableJob,
  recoverExpiredJobs,
  renewDurableJobLease,
  type DurableJob,
} from "../modules/platform/durable-jobs";
import { readServerEnvironment } from "../modules/platform/environment/runtime";
import { readRuntimeIdentity } from "../modules/platform/runtime-identity";
import { PLATFORM_SCHEMA_REVISION } from "../modules/platform/schema-revision";
import type { SqlDatabase } from "../modules/platform/sql-port";
import { UnavailableAiModerationAdapter } from "../modules/moderation/adapter";
import { MODERATION_JOB_TYPE } from "../modules/moderation/types";
import { relayBookSubmittedEvents } from "../modules/moderation/server/service";
import { createModerationScreeningHandler } from "../modules/moderation/server/worker";
import { createPublishingConversionHandler } from "../modules/publishing/server/conversion-worker";
import { LocalPrivateObjectStorage } from "../modules/publishing/storage/private-object-storage";
import path from "node:path";

export interface DurableJobHandlerContext {
  /** Aborts if the worker loses its database lease. Handlers must check it
   * before committing any non-idempotent external side effect. */
  readonly signal: AbortSignal;
}

export type DurableJobHandler = (
  job: DurableJob,
  context: DurableJobHandlerContext,
) => Promise<void>;
export type DurableJobHandlers = Readonly<Record<string, DurableJobHandler>>;
export const WORKER_SCHEMA_REVISION = PLATFORM_SCHEMA_REVISION;

export interface WorkerOptions {
  readonly database: SqlDatabase;
  readonly queue: string;
  readonly workerId: string;
  readonly handlers: DurableJobHandlers;
  readonly pollIntervalMs?: number;
  readonly leaseSeconds?: number;
  readonly retryDelayMs?: number;
  readonly signal?: AbortSignal;
  readonly beforePoll?: () => Promise<void>;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function startLeaseHeartbeat(
  database: SqlDatabase,
  job: DurableJob,
  workerId: string,
  leaseSeconds: number,
  parentSignal?: AbortSignal,
): { readonly signal: AbortSignal; stop(): Promise<void> } {
  const controller = new AbortController();
  const abortFromParent = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason ?? new Error("Worker is stopping"));
    }
  };
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const intervalMilliseconds = Math.max(250, Math.floor((leaseSeconds * 1_000) / 3));
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    renewal = renewDurableJobLease(database, { jobId: job.id, workerId })
      .then((renewed) => {
        if (!renewed && !controller.signal.aborted) {
          controller.abort(new Error(`Worker ${workerId} lost the lease for ${job.id}`));
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          controller.abort(error);
        }
      });
  }, intervalMilliseconds);
  timer.unref?.();

  return {
    signal: controller.signal,
    async stop() {
      clearInterval(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
      await renewal;
    },
  };
}

export async function runWorkerOnce(
  options: Omit<WorkerOptions, "pollIntervalMs">,
): Promise<boolean> {
  await recoverExpiredJobs(options.database, {
    queue: options.queue,
    leaseSeconds: options.leaseSeconds ?? 60,
  });
  const job = await claimNextJob(options.database, {
    queue: options.queue,
    workerId: options.workerId,
  });

  if (!job) {
    return false;
  }

  const handler = Object.hasOwn(options.handlers, job.jobType)
    ? options.handlers[job.jobType]
    : undefined;
  if (typeof handler !== "function") {
    await failDurableJob(options.database, {
      jobId: job.id,
      workerId: options.workerId,
      error: `No handler registered for ${job.jobType}`,
      retryAt: new Date(
        Date.now() + (options.retryDelayMs ?? 5_000),
      ).toISOString(),
    });
    return true;
  }

  const leaseHeartbeat = startLeaseHeartbeat(
    options.database,
    job,
    options.workerId,
    options.leaseSeconds ?? 60,
    options.signal,
  );
  try {
    await handler(job, { signal: leaseHeartbeat.signal });
    await leaseHeartbeat.stop();
    if (leaseHeartbeat.signal.aborted) {
      throw leaseHeartbeat.signal.reason ?? new Error("Worker lease was lost");
    }
    const completed = await completeDurableJob(
      options.database,
      job.id,
      options.workerId,
    );

    if (!completed) {
      throw new Error(`Worker ${options.workerId} lost its claim on job ${job.id}`);
    }
  } catch (error) {
    await leaseHeartbeat.stop();
    await failDurableJob(options.database, {
      jobId: job.id,
      workerId: options.workerId,
      error: error instanceof Error ? error.message : String(error),
      retryAt: new Date(
        Date.now() + (options.retryDelayMs ?? 5_000),
      ).toISOString(),
    });
  }

  return true;
}

export async function runWorker(options: WorkerOptions): Promise<void> {
  while (!options.signal?.aborted) {
    await options.beforePoll?.();
    const handled = await runWorkerOnce(options);
    if (!handled) {
      await wait(options.pollIntervalMs ?? 500, options.signal);
    }
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(readRuntimeIdentity("worker")));
    return;
  }

  const environment = readServerEnvironment();
  const database = openPostgresDatabase(environment.DATABASE_URL);
  const storage = new LocalPrivateObjectStorage(
    path.isAbsolute(environment.PRIVATE_OBJECT_ROOT)
      ? environment.PRIVATE_OBJECT_ROOT
      : path.resolve(process.cwd(), environment.PRIVATE_OBJECT_ROOT),
  );
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runWorker({
      database,
      queue: process.env.WORKER_QUEUE ?? "publishing",
      workerId: environment.WORKER_ID,
      handlers: {
        "publishing.convert.v1": createPublishingConversionHandler({
          database,
          ebookConvertPath:
            environment.CALIBRE_EBOOK_CONVERT_PATH ??
            "/opt/calibre/ebook-convert-not-configured",
          storage,
        }),
        [MODERATION_JOB_TYPE]: createModerationScreeningHandler({
          adapter: new UnavailableAiModerationAdapter(),
          database,
          storage,
        }),
      },
      beforePoll: async () => {
        await relayBookSubmittedEvents(database, { limit: 25 });
      },
      leaseSeconds: environment.JOB_LEASE_SECONDS,
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
