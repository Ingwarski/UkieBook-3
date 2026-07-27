import "server-only";

import type { DurableJob } from "../../platform/durable-jobs";
import type { JsonObject } from "../../platform/envelopes";
import type { SqlDatabase, SqlExecutor } from "../../platform/sql-port";
import type { DomainTransaction } from "../../platform/transaction";
import type { TransactionalEmailAdapter } from "../adapter";
import {
  NOTIFICATION_QUEUE,
  NOTIFICATION_SCHEMA_VERSION,
  PURCHASE_EMAIL_JOB_TYPE,
  PURCHASE_EMAIL_JOB_VERSION,
  type PurchaseEmailJobPayload,
  type PurchaseNotificationRequestedPayload,
} from "../types";

interface DeliveryRow extends Record<string, unknown> {
  id: string;
  order_id: string;
  paid_sale_id: string;
  buyer_user_id: string;
  status: "pending" | "sent";
}

interface EmailContextRow extends Record<string, unknown> {
  private_email: string | null;
  private_email_verified: boolean;
  title_snapshot: string;
  ordinal: number;
}

export async function requestPurchaseNotification(
  transaction: DomainTransaction,
  input: {
    readonly orderId: string;
    readonly paidSaleId: string;
    readonly buyerUserId: string;
    readonly correlationId: string;
  },
): Promise<PurchaseNotificationRequestedPayload> {
  // A paid sale has exactly one purchase notification, so its immutable UUID
  // is also a deterministic delivery identity across transaction retries.
  const deliveryId = input.paidSaleId;
  const event = await transaction.emit({
    aggregateId: input.orderId,
    aggregateType: "Order",
    correlationId: input.correlationId,
    eventType: "PurchaseNotificationRequested",
    eventVersion: 1,
    idempotencyKey: `notifications.purchase-requested:${input.orderId}`,
    payload: {
      buyerUserId: input.buyerUserId,
      deliveryId,
      orderId: input.orderId,
      paidSaleId: input.paidSaleId,
      schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    },
    topic: "notifications.purchase-requested.v1",
  });
  const inserted = await transaction.connection.query<DeliveryRow>(
    `
      INSERT INTO notifications_purchase_deliveries (
        id, order_id, paid_sale_id, buyer_user_id, request_event_id
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (order_id) DO NOTHING
      RETURNING id, order_id, paid_sale_id, buyer_user_id, status
    `,
    [deliveryId, input.orderId, input.paidSaleId, input.buyerUserId, event.id],
  );
  let delivery = inserted.rows[0];
  if (!delivery) {
    const existing = await transaction.connection.query<DeliveryRow>(
      `
        SELECT id, order_id, paid_sale_id, buyer_user_id, status
        FROM notifications_purchase_deliveries
        WHERE order_id = $1
      `,
      [input.orderId],
    );
    delivery = existing.rows[0];
  }
  if (
    !delivery ||
    delivery.paid_sale_id !== input.paidSaleId ||
    delivery.buyer_user_id !== input.buyerUserId
  ) {
    throw new Error("Purchase notification idempotency conflict");
  }
  const payload: PurchaseEmailJobPayload = {
    buyerUserId: input.buyerUserId,
    deliveryId: delivery.id,
    orderId: input.orderId,
    paidSaleId: input.paidSaleId,
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
  };
  await transaction.enqueue({
    correlationId: input.correlationId,
    idempotencyKey: `notifications.purchase-email:${delivery.id}`,
    jobType: PURCHASE_EMAIL_JOB_TYPE,
    jobVersion: PURCHASE_EMAIL_JOB_VERSION,
    maxAttempts: 8,
    payload: payload as unknown as JsonObject,
    queue: NOTIFICATION_QUEUE,
  });
  return payload;
}

