import "server-only";

import type { DurableJob } from "../../platform/durable-jobs";
import type { SqlDatabase } from "../../platform/sql-port";
import type { PrivateObjectStorage } from "../../publishing/storage/private-object-storage";
import type { AiModerationAdapter } from "../adapter";
import {
  MODERATION_JOB_TYPE,
  MODERATION_SCHEMA_VERSION,
  type ModerationScreeningJobPayload,
} from "../types";
import { screenModerationCase } from "./service";

function payloadFromJob(job: DurableJob): ModerationScreeningJobPayload {
  const payload = job.payload;
  if (
    job.jobType !== MODERATION_JOB_TYPE ||
    payload.schemaVersion !== MODERATION_SCHEMA_VERSION ||
    typeof payload.caseId !== "string"
  ) {
    throw new Error("Invalid moderation screening job payload");
  }
  return {
    caseId: payload.caseId,
    schemaVersion: MODERATION_SCHEMA_VERSION,
  };
}

export function createModerationScreeningHandler(options: {
  readonly adapter: AiModerationAdapter;
  readonly database: SqlDatabase;
  readonly storage: PrivateObjectStorage;
}) {
  return async (job: DurableJob, context: { readonly signal: AbortSignal }): Promise<void> => {
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    const payload = payloadFromJob(job);
    await screenModerationCase(
      options.database,
      options.storage,
      options.adapter,
      payload.caseId,
    );
  };
}
