import "server-only";

import type { PaidSalePayload } from "../../commerce/types";
import type { SqlDatabase } from "../../platform/sql-port";
import { withDomainTransaction } from "../../platform/transaction";
import { appendEntitlementEvent, asInteger, asIso, LibraryInputError, parsePayload, requireUuid } from "./common";

interface PaidSaleEventRow extends Record<string, unknown> {
  readonly correlation_id: string;
  readonly id: string;
  readonly payload: unknown;
}

interface EntitlementCheckRow extends Record<string, unknown> {
  readonly id: string;
  readonly buyer_user_id: string;
  readonly book_id: string;
  readonly paid_sale_id: string;
  readonly source_book_version_id: string;
}

function parsePaidSalePayload(value: unknown): PaidSalePayload {
  const raw = parsePayload(value);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("schemaVersion" in raw) ||
    !("paidSaleId" in raw) ||
    !("orderId" in raw) ||
    !("buyerUserId" in raw) ||
    !("paymentSessionId" in raw) ||
    !("provider" in raw) ||
    !("providerInvoiceId" in raw) ||
    !("currency" in raw) ||
    !("totalKopiykas" in raw) ||
    !("paidAt" in raw) ||
    !("items" in raw) ||
    raw.schemaVersion !== 1 ||
    typeof raw.paidSaleId !== "string" ||
    typeof raw.orderId !== "string" ||
    typeof raw.buyerUserId !== "string" ||
    typeof raw.paymentSessionId !== "string" ||
    raw.provider !== "mono" ||
    typeof raw.providerInvoiceId !== "string" ||
    raw.currency !== "UAH" ||
    typeof raw.totalKopiykas !== "number" ||
    !Number.isSafeInteger(raw.totalKopiykas) ||
    raw.totalKopiykas <= 0 ||
    typeof raw.paidAt !== "string" ||
    !Array.isArray(raw.items) ||
    raw.items.length === 0
  ) {
    throw new Error("PaidSale payload is invalid");
  }
  requireUuid(raw.paidSaleId, "paidSaleId");
  requireUuid(raw.orderId, "orderId");
  requireUuid(raw.buyerUserId, "buyerUserId");
  requireUuid(raw.paymentSessionId, "paymentSessionId");
  asIso(raw.paidAt, "paidAt");
  const items = raw.items.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("orderItemId" in item) ||
      !("bookId" in item) ||
      !("bookVersionId" in item) ||
      !("authorId" in item) ||
      !("quantity" in item) ||
      !("paidPriceKopiykas" in item) ||
      typeof item.orderItemId !== "string" ||
      typeof item.bookId !== "string" ||
      typeof item.bookVersionId !== "string" ||
      typeof item.authorId !== "string" ||
      item.quantity !== 1 ||
      !Number.isSafeInteger(item.paidPriceKopiykas) ||
      item.paidPriceKopiykas < 0
    ) {
      throw new Error("PaidSale item is invalid");
    }
    requireUuid(item.orderItemId, "orderItemId");
    requireUuid(item.bookId, "bookId");
    requireUuid(item.bookVersionId, "bookVersionId");
    requireUuid(item.authorId, "authorId");
    return item;
  });
  return { ...raw, items } as PaidSalePayload;
}

