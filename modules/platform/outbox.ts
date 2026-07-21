import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { SqlExecutor, SqlRow } from "./sql-port";
import {
  type JsonObject,
  requireNonEmpty,
  requirePositiveInteger,
  toIsoTimestamp,
} from "./envelopes";

export interface OutboxEventInput {
  readonly topic: string;
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: JsonObject;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly occurredAt?: string;
}

export interface OutboxEvent {
  readonly id: string;
  readonly topic: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: JsonObject;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

interface OutboxRow extends SqlRow {
  id: string;
  topic: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: JsonObject;
  idempotency_key: string;
  correlation_id: string;
  occurred_at: string | Date;
  created_at: string | Date;
  published_at: string | Date | null;
}

const outboxProjection = `
  id,
  topic,
  event_type,
  event_version,
  aggregate_type,
  aggregate_id,
  payload,
  idempotency_key,
  correlation_id,
  occurred_at,
  created_at,
  published_at
`;

function mapOutboxEvent(row: OutboxRow): OutboxEvent {
  const occurredAt = toIsoTimestamp(row.occurred_at);
  const createdAt = toIsoTimestamp(row.created_at);

  if (!occurredAt || !createdAt) {
    throw new Error(`Outbox event ${row.id} has an invalid timestamp`);
  }

  return {
    id: row.id,
    topic: row.topic,
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    occurredAt,
    createdAt,
    publishedAt: toIsoTimestamp(row.published_at),
  };
}

export async function appendOutboxEvent(
  connection: SqlExecutor,
  input: OutboxEventInput,
): Promise<OutboxEvent> {
  const eventVersion = requirePositiveInteger(
    input.eventVersion ?? 1,
    "eventVersion",
  );
  const idempotencyKey = requireNonEmpty(
    input.idempotencyKey,
    "idempotencyKey",
  );
  const values = [
    randomUUID(),
    requireNonEmpty(input.topic, "topic"),
    requireNonEmpty(input.eventType, "eventType"),
    eventVersion,
    requireNonEmpty(input.aggregateType, "aggregateType"),
    requireNonEmpty(input.aggregateId, "aggregateId"),
    JSON.stringify(input.payload),
    idempotencyKey,
    requireNonEmpty(input.correlationId, "correlationId"),
    input.occurredAt ?? new Date().toISOString(),
  ] as const;

  const inserted = await connection.query<OutboxRow>(
    `
      INSERT INTO outbox_events (
        id, topic, event_type, event_version, aggregate_type, aggregate_id,
        payload, idempotency_key, correlation_id, occurred_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING ${outboxProjection}
    `,
    values,
  );

  if (inserted.rows[0]) {
    return mapOutboxEvent(inserted.rows[0]);
  }

  const existing = await connection.query<OutboxRow>(
    `SELECT ${outboxProjection} FROM outbox_events WHERE idempotency_key = $1`,
    [idempotencyKey],
  );

  if (!existing.rows[0]) {
    throw new Error(`Unable to recover outbox event ${idempotencyKey}`);
  }

  const recovered = mapOutboxEvent(existing.rows[0]);
  const requestedOccurredAt = input.occurredAt
    ? new Date(input.occurredAt).toISOString()
    : undefined;
  const conflicts = [
    recovered.topic !== input.topic && "topic",
    recovered.eventType !== input.eventType && "eventType",
    recovered.eventVersion !== (input.eventVersion ?? 1) && "eventVersion",
    recovered.aggregateType !== input.aggregateType && "aggregateType",
    recovered.aggregateId !== input.aggregateId && "aggregateId",
    !isDeepStrictEqual(recovered.payload, input.payload) && "payload",
    recovered.correlationId !== input.correlationId && "correlationId",
    requestedOccurredAt !== undefined &&
      recovered.occurredAt !== requestedOccurredAt &&
      "occurredAt",
  ].filter((field): field is string => Boolean(field));

  if (conflicts.length > 0) {
    throw new Error(
      `Outbox idempotency conflict for ${idempotencyKey}: ${conflicts.join(", ")}`,
    );
  }

  return recovered;
}
