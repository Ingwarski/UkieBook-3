import "server-only";

import { randomUUID } from "node:crypto";

import type { JsonObject } from "../../platform/envelopes";
import type { SqlExecutor } from "../../platform/sql-port";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class LibraryInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class LibraryConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class LibraryNotFoundError extends Error {
  constructor(message = "Library resource was not found") {
    super(message);
  }
}

export function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new LibraryInputError("INVALID_IDENTIFIER", `${field}: некоректний ідентифікатор.`);
  }
  return value;
}

export function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) {
    throw new LibraryInputError("IDEMPOTENCY_KEY", "Некоректний ключ операції.");
  }
  return normalized;
}

export function asInteger(value: number | string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} is not a non-negative safe integer`);
  }
  return parsed;
}

export function asIso(value: Date | string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is not a timestamp`);
  return date.toISOString();
}

export function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

export async function appendEntitlementEvent(
  executor: SqlExecutor,
  input: {
    readonly entitlementId: string;
    readonly eventType:
      | "created"
      | "version_resolved"
      | "refund_requested"
      | "refund_approved"
      | "refund_declined";
    readonly idempotencyKey: string;
    readonly payload: JsonObject;
  },
): Promise<void> {
  await executor.query(
    `
      INSERT INTO library_entitlement_events (
        id, entitlement_id, event_type, payload, idempotency_key
      ) VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (idempotency_key) DO NOTHING
    `,
    [
      randomUUID(),
      input.entitlementId,
      input.eventType,
      JSON.stringify(input.payload),
      input.idempotencyKey,
    ],
  );
}