export async function relayPaidSaleEntitlements(
  database: SqlDatabase,
  options: { readonly limit?: number } = {},
): Promise<readonly string[]> {
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new LibraryInputError("LIMIT", "Некоректний ліміт обробки.");
  }
  const entitlementIds: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const produced = await withDomainTransaction(database, async (transaction) => {
      const result = await transaction.connection.query<PaidSaleEventRow>(`
        SELECT id, correlation_id, payload
        FROM outbox_events
        WHERE event_type = 'PaidSale'
          AND event_version = 1
          AND published_at IS NULL
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const event = result.rows[0];
      if (!event) return null;
      const payload = parsePaidSalePayload(event.payload);
      const sale = await transaction.connection.query<{
        buyer_user_id: string;
        currency: string;
        id: string;
        order_id: string;
        paid_at: Date | string;
        payment_session_id: string;
        provider_invoice_id: string;
        total_kopiykas: number | string;
      }>(
        `
          SELECT
            sale.id, sale.order_id, sale.payment_session_id, sale.provider_invoice_id,
            sale.total_kopiykas, sale.currency, sale.paid_at, orders.buyer_user_id
          FROM commerce_paid_sales sale
          JOIN commerce_orders orders ON orders.id = sale.order_id
          WHERE sale.id = $1
            AND orders.id = $2
            AND orders.status = 'paid'
        `,
        [payload.paidSaleId, payload.orderId],
      );
      const storedSale = sale.rows[0];
      if (
        !storedSale ||
        storedSale.buyer_user_id !== payload.buyerUserId ||
        storedSale.payment_session_id !== payload.paymentSessionId ||
        storedSale.provider_invoice_id !== payload.providerInvoiceId ||
        storedSale.currency !== payload.currency ||
        asInteger(storedSale.total_kopiykas, "paid sale total") !== payload.totalKopiykas ||
        asIso(storedSale.paid_at, "paid sale date") !== asIso(payload.paidAt, "payload date")
      ) {
        throw new Error("PaidSale does not match its immutable commerce records");
      }

      const created: string[] = [];
      for (const item of payload.items) {
        const storedItem = await transaction.connection.query<{
          author_id: string;
          book_id: string;
          book_version_id: string;
          id: string;
          line_total_kopiykas: number | string;
          order_id: string;
          quantity: number;
        }>(
          `
            SELECT id, order_id, book_id, book_version_id, author_id, quantity, line_total_kopiykas
            FROM commerce_order_items
            WHERE id = $1
          `,
          [item.orderItemId],
        );
        const stored = storedItem.rows[0];
        if (
          !stored ||
          stored.order_id !== payload.orderId ||
          stored.book_id !== item.bookId ||
          stored.book_version_id !== item.bookVersionId ||
          stored.author_id !== item.authorId ||
          stored.quantity !== item.quantity ||
          asInteger(stored.line_total_kopiykas, "order item total") !== item.paidPriceKopiykas
        ) {
          throw new Error("PaidSale item does not match its immutable order item");
        }
        const inserted = await transaction.connection.query<{ id: string }>(
          `
            INSERT INTO library_entitlements (
              id, buyer_user_id, book_id, paid_sale_id, source_order_item_id,
              source_book_version_id
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (source_order_item_id) DO NOTHING
            RETURNING id
          `,
          [
            crypto.randomUUID(),
            payload.buyerUserId,
            item.bookId,
            payload.paidSaleId,
            item.orderItemId,
            item.bookVersionId,
          ],
        );
        let entitlementId = inserted.rows[0]?.id;
        if (!entitlementId) {
          const existing = await transaction.connection.query<EntitlementCheckRow>(
            `
              SELECT id, buyer_user_id, book_id, paid_sale_id, source_book_version_id
              FROM library_entitlements
              WHERE source_order_item_id = $1
            `,
            [item.orderItemId],
          );
          const recovered = existing.rows[0];
          if (
            !recovered ||
            recovered.buyer_user_id !== payload.buyerUserId ||
            recovered.book_id !== item.bookId ||
            recovered.paid_sale_id !== payload.paidSaleId ||
            recovered.source_book_version_id !== item.bookVersionId
          ) {
            throw new Error("Library entitlement idempotency conflict");
          }
          entitlementId = recovered.id;
        }
        await appendEntitlementEvent(transaction.connection, {
          entitlementId,
          eventType: "created",
          idempotencyKey: `library.entitlement-created:${item.orderItemId}`,
          payload: {
            bookId: item.bookId,
            buyerUserId: payload.buyerUserId,
            paidSaleId: payload.paidSaleId,
            sourceBookVersionId: item.bookVersionId,
          },
        });
        created.push(entitlementId);
      }
      await transaction.connection.query(
        `
          UPDATE outbox_events
          SET published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
              publish_attempts = publish_attempts + 1,
              last_error = NULL
          WHERE id = $1
        `,
        [event.id],
      );
      return created;
    });
    if (!produced) break;
    entitlementIds.push(...produced);
  }
  return entitlementIds;
}
