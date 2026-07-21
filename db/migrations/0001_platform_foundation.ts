import { createHash } from "node:crypto";

import type { Migration } from "./types";
import { runStatements } from "./types";
import { PLATFORM_SCHEMA_REVISION } from "../../modules/platform/schema-revision";

const upStatements = [
  `
    CREATE TABLE outbox_events (
      id UUID PRIMARY KEY,
      topic TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL CHECK (event_version > 0),
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      correlation_id TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      published_at TIMESTAMPTZ,
      publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
      last_error TEXT
    )
  `,
  `
    CREATE INDEX outbox_events_unpublished_idx
      ON outbox_events (created_at, id)
      WHERE published_at IS NULL
  `,
  `
    CREATE TABLE durable_jobs (
      id UUID PRIMARY KEY,
      queue TEXT NOT NULL,
      job_type TEXT NOT NULL,
      job_version INTEGER NOT NULL CHECK (job_version > 0),
      payload JSONB NOT NULL,
      idempotency_key TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'dead_letter')),
      available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
      locked_at TIMESTAMPTZ,
      locked_by TEXT,
      completed_at TIMESTAMPTZ,
      dead_lettered_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (queue, idempotency_key)
    )
  `,
  `
    CREATE INDEX durable_jobs_claim_idx
      ON durable_jobs (queue, status, available_at, created_at, id)
      WHERE status = 'pending'
  `,
] as const;

const downStatements = [
  "DROP TABLE IF EXISTS durable_jobs",
  "DROP TABLE IF EXISTS outbox_events",
] as const;

export const platformFoundationMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: PLATFORM_SCHEMA_REVISION,
        up: upStatements,
      }),
    )
    .digest("hex"),
  id: PLATFORM_SCHEMA_REVISION,
  up: (connection) => runStatements(connection, upStatements),
  down: (connection) => runStatements(connection, downStatements),
};
