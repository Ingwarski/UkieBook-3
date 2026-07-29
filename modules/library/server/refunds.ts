import "server-only";

import { randomUUID } from "node:crypto";

import { formatUah } from "../../catalog/price";
import type { JsonObject } from "../../platform/envelopes";
import type { SqlDatabase, SqlExecutor } from "../../platform/sql-port";
import { withDomainTransaction } from "../../platform/transaction";
import {
  LIBRARY_SCHEMA_VERSION,
  type RefundApprovedPayload,
  type RefundDecision,
  type RefundQueueItem,
  type RefundRequestStatus,
} from "../types";
import {
  appendEntitlementEvent,
  asInteger,
  LibraryConflictError,
  LibraryInputError,
  LibraryNotFoundError,
  requireIdempotencyKey,
  requireUuid,
} from "./common";

function requireRefundReason(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length < 10 || normalized.length > 2000) {
    throw new LibraryInputError(
      "REFUND_REASON",
      "Опишіть причину повернення: від 10 до 2000 символів.",
    );
  }
  return normalized;
}

export async function requestRefund(
  database: SqlDatabase,
  input: {
    readonly buyerUserId: string;
    readonly entitlementId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly refundRequestId: string; readonly status: RefundRequestStatus }> {
  const buyerUserId = requireUuid(input.buyerUserId, "buyerUserId");
  const entitlementId = requireUuid(input.entitlementId, "entitlementId");
  const reason = requireRefundReason(input.reason);
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  return withDomainTransaction(database, async (transaction) => {
    const entitlement = await transaction.connection.query<{
      book_id: string;
      id: string;
      status: "active" | "refunded";
    }>(
      `
        SELECT id, book_id, status
        FROM library_entitlements
        WHERE id = $1 AND buyer_user_id = $2
        FOR UPDATE
      `,
      [entitlementId, buyerUserId],
    );
    const owned = entitlement.rows[0];
    if (!owned || owned.status !== "active") {
      throw new LibraryNotFoundError();
    }
    const existing = await transaction.connection.query<{
      id: string;
      status: RefundRequestStatus;
    }>(
      "SELECT id, status FROM refund_requests WHERE entitlement_id = $1",
      [owned.id],
    );
    if (existing.rows[0]) {
      return { refundRequestId: existing.rows[0].id, status: existing.rows[0].status };
    }
    const refundRequestId = randomUUID();
    await transaction.connection.query(
      `
        INSERT INTO refund_requests (
          id, entitlement_id, buyer_user_id, book_id, reason
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [refundRequestId, owned.id, buyerUserId, owned.book_id, reason],
    );
    await appendEntitlementEvent(transaction.connection, {
      entitlementId: owned.id,
      eventType: "refund_requested",
      idempotencyKey: `library.refund-requested:${idempotencyKey}`,
      payload: { refundRequestId, reason },
    });
    await transaction.emit({
      aggregateId: refundRequestId,
      aggregateType: "RefundRequest",
      correlationId: owned.id,
      eventType: "RefundRequested",
      eventVersion: 1,
      idempotencyKey: `library.refund-requested-event:${idempotencyKey}`,
      payload: {
        buyerUserId,
        entitlementId: owned.id,
        refundRequestId,
        schemaVersion: LIBRARY_SCHEMA_VERSION,
      },
      topic: "commerce.refund-requested.v1",
    });
    return { refundRequestId, status: "pending" };
  });
}

export async function loadRefundQueue(
  database: SqlDatabase,
  options: { readonly includeDecided?: boolean } = {},
): Promise<readonly RefundQueueItem[]> {
  const result = await database.query<{
    id: string;
    entitlement_id: string;
    buyer_display_name: string;
    buyer_email: string | null;
    book_id: string;
    title_snapshot: string;
    reason: string;
    line_total_kopiykas: number | string;
    status: RefundRequestStatus;
    requested_at: Date | string;
  }>(
    `
      SELECT
        request.id, request.entitlement_id, request.book_id, request.reason,
        request.status, request.requested_at,
        COALESCE(users.private_display_name, 'Покупець') AS buyer_display_name,
        users.private_email AS buyer_email,
        item.title_snapshot, item.line_total_kopiykas
      FROM refund_requests request
      JOIN library_entitlements entitlement ON entitlement.id = request.entitlement_id
      JOIN commerce_order_items item ON item.id = entitlement.source_order_item_id
      JOIN users ON users.id = request.buyer_user_id
      WHERE ($1::boolean OR request.status = 'pending')
      ORDER BY request.requested_at ASC, request.id ASC
    `,
    [options.includeDecided ?? false],
  );
  return result.rows.map((row) => {
    const amountKopiykas = asInteger(row.line_total_kopiykas, "refund amount");
    return {
      amountKopiykas,
      bookId: row.book_id,
      buyerDisplayName: row.buyer_display_name,
      buyerEmail: row.buyer_email,
      entitlementId: row.entitlement_id,
      formattedAmount: formatUah(amountKopiykas),
      id: row.id,
      reason: row.reason,
      requestedAt: new Date(row.requested_at).toISOString(),
      status: row.status,
      title: row.title_snapshot,
    };
  });
}

async function requireManager(executor: SqlExecutor, userId: string): Promise<void> {
  const result = await executor.query<{ allowed: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'manager'
      ) AS allowed
    `,
    [requireUuid(userId, "managerUserId")],
  );
  if (!result.rows[0]?.allowed) {
    throw new LibraryInputError("MANAGER_REQUIRED", "Потрібна роль Менеджера.");
  }
}

export async function decideRefund(
  database: SqlDatabase,
  input: {
    readonly refundRequestId: string;
    readonly managerUserId: string;
    readonly decision: RefundDecision;
    readonly decisionNote: string;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly status: RefundRequestStatus; readonly compensationId: string | null }> {
  if (input.decision !== "approved" && input.decision !== "declined") {
    throw new LibraryInputError("REFUND_DECISION", "Некоректне рішення.");
  }
  const refundRequestId = requireUuid(input.refundRequestId, "refundRequestId");
  const managerUserId = requireUuid(input.managerUserId, "managerUserId");
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const decisionNote = input.decisionNote.replace(/\s+/gu, " ").trim().slice(0, 1200);
  return withDomainTransaction(database, async (transaction) => {
    await requireManager(transaction.connection, managerUserId);
    const request = await transaction.connection.query<{
      book_id: string;
      buyer_user_id: string;
      entitlement_id: string;
      entitlement_status: "active" | "refunded";
      id: string;
      paid_sale_id: string;
      source_order_item_id: string;
      status: RefundRequestStatus;
    }>(
      `
        SELECT
          request.id, request.entitlement_id, request.buyer_user_id, request.book_id,
          request.status, entitlement.status AS entitlement_status,
          entitlement.paid_sale_id, entitlement.source_order_item_id
        FROM refund_requests request
        JOIN library_entitlements entitlement ON entitlement.id = request.entitlement_id
        WHERE request.id = $1
        FOR UPDATE OF request, entitlement
      `,
      [refundRequestId],
    );
    const current = request.rows[0];
    if (!current) throw new LibraryNotFoundError("Refund request was not found");
    const existing = await transaction.connection.query<{
      decision: RefundDecision;
      id: string;
      idempotency_key: string;
      manager_user_id: string;
    }>(
      `
        SELECT id, decision, idempotency_key, manager_user_id
        FROM refund_decisions
        WHERE refund_request_id = $1
      `,
      [current.id],
    );
    const present = existing.rows[0];
    if (present) {
      if (
        present.decision === input.decision &&
        present.idempotency_key === idempotencyKey &&
        present.manager_user_id === managerUserId
      ) {
        const compensation = await transaction.connection.query<{ id: string }>(
          "SELECT id FROM refund_compensations WHERE refund_request_id = $1",
          [current.id],
        );
        return {
          compensationId: compensation.rows[0]?.id ?? null,
          status: input.decision,
        };
      }
      throw new LibraryConflictError("ALREADY_DECIDED", "Рішення вже зафіксовано.");
    }
    if (current.status !== "pending" || current.entitlement_status !== "active") {
      throw new LibraryConflictError("REQUEST_NOT_PENDING", "Заявку вже оброблено.");
    }
    const decisionId = randomUUID();
    await transaction.connection.query(
      `
        INSERT INTO refund_decisions (
          id, refund_request_id, manager_user_id, decision, decision_note, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [decisionId, current.id, managerUserId, input.decision, decisionNote, idempotencyKey],
    );
    await transaction.connection.query(
      `
        UPDATE refund_requests
        SET status = $2, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [current.id, input.decision],
    );
    if (input.decision === "declined") {
      await appendEntitlementEvent(transaction.connection, {
        entitlementId: current.entitlement_id,
        eventType: "refund_declined",
        idempotencyKey: `library.refund-declined:${decisionId}`,
        payload: { refundDecisionId: decisionId, refundRequestId: current.id },
      });
      return { compensationId: null, status: "declined" };
    }
    const orderItem = await transaction.connection.query<{
      line_total_kopiykas: number | string;
    }>(
      "SELECT line_total_kopiykas FROM commerce_order_items WHERE id = $1",
      [current.source_order_item_id],
    );
    const amountKopiykas = asInteger(
      orderItem.rows[0]?.line_total_kopiykas ?? -1,
      "refund amount",
    );
    if (amountKopiykas <= 0) throw new Error("Refund source order item is invalid");
    const compensationId = randomUUID();
    const approvedAt = new Date().toISOString();
    const payload: RefundApprovedPayload = {
      amountKopiykas,
      approvedAt,
      bookId: current.book_id,
      buyerUserId: current.buyer_user_id,
      currency: "UAH",
      entitlementId: current.entitlement_id,
      paidSaleId: current.paid_sale_id,
      refundCompensationId: compensationId,
      refundDecisionId: decisionId,
      refundRequestId: current.id,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
    };
    const event = await transaction.emit({
      aggregateId: current.id,
      aggregateType: "RefundRequest",
      correlationId: current.entitlement_id,
      eventType: "RefundApproved",
      eventVersion: 1,
      idempotencyKey: `commerce.refund-approved:${decisionId}`,
      payload: payload as unknown as JsonObject,
      topic: "commerce.refund-approved.v1",
    });
    await transaction.connection.query(
      `
        INSERT INTO refund_compensations (
          id, refund_request_id, refund_decision_id, entitlement_id, paid_sale_id,
          buyer_user_id, book_id, amount_kopiykas, refund_approved_event_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        compensationId,
        current.id,
        decisionId,
        current.entitlement_id,
        current.paid_sale_id,
        current.buyer_user_id,
        current.book_id,
        amountKopiykas,
        event.id,
      ],
    );
    await transaction.connection.query(
      `
        UPDATE library_entitlements
        SET status = 'refunded', refunded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'active'
      `,
      [current.entitlement_id],
    );
    await appendEntitlementEvent(transaction.connection, {
      entitlementId: current.entitlement_id,
      eventType: "refund_approved",
      idempotencyKey: `library.refund-approved:${decisionId}`,
      payload: {
        refundCompensationId: compensationId,
        refundDecisionId: decisionId,
        refundRequestId: current.id,
      },
    });
    return { compensationId, status: "approved" };
  });
}