function payloadFromJob(job: DurableJob): PurchaseEmailJobPayload {
  const payload = job.payload;
  if (
    job.jobType !== PURCHASE_EMAIL_JOB_TYPE ||
    payload.schemaVersion !== NOTIFICATION_SCHEMA_VERSION ||
    typeof payload.deliveryId !== "string" ||
    typeof payload.orderId !== "string" ||
    typeof payload.paidSaleId !== "string" ||
    typeof payload.buyerUserId !== "string"
  ) {
    throw new Error("Invalid purchase-email job payload");
  }
  return {
    buyerUserId: payload.buyerUserId,
    deliveryId: payload.deliveryId,
    orderId: payload.orderId,
    paidSaleId: payload.paidSaleId,
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
  };
}

async function loadEmailContext(
  executor: SqlExecutor,
  payload: PurchaseEmailJobPayload,
): Promise<{ readonly email: string; readonly titles: string[] } | "sent"> {
  const delivery = await executor.query<{
    buyer_user_id: string;
    order_id: string;
    paid_sale_id: string;
    status: "pending" | "sent";
  }>(
    `
      SELECT buyer_user_id, order_id, paid_sale_id, status
      FROM notifications_purchase_deliveries
      WHERE id = $1
    `,
    [payload.deliveryId],
  );
  const row = delivery.rows[0];
  if (
    !row ||
    row.order_id !== payload.orderId ||
    row.paid_sale_id !== payload.paidSaleId ||
    row.buyer_user_id !== payload.buyerUserId
  ) {
    throw new Error("Purchase-email delivery does not match its job");
  }
  if (row.status === "sent") return "sent";
  const context = await executor.query<EmailContextRow>(
    `
      SELECT
        users.private_email,
        users.private_email_verified,
        item.title_snapshot,
        item.ordinal
      FROM users
      JOIN commerce_orders orders ON orders.buyer_user_id = users.id
      JOIN commerce_order_items item ON item.order_id = orders.id
      WHERE users.id = $1 AND orders.id = $2
      ORDER BY item.ordinal
    `,
    [payload.buyerUserId, payload.orderId],
  );
  const first = context.rows[0];
  if (
    !first?.private_email ||
    !first.private_email_verified ||
    context.rows.some((candidate) => candidate.private_email !== first.private_email)
  ) {
    throw new Error("Buyer has no verified email for purchase notification");
  }
  return {
    email: first.private_email,
    titles: context.rows.map((candidate) => candidate.title_snapshot),
  };
}

export function createPurchaseEmailHandler(options: {
  readonly adapter: TransactionalEmailAdapter;
  readonly appOrigin: string;
  readonly database: SqlDatabase;
  readonly from: string;
}) {
  return async (
    job: DurableJob,
    context: { readonly signal: AbortSignal },
  ): Promise<void> => {
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    const payload = payloadFromJob(job);
    const emailContext = await loadEmailContext(options.database, payload);
    if (emailContext === "sent") return;
    const list = emailContext.titles.map((title) => `• ${title}`).join("\n");
    const receipt = await options.adapter.send({
      from: options.from,
      idempotencyKey: `purchase:${payload.deliveryId}`,
      subject: "Ваші книжки вже в бібліотеці · UkieBook",
      text:
        `Дякуємо за покупку!\n\n${list}\n\n` +
        `Відкрити бібліотеку: ${new URL("/library", options.appOrigin).toString()}`,
      to: emailContext.email,
    });
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    const updated = await options.database.query<{ id: string }>(
      `
        UPDATE notifications_purchase_deliveries
        SET status = 'sent',
            provider_message_id = $2,
            sent_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'pending'
        RETURNING id
      `,
      [payload.deliveryId, receipt.providerMessageId],
    );
    if (updated.rows.length === 0) {
      const current = await options.database.query<{ status: string }>(
        "SELECT status FROM notifications_purchase_deliveries WHERE id = $1",
        [payload.deliveryId],
      );
      if (current.rows[0]?.status !== "sent") {
        throw new Error("Purchase-email delivery state was lost");
      }
    }
  };
}
