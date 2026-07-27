import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  CapturedEmailAdapter,
  type TransactionalEmailAdapter,
} from "../modules/notifications/adapter";
import { createPurchaseEmailHandler } from "../modules/notifications/server/service";
import {
  NOTIFICATION_QUEUE,
  PURCHASE_EMAIL_JOB_TYPE,
} from "../modules/notifications/types";
import {
  CommerceConflictError,
  addCartItem,
  createPaymentReconciliationHandler,
  loadCart,
  mergeAnonymousCart,
  processMonoWebhook,
  startCheckout,
} from "../modules/commerce/server/service";
import {
  UnavailablePaymentProviderAdapter,
  type PaymentProviderAdapter,
} from "../modules/commerce/adapter";
import { MonoPaymentAdapter } from "../modules/commerce/mono-adapter";
import {
  COMMERCE_QUEUE,
  PAYMENT_RECONCILIATION_JOB_TYPE,
} from "../modules/commerce/types";
import { PLATFORM_SCHEMA_REVISION } from "../modules/platform/schema-revision";
import { runWorkerOnce } from "../workers/worker";
import {
  UNIT05_EXPECTED_CART_TOTAL_KOPIYKAS,
  UNIT05_FIXTURE_BOOKS,
  UNIT05_FIXTURE_IDS,
} from "../tests/fixtures/commerce/unit05-fixtures";
import { startMonoProviderSimulator } from "./mono-provider-simulator";
import { requireDedicatedUnit05DatabaseUrl } from "./unit05-database-guard";

const databaseUrl = requireDedicatedUnit05DatabaseUrl(
  process.env.UNIT05_DATABASE_URL,
);
const database = openPostgresDatabase(databaseUrl);
const merchantToken = "unit05-postgres-merchant-token";
const controlToken = "unit05-postgres-control-token";
const thirdBuyerId = "50505050-5050-4050-8050-505050509003";
const rollbackBuyerId = "50505050-5050-4050-8050-505050509004";
const resilienceBuyerId = "50505050-5050-4050-8050-505050509005";
const mismatchBuyerId = "50505050-5050-4050-8050-505050509006";
const serializationBuyerId = "50505050-5050-4050-8050-505050509007";
const missingDateBuyerId = "50505050-5050-4050-8050-505050509008";
const equalTimestampBuyerId = "50505050-5050-4050-8050-505050509009";
const misroutingBuyerId = "50505050-5050-4050-8050-505050509010";

interface CapturedWebhook {
  readonly body: Buffer;
  readonly signature: string;
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const capturedWebhooks: CapturedWebhook[] = [];
const webhookReceiver = createServer(async (request, response) => {
  if (
    request.method !== "POST" ||
    request.url !== "/api/payments/mono/webhook"
  ) {
    response.writeHead(404).end();
    return;
  }
  capturedWebhooks.push({
    body: await readRawBody(request),
    signature: String(request.headers["x-sign"] ?? ""),
  });
  response.writeHead(200).end();
});
await new Promise<void>((resolve, reject) => {
  webhookReceiver.once("error", reject);
  webhookReceiver.listen(0, "127.0.0.1", () => {
    webhookReceiver.off("error", reject);
    resolve();
  });
});
const receiverAddress = webhookReceiver.address();
if (!receiverAddress || typeof receiverAddress === "string") {
  throw new Error("UNIT-05 webhook receiver did not bind");
}
const appOrigin = `http://127.0.0.1:${receiverAddress.port}`;
const simulator = await startMonoProviderSimulator({
  controlToken,
  merchantToken,
});
const provider = new MonoPaymentAdapter({
  allowInsecureLoopback: true,
  apiOrigin: simulator.origin,
  merchantToken,
  publicKeyBase64: simulator.publicKeyBase64,
});

async function controlInvoice(
  invoiceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `${simulator.origin}/__control/invoices/${invoiceId}/status`,
    {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "X-Unit05-Control-Token": controlToken,
      },
      method: "POST",
    },
  );
  assert.equal(response.status, 200);
}

function webhookFor(invoiceId: string): CapturedWebhook {
  const result = [...capturedWebhooks]
    .reverse()
    .find((candidate) => {
      try {
        const payload = JSON.parse(candidate.body.toString("utf8")) as {
          readonly invoiceId?: unknown;
        };
        return payload.invoiceId === invoiceId;
      } catch {
        return false;
      }
    });
  if (!result) throw new Error(`Webhook for ${invoiceId} was not captured`);
  return result;
}

async function checkoutFor(
  buyerUserId: string,
  bookIds: readonly string[],
) {
  for (const bookId of bookIds) {
    await addCartItem(database, { bookId, buyerUserId });
  }
  return startCheckout({
    appOrigin,
    buyerUserId,
    database,
    provider,
    reconciliationIntervalMs: 1_000,
    validitySeconds: 3_600,
  });
}

async function processCaptured(invoiceId: string) {
  const webhook = webhookFor(invoiceId);
  return processMonoWebhook({
    database,
    maxBodyBytes: 65_536,
    provider,
    rawBody: webhook.body,
    signature: webhook.signature,
  });
}

async function assertImmutableMutation(
  sql: string,
  parameters: readonly unknown[],
): Promise<void> {
  await assert.rejects(
    database.query(sql, parameters),
    /append-only|immutable/u,
  );
}

async function createBuyer(
  buyerUserId: string,
  email: string,
  displayName: string,
): Promise<void> {
  await database.query(
    `
      INSERT INTO users (
        id, private_email, private_email_verified, private_display_name
      ) VALUES ($1, $2, TRUE, $3)
    `,
    [buyerUserId, email, displayName],
  );
  await database.query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'buyer')",
    [buyerUserId],
  );
}

async function createManualOrder(input: {
  readonly buyerUserId: string;
  readonly cartId: string;
  readonly itemId: string;
  readonly orderId: string;
  readonly orderTotalKopiykas: number;
  readonly sourceOrderId: string;
}): Promise<void> {
  await database.query(
    `
      INSERT INTO commerce_carts (
        id, buyer_user_id, status, revision
      ) VALUES ($1, $2, 'checkout_pending', 1)
    `,
    [input.cartId, input.buyerUserId],
  );
  await database.query(
    `
      INSERT INTO commerce_orders (
        id, buyer_user_id, cart_id, cart_revision, reference,
        status, currency, total_kopiykas
      ) VALUES (
        $1, $2, $3, 1, $4, 'payment_pending', 'UAH', $5
      )
    `,
    [
      input.orderId,
      input.buyerUserId,
      input.cartId,
      `unit05-manual-${input.orderId}`,
      input.orderTotalKopiykas,
    ],
  );
  const inserted = await database.query(
    `
      INSERT INTO commerce_order_items (
        id, order_id, ordinal, book_id, book_version_id, author_id,
        title_snapshot, author_public_name_snapshot, cover_path_snapshot,
        quantity, base_price_kopiykas, discount_kopiykas,
        unit_price_kopiykas, line_total_kopiykas
      )
      SELECT
        $1, $2, 1, book_id, book_version_id, author_id,
        title_snapshot, author_public_name_snapshot, cover_path_snapshot,
        quantity, base_price_kopiykas, discount_kopiykas,
        unit_price_kopiykas, line_total_kopiykas
      FROM commerce_order_items
      WHERE order_id = $3
      ORDER BY ordinal
      LIMIT 1
    `,
    [input.itemId, input.orderId, input.sourceOrderId],
  );
  assert.equal(inserted.rowCount, 1);
}

try {
  await database.query("DROP SCHEMA public CASCADE");
  await database.query("CREATE SCHEMA public");
  await applyMigrations(database);
  const firstApplied = await listAppliedMigrations(database);
  assert.equal(firstApplied.at(-1)?.id, PLATFORM_SCHEMA_REVISION);
  await rollbackLatestMigration(database);
  const rolledBack = await listAppliedMigrations(database);
  assert.notEqual(rolledBack.at(-1)?.id, PLATFORM_SCHEMA_REVISION);
  await applyMigrations(database);
  const reapplied = await listAppliedMigrations(database);
  assert.equal(reapplied.at(-1)?.id, PLATFORM_SCHEMA_REVISION);

  process.env.APP_ENV = "test";
  process.env.UNIT05_ALLOW_FIXTURE_SEED = "1";
  await import("./seed-unit05-e2e");

  const firstGuestItem = await addCartItem(database, {
    bookId: UNIT05_FIXTURE_IDS.books.discounted,
  });
  assert.ok(firstGuestItem.anonymousToken);
  const anonymousToken = firstGuestItem.anonymousToken;
  await addCartItem(database, {
    anonymousToken,
    bookId: UNIT05_FIXTURE_IDS.books.fullPrice,
  });
  await addCartItem(database, {
    anonymousToken,
    bookId: UNIT05_FIXTURE_IDS.books.discounted,
  });
  const guestCart = await loadCart(database, { anonymousToken });
  assert.equal(guestCart?.items.length, 2);
  assert.equal(guestCart?.totalKopiykas, UNIT05_EXPECTED_CART_TOTAL_KOPIYKAS);
  const storedAnonymous = await database.query<{
    anonymous_token_digest: string;
  }>(
    `
      SELECT anonymous_token_digest
      FROM commerce_carts
      WHERE anonymous_token_digest IS NOT NULL
      ORDER BY created_at
      LIMIT 1
    `,
  );
  assert.match(
    storedAnonymous.rows[0]?.anonymous_token_digest ?? "",
    /^[0-9a-f]{64}$/u,
  );
  assert.notEqual(
    storedAnonymous.rows[0]?.anonymous_token_digest,
    anonymousToken,
  );

  const merged = await mergeAnonymousCart(database, {
    anonymousToken,
    buyerUserId: UNIT05_FIXTURE_IDS.buyerUserId,
  });
  assert.equal(merged?.items.length, 2);
  const mergedRows = await database.query<{
    buyer_open: number;
    guest_merged: number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE buyer_user_id = $1 AND status = 'active'
        )::int AS buyer_open,
        COUNT(*) FILTER (
          WHERE anonymous_token_digest IS NOT NULL AND status = 'merged'
        )::int AS guest_merged
      FROM commerce_carts
    `,
    [UNIT05_FIXTURE_IDS.buyerUserId],
  );
  assert.deepEqual(mergedRows.rows[0], {
    buyer_open: 1,
    guest_merged: 1,
  });

  await assert.rejects(
    addCartItem(database, {
      bookId: UNIT05_FIXTURE_IDS.books.unavailable,
      buyerUserId: UNIT05_FIXTURE_IDS.buyerUserId,
    }),
    (error: unknown) =>
      error instanceof CommerceConflictError &&
      error.code === "BOOK_UNAVAILABLE",
  );

  const primaryCheckout = await startCheckout({
    appOrigin,
    buyerUserId: UNIT05_FIXTURE_IDS.buyerUserId,
    database,
    provider,
    reconciliationIntervalMs: 1_000,
    validitySeconds: 3_600,
  });
  assert.equal(
    primaryCheckout.order.totalKopiykas,
    UNIT05_EXPECTED_CART_TOTAL_KOPIYKAS,
  );
  assert.equal(primaryCheckout.order.items.length, 2);
  assert.ok(primaryCheckout.paymentSession.providerInvoiceId);
  const primaryInvoiceId =
    primaryCheckout.paymentSession.providerInvoiceId as string;
  const repeatedPrimaryCheckout = await startCheckout({
    appOrigin,
    buyerUserId: UNIT05_FIXTURE_IDS.buyerUserId,
    database,
    provider,
    reconciliationIntervalMs: 1_000,
    validitySeconds: 3_600,
  });
  assert.equal(repeatedPrimaryCheckout.order.id, primaryCheckout.order.id);
  assert.equal(
    repeatedPrimaryCheckout.paymentSession.id,
    primaryCheckout.paymentSession.id,
  );
  assert.equal(
    repeatedPrimaryCheckout.paymentSession.providerInvoiceId,
    primaryInvoiceId,
  );

  const simulatorInvoices = await fetch(
    `${simulator.origin}/__control/invoices`,
    { headers: { "X-Unit05-Control-Token": controlToken } },
  ).then((response) =>
    response.json() as Promise<{ readonly invoices: readonly unknown[] }>,
  );
  assert.equal(simulatorInvoices.invoices.length, 1);

  await database.query(
    `
      UPDATE catalog_book_read_models
      SET discount_price_kopiykas = 9900
      WHERE book_id = $1
    `,
    [UNIT05_FIXTURE_IDS.books.discounted],
  );
  const immutableSnapshot = await database.query<{
    line_total_kopiykas: number;
    title_snapshot: string;
  }>(
    `
      SELECT title_snapshot, line_total_kopiykas::int
      FROM commerce_order_items
      WHERE order_id = $1
      ORDER BY ordinal
    `,
    [primaryCheckout.order.id],
  );
  assert.deepEqual(immutableSnapshot.rows, [
    {
      line_total_kopiykas:
        UNIT05_FIXTURE_BOOKS.discounted.actualPriceKopiykas,
      title_snapshot: UNIT05_FIXTURE_BOOKS.discounted.title,
    },
    {
      line_total_kopiykas: UNIT05_FIXTURE_BOOKS.fullPrice.actualPriceKopiykas,
      title_snapshot: UNIT05_FIXTURE_BOOKS.fullPrice.title,
    },
  ]);

  await controlInvoice(primaryInvoiceId, { status: "success" });
  const applied = await processCaptured(primaryInvoiceId);
  assert.equal(applied.applied, true);
  assert.equal(applied.duplicate, false);
  const duplicate = await processCaptured(primaryInvoiceId);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.duplicate, true);

  const observationsBeforeForgery = await database.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM commerce_payment_observations observation
      JOIN commerce_payment_sessions payment
        ON payment.id = observation.payment_session_id
      WHERE payment.order_id = $1
    `,
    [primaryCheckout.order.id],
  );
  const signed = webhookFor(primaryInvoiceId);
  await assert.rejects(
    processMonoWebhook({
      database,
      maxBodyBytes: 65_536,
      provider,
      rawBody: signed.body,
      signature: "forged-unit05-signature",
    }),
    /signature/u,
  );
  const observationsAfterForgery = await database.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM commerce_payment_observations observation
      JOIN commerce_payment_sessions payment
        ON payment.id = observation.payment_session_id
      WHERE payment.order_id = $1
    `,
    [primaryCheckout.order.id],
  );
  assert.equal(
    observationsAfterForgery.rows[0]?.count,
    observationsBeforeForgery.rows[0]?.count,
  );

  await controlInvoice(primaryInvoiceId, {
    modifiedDate: "2026-01-01T00:00:00.000Z",
    status: "processing",
  });
  const stale = await processCaptured(primaryInvoiceId);
  assert.equal(stale.applied, false);
  const afterStale = await database.query<{
    order_status: string;
    payment_status: string;
  }>(
    `
      SELECT orders.status AS order_status, payment.status AS payment_status
      FROM commerce_orders orders
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [primaryCheckout.order.id],
  );
  assert.deepEqual(afterStale.rows[0], {
    order_status: "paid",
    payment_status: "success",
  });

  const paidState = await database.query<{
    notification_requests: number;
    paid_orders: number;
    paid_sale_events: number;
    paid_sales: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM commerce_orders
           WHERE id = $1 AND status = 'paid') AS paid_orders,
        (SELECT COUNT(*)::int FROM commerce_paid_sales
           WHERE order_id = $1) AS paid_sales,
        (SELECT COUNT(*)::int FROM outbox_events
           WHERE aggregate_id = $1::uuid::text
             AND event_type = 'PaidSale') AS paid_sale_events,
        (SELECT COUNT(*)::int FROM outbox_events
           WHERE aggregate_id = $1::uuid::text
             AND event_type = 'PurchaseNotificationRequested') AS notification_requests
    `,
    [primaryCheckout.order.id],
  );
  assert.deepEqual(paidState.rows[0], {
    notification_requests: 1,
    paid_orders: 1,
    paid_sale_events: 1,
    paid_sales: 1,
  });

  await createBuyer(
    rollbackBuyerId,
    "rollback-unit05@example.invalid",
    "Buyer Rollback",
  );
  const rollbackCheckout = await checkoutFor(rollbackBuyerId, [
    UNIT05_FIXTURE_IDS.books.fullPrice,
  ]);
  const rollbackInvoiceId =
    rollbackCheckout.paymentSession.providerInvoiceId as string;
  await controlInvoice(rollbackInvoiceId, {
    deliverWebhook: true,
    status: "success",
  });
  await database.query(`
    CREATE FUNCTION unit05_reject_paid_sale_outbox()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.event_type = 'PaidSale' THEN
        RAISE EXCEPTION 'unit05 paid-sale outbox rollback injection';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await database.query(`
    CREATE TRIGGER unit05_reject_paid_sale_outbox
      BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION unit05_reject_paid_sale_outbox()
  `);
  try {
    await assert.rejects(
      processCaptured(rollbackInvoiceId),
      /paid-sale outbox rollback injection/u,
    );
  } finally {
    await database.query(
      "DROP TRIGGER IF EXISTS unit05_reject_paid_sale_outbox ON outbox_events",
    );
    await database.query(
      "DROP FUNCTION IF EXISTS unit05_reject_paid_sale_outbox()",
    );
  }
  const rolledBackPaidSale = await database.query<{
    cart_status: string;
    notification_deliveries: number;
    notification_events: number;
    observations: number;
    order_status: string;
    paid_sale_events: number;
    paid_sales: number;
    payment_status: string;
  }>(
    `
      SELECT
        orders.status AS order_status,
        cart.status AS cart_status,
        payment.status AS payment_status,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id) AS observations,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int FROM outbox_events event
           WHERE event.aggregate_id = orders.id::text
             AND event.event_type = 'PaidSale') AS paid_sale_events,
        (SELECT COUNT(*)::int FROM outbox_events event
           WHERE event.aggregate_id = orders.id::text
             AND event.event_type = 'PurchaseNotificationRequested')
          AS notification_events,
        (SELECT COUNT(*)::int FROM notifications_purchase_deliveries delivery
           WHERE delivery.order_id = orders.id) AS notification_deliveries
      FROM commerce_orders orders
      JOIN commerce_carts cart ON cart.id = orders.cart_id
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [rollbackCheckout.order.id],
  );
  assert.deepEqual(rolledBackPaidSale.rows[0], {
    cart_status: "checkout_pending",
    notification_deliveries: 0,
    notification_events: 0,
    observations: 0,
    order_status: "payment_pending",
    paid_sale_events: 0,
    paid_sales: 0,
    payment_status: "created",
  });
  const rollbackRetry = await processCaptured(rollbackInvoiceId);
  assert.equal(rollbackRetry.applied, true);
  assert.equal(rollbackRetry.duplicate, false);
  const recoveredPaidSale = await database.query<{
    cart_status: string;
    notification_deliveries: number;
    notification_events: number;
    observations: number;
    order_status: string;
    paid_sale_events: number;
    paid_sales: number;
    payment_status: string;
  }>(
    `
      SELECT
        orders.status AS order_status,
        cart.status AS cart_status,
        payment.status AS payment_status,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id) AS observations,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int FROM outbox_events event
           WHERE event.aggregate_id = orders.id::text
             AND event.event_type = 'PaidSale') AS paid_sale_events,
        (SELECT COUNT(*)::int FROM outbox_events event
           WHERE event.aggregate_id = orders.id::text
             AND event.event_type = 'PurchaseNotificationRequested')
          AS notification_events,
        (SELECT COUNT(*)::int FROM notifications_purchase_deliveries delivery
           WHERE delivery.order_id = orders.id) AS notification_deliveries
      FROM commerce_orders orders
      JOIN commerce_carts cart ON cart.id = orders.cart_id
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [rollbackCheckout.order.id],
  );
  assert.deepEqual(recoveredPaidSale.rows[0], {
    cart_status: "purchased",
    notification_deliveries: 1,
    notification_events: 1,
    observations: 1,
    order_status: "paid",
    paid_sale_events: 1,
    paid_sales: 1,
    payment_status: "success",
  });

  const failedCheckout = await checkoutFor(
    UNIT05_FIXTURE_IDS.authorUserId,
    [UNIT05_FIXTURE_IDS.books.fullPrice],
  );
  const failedInvoiceId =
    failedCheckout.paymentSession.providerInvoiceId as string;
  await controlInvoice(failedInvoiceId, {
    failureReason: "cancelled_by_user",
    status: "failure",
  });
  await processCaptured(failedInvoiceId);
  const failedState = await database.query<{
    cart_status: string;
    order_status: string;
    paid_sales: number;
  }>(
    `
      SELECT
        orders.status AS order_status,
        cart.status AS cart_status,
        (SELECT COUNT(*)::int FROM commerce_paid_sales
           WHERE order_id = orders.id) AS paid_sales
      FROM commerce_orders orders
      JOIN commerce_carts cart ON cart.id = orders.cart_id
      WHERE orders.id = $1
    `,
    [failedCheckout.order.id],
  );
  assert.deepEqual(failedState.rows[0], {
    cart_status: "active",
    order_status: "payment_failed",
    paid_sales: 0,
  });

  await database.query(
    `
      INSERT INTO users (
        id, private_email, private_email_verified, private_display_name
      ) VALUES ($1, 'reconcile-unit05@example.invalid', TRUE, 'Buyer Reconcile')
    `,
    [thirdBuyerId],
  );
  await database.query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'buyer')",
    [thirdBuyerId],
  );
  const missedCheckout = await checkoutFor(thirdBuyerId, [
    UNIT05_FIXTURE_IDS.books.discounted,
  ]);
  const missedInvoiceId =
    missedCheckout.paymentSession.providerInvoiceId as string;
  await controlInvoice(missedInvoiceId, {
    deliverWebhook: false,
    status: "success",
  });
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CASE
        WHEN correlation_id = $1
          AND job_type = 'commerce.reconcile-payment.v1'
        THEN CURRENT_TIMESTAMP
        ELSE '2099-01-01T00:00:00.000Z'::timestamptz
      END
      WHERE queue = 'commerce'
    `,
    [missedCheckout.order.id],
  );
  const reconciliationHandler = createPaymentReconciliationHandler({
    database,
    intervalMs: 1_000,
    maxReconciliations: 2,
    provider,
  });
  let reconciliationRuns = 0;
  for (let index = 0; index < 4; index += 1) {
    const handled = await runWorkerOnce({
      database,
      handlers: {
        [PAYMENT_RECONCILIATION_JOB_TYPE]: reconciliationHandler,
      },
      queue: COMMERCE_QUEUE,
      workerId: `unit05-postgres-commerce-${index}`,
    });
    if (!handled) break;
    reconciliationRuns += 1;
    const current = await database.query<{ status: string }>(
      "SELECT status FROM commerce_orders WHERE id = $1",
      [missedCheckout.order.id],
    );
    if (current.rows[0]?.status === "paid") break;
  }
  assert.ok(reconciliationRuns > 0);
  const reconciliationJobs = await database.query<{
    completed: number;
    failed: number;
    last_errors: string;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE last_error IS NOT NULL)::int AS failed,
        COALESCE(string_agg(last_error, ' | '), '') AS last_errors
      FROM durable_jobs
      WHERE queue = 'commerce' AND correlation_id = $1
    `,
    [missedCheckout.order.id],
  );
  assert.ok((reconciliationJobs.rows[0]?.completed ?? 0) > 0);
  assert.equal(
    reconciliationJobs.rows[0]?.failed,
    0,
    reconciliationJobs.rows[0]?.last_errors,
  );
  const reconciliationState = await database.query<{
    observations: number;
    paid_sales: number;
    status: string;
  }>(
    `
      SELECT
        orders.status,
        (SELECT COUNT(*)::int FROM commerce_paid_sales
           WHERE order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions payment
             ON payment.id = observation.payment_session_id
           WHERE payment.order_id = orders.id
             AND observation.source = 'reconciliation') AS observations
      FROM commerce_orders orders
      WHERE orders.id = $1
    `,
    [missedCheckout.order.id],
  );
  assert.deepEqual(reconciliationState.rows[0], {
    observations: 1,
    paid_sales: 1,
    status: "paid",
  });

  await createBuyer(
    resilienceBuyerId,
    "resilience-unit05@example.invalid",
    "Buyer Resilience",
  );
  const resilienceCheckout = await checkoutFor(resilienceBuyerId, [
    UNIT05_FIXTURE_IDS.books.fullPrice,
  ]);
  const resilienceInvoiceId =
    resilienceCheckout.paymentSession.providerInvoiceId as string;
  await database.query(
    "ALTER TABLE commerce_payment_sessions DISABLE TRIGGER commerce_payment_sessions_snapshot_protected",
  );
  try {
    await database.query(
      `
        UPDATE commerce_payment_sessions
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds'
        WHERE id = $1
      `,
      [resilienceCheckout.paymentSession.id],
    );
  } finally {
    await database.query(
      "ALTER TABLE commerce_payment_sessions ENABLE TRIGGER commerce_payment_sessions_snapshot_protected",
    );
  }
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CASE
        WHEN correlation_id = $1
          AND job_type = 'commerce.reconcile-payment.v1'
          AND (payload->>'attempt')::int = 0
        THEN CURRENT_TIMESTAMP
        ELSE '2099-01-01T00:00:00.000Z'::timestamptz
      END
      WHERE queue = 'commerce'
    `,
    [resilienceCheckout.order.id],
  );
  const outageHandler = createPaymentReconciliationHandler({
    database,
    intervalMs: 1_000,
    provider: new UnavailablePaymentProviderAdapter(),
  });
  const outageRun = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: outageHandler,
    },
    queue: COMMERCE_QUEUE,
    retryDelayMs: 1,
    workerId: "unit05-postgres-reconciliation-outage",
  });
  assert.equal(outageRun, true);
  const afterOutage = await database.query<{
    attempt: number;
    attempts: number;
    available_in_seconds: number;
    last_error: string | null;
    status: string;
  }>(
    `
      SELECT
        (payload->>'attempt')::int AS attempt,
        attempts,
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (available_at - CURRENT_TIMESTAMP)))
        )::int AS available_in_seconds,
        last_error,
        status
      FROM durable_jobs
      WHERE queue = 'commerce'
        AND correlation_id = $1
        AND job_type = 'commerce.reconcile-payment.v1'
      ORDER BY (payload->>'attempt')::int
    `,
    [resilienceCheckout.order.id],
  );
  assert.equal(afterOutage.rows.length, 2);
  assert.deepEqual(
    afterOutage.rows.map(({ attempt, attempts, status }) => ({
      attempt,
      attempts,
      status,
    })),
    [
      { attempt: 0, attempts: 1, status: "pending" },
      { attempt: 1, attempts: 0, status: "pending" },
    ],
  );
  assert.match(
    afterOutage.rows[0]?.last_error ?? "",
    /тимчасово недоступний|temporarily unavailable/u,
  );
  assert.ok((afterOutage.rows[1]?.available_in_seconds ?? 0) >= 250);
  const openOverdueIssue = await database.query<{
    open_issues: number;
  }>(
    `
      SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open_issues
      FROM commerce_reconciliation_issues
      WHERE payment_session_id = $1
        AND issue_type = 'reconciliation_overdue'
    `,
    [resilienceCheckout.paymentSession.id],
  );
  assert.equal(openOverdueIssue.rows[0]?.open_issues, 1);
  const stateDuringOutage = await database.query<{
    observations: number;
    order_status: string;
    paid_sales: number;
    payment_status: string;
  }>(
    `
      SELECT
        orders.status AS order_status,
        payment.status AS payment_status,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id) AS observations,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales
      FROM commerce_orders orders
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [resilienceCheckout.order.id],
  );
  assert.deepEqual(stateDuringOutage.rows[0], {
    observations: 0,
    order_status: "payment_pending",
    paid_sales: 0,
    payment_status: "created",
  });

  await controlInvoice(resilienceInvoiceId, {
    deliverWebhook: false,
    status: "success",
  });
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CURRENT_TIMESTAMP
      WHERE queue = 'commerce'
        AND correlation_id = $1
        AND job_type = 'commerce.reconcile-payment.v1'
        AND (payload->>'attempt')::int = 0
    `,
    [resilienceCheckout.order.id],
  );
  const resilienceHandler = createPaymentReconciliationHandler({
    database,
    intervalMs: 1_000,
    provider,
  });
  const recoveredOutageRun = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: resilienceHandler,
    },
    queue: COMMERCE_QUEUE,
    workerId: "unit05-postgres-reconciliation-recovery",
  });
  assert.equal(recoveredOutageRun, true);
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CURRENT_TIMESTAMP
      WHERE queue = 'commerce'
        AND correlation_id = $1
        AND job_type = 'commerce.reconcile-payment.v1'
        AND status = 'pending'
    `,
    [resilienceCheckout.order.id],
  );
  const successorNoop = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: resilienceHandler,
    },
    queue: COMMERCE_QUEUE,
    workerId: "unit05-postgres-reconciliation-successor-noop",
  });
  assert.equal(successorNoop, true);
  const recoveredOutageState = await database.query<{
    completed_jobs: number;
    dead_letter_jobs: number;
    observations: number;
    open_issues: number;
    order_status: string;
    paid_sales: number;
    resolved_issues: number;
  }>(
    `
      SELECT
        orders.status AS order_status,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions session
             ON session.id = observation.payment_session_id
           WHERE session.order_id = orders.id
             AND observation.source = 'reconciliation') AS observations,
        (SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int
           FROM commerce_reconciliation_issues issue
           JOIN commerce_payment_sessions session
             ON session.id = issue.payment_session_id
           WHERE session.order_id = orders.id
             AND issue.issue_type = 'reconciliation_overdue') AS open_issues,
        (SELECT COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int
           FROM commerce_reconciliation_issues issue
           JOIN commerce_payment_sessions session
             ON session.id = issue.payment_session_id
           WHERE session.order_id = orders.id
             AND issue.issue_type = 'reconciliation_overdue') AS resolved_issues,
        (SELECT COUNT(*) FILTER (WHERE status = 'completed')::int
           FROM durable_jobs job
           WHERE job.queue = 'commerce'
             AND job.correlation_id = orders.id::text
             AND job.job_type = 'commerce.reconcile-payment.v1')
          AS completed_jobs,
        (SELECT COUNT(*) FILTER (WHERE status = 'dead_letter')::int
           FROM durable_jobs job
           WHERE job.queue = 'commerce'
             AND job.correlation_id = orders.id::text
             AND job.job_type = 'commerce.reconcile-payment.v1')
          AS dead_letter_jobs
      FROM commerce_orders orders
      WHERE orders.id = $1
    `,
    [resilienceCheckout.order.id],
  );
  assert.deepEqual(recoveredOutageState.rows[0], {
    completed_jobs: 2,
    dead_letter_jobs: 0,
    observations: 1,
    open_issues: 0,
    order_status: "paid",
    paid_sales: 1,
    resolved_issues: 1,
  });

  await createBuyer(
    missingDateBuyerId,
    "missing-date-unit05@example.invalid",
    "Buyer Missing Date",
  );
  const missingDateCheckout = await checkoutFor(missingDateBuyerId, [
    UNIT05_FIXTURE_IDS.books.discounted,
  ]);
  const missingDateInvoiceId =
    missingDateCheckout.paymentSession.providerInvoiceId as string;
  await controlInvoice(missingDateInvoiceId, {
    deliverWebhook: true,
    omitModifiedDate: true,
    status: "success",
  });
  const missingDateWebhook = await processCaptured(missingDateInvoiceId);
  assert.equal(missingDateWebhook.applied, false);
  assert.equal(missingDateWebhook.duplicate, false);
  const beforeMissingDateReconciliation = await database.query<{
    observations: number;
    order_status: string;
    paid_sales: number;
    payment_status: string;
  }>(
    `
      SELECT
        orders.status AS order_status,
        payment.status AS payment_status,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id) AS observations,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales
      FROM commerce_orders orders
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [missingDateCheckout.order.id],
  );
  assert.deepEqual(beforeMissingDateReconciliation.rows[0], {
    observations: 1,
    order_status: "payment_pending",
    paid_sales: 0,
    payment_status: "created",
  });
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CASE
        WHEN correlation_id = $1
          AND job_type = 'commerce.reconcile-payment.v1'
          AND (payload->>'attempt')::int = 0
        THEN CURRENT_TIMESTAMP
        ELSE '2099-01-01T00:00:00.000Z'::timestamptz
      END
      WHERE queue = 'commerce'
    `,
    [missingDateCheckout.order.id],
  );
  const missingDateHandler = createPaymentReconciliationHandler({
    database,
    intervalMs: 1_000,
    provider,
  });
  const missingDateReconciliation = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: missingDateHandler,
    },
    queue: COMMERCE_QUEUE,
    workerId: "unit05-postgres-missing-date-reconciliation",
  });
  assert.equal(missingDateReconciliation, true);
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CURRENT_TIMESTAMP
      WHERE queue = 'commerce'
        AND correlation_id = $1
        AND job_type = 'commerce.reconcile-payment.v1'
        AND status = 'pending'
    `,
    [missingDateCheckout.order.id],
  );
  const missingDateSuccessor = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: missingDateHandler,
    },
    queue: COMMERCE_QUEUE,
    workerId: "unit05-postgres-missing-date-successor",
  });
  assert.equal(missingDateSuccessor, true);
  const replayedMissingDateWebhook =
    await processCaptured(missingDateInvoiceId);
  assert.equal(replayedMissingDateWebhook.applied, false);
  assert.equal(replayedMissingDateWebhook.duplicate, true);
  const afterMissingDateReconciliation = await database.query<{
    completed_jobs: number;
    observations: number;
    paid_sale_events: number;
    paid_sales: number;
    reconciliation_applied: number;
    status: string;
    webhook_unapplied: number;
  }>(
    `
      SELECT
        orders.status,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int FROM outbox_events event
           WHERE event.aggregate_id = orders.id::text
             AND event.event_type = 'PaidSale') AS paid_sale_events,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions session
             ON session.id = observation.payment_session_id
           WHERE session.order_id = orders.id) AS observations,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions session
             ON session.id = observation.payment_session_id
           WHERE session.order_id = orders.id
             AND observation.source = 'webhook'
             AND observation.provider_modified_at IS NULL
             AND observation.applied = FALSE) AS webhook_unapplied,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions session
             ON session.id = observation.payment_session_id
           WHERE session.order_id = orders.id
             AND observation.source = 'reconciliation'
             AND observation.provider_modified_at IS NULL
             AND observation.applied = TRUE) AS reconciliation_applied,
        (SELECT COUNT(*) FILTER (WHERE status = 'completed')::int
           FROM durable_jobs job
           WHERE job.queue = 'commerce'
             AND job.correlation_id = orders.id::text
             AND job.job_type = 'commerce.reconcile-payment.v1')
          AS completed_jobs
      FROM commerce_orders orders
      WHERE orders.id = $1
    `,
    [missingDateCheckout.order.id],
  );
  assert.deepEqual(afterMissingDateReconciliation.rows[0], {
    completed_jobs: 2,
    observations: 2,
    paid_sale_events: 1,
    paid_sales: 1,
    reconciliation_applied: 1,
    status: "paid",
    webhook_unapplied: 1,
  });

  await createBuyer(
    equalTimestampBuyerId,
    "equal-time-unit05@example.invalid",
    "Buyer Equal Time",
  );
  const equalTimestampCheckout = await checkoutFor(equalTimestampBuyerId, [
    UNIT05_FIXTURE_IDS.books.fullPrice,
  ]);
  const equalTimestampInvoiceId =
    equalTimestampCheckout.paymentSession.providerInvoiceId as string;
  const equalTimestamp = new Date().toISOString();
  await controlInvoice(equalTimestampInvoiceId, {
    deliverWebhook: true,
    modifiedDate: equalTimestamp,
    status: "processing",
  });
  const processingAtEqualTime =
    await processCaptured(equalTimestampInvoiceId);
  assert.equal(processingAtEqualTime.applied, true);
  await controlInvoice(equalTimestampInvoiceId, {
    deliverWebhook: true,
    modifiedDate: equalTimestamp,
    status: "success",
  });
  const successWebhookAtEqualTime =
    await processCaptured(equalTimestampInvoiceId);
  assert.equal(successWebhookAtEqualTime.applied, false);
  assert.equal(successWebhookAtEqualTime.duplicate, false);
  const beforeEqualTimestampRecovery = await database.query<{
    applied_observations: number;
    observations: number;
    order_status: string;
    paid_sales: number;
    payment_status: string;
  }>(
    `
      SELECT
        orders.status AS order_status,
        payment.status AS payment_status,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id) AS observations,
        (SELECT COUNT(*) FILTER (WHERE applied)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id)
          AS applied_observations,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales
      FROM commerce_orders orders
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [equalTimestampCheckout.order.id],
  );
  assert.deepEqual(beforeEqualTimestampRecovery.rows[0], {
    applied_observations: 1,
    observations: 2,
    order_status: "payment_pending",
    paid_sales: 0,
    payment_status: "processing",
  });
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CASE
        WHEN correlation_id = $1
          AND job_type = 'commerce.reconcile-payment.v1'
          AND (payload->>'attempt')::int = 0
        THEN CURRENT_TIMESTAMP
        ELSE '2099-01-01T00:00:00.000Z'::timestamptz
      END
      WHERE queue = 'commerce'
    `,
    [equalTimestampCheckout.order.id],
  );
  const equalTimestampHandler = createPaymentReconciliationHandler({
    database,
    intervalMs: 1_000,
    provider,
  });
  const equalTimestampRecovery = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: equalTimestampHandler,
    },
    queue: COMMERCE_QUEUE,
    workerId: "unit05-postgres-equal-time-recovery",
  });
  assert.equal(equalTimestampRecovery, true);
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CURRENT_TIMESTAMP
      WHERE queue = 'commerce'
        AND correlation_id = $1
        AND job_type = 'commerce.reconcile-payment.v1'
        AND status = 'pending'
    `,
    [equalTimestampCheckout.order.id],
  );
  const equalTimestampSuccessor = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]: equalTimestampHandler,
    },
    queue: COMMERCE_QUEUE,
    workerId: "unit05-postgres-equal-time-successor",
  });
  assert.equal(equalTimestampSuccessor, true);
  const replayedEqualTimestampWebhook =
    await processCaptured(equalTimestampInvoiceId);
  assert.equal(replayedEqualTimestampWebhook.applied, false);
  assert.equal(replayedEqualTimestampWebhook.duplicate, true);
  const afterEqualTimestampRecovery = await database.query<{
    applied_observations: number;
    observations: number;
    paid_sale_events: number;
    paid_sales: number;
    status: string;
  }>(
    `
      SELECT
        orders.status,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int FROM outbox_events event
           WHERE event.aggregate_id = orders.id::text
             AND event.event_type = 'PaidSale') AS paid_sale_events,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions session
             ON session.id = observation.payment_session_id
           WHERE session.order_id = orders.id) AS observations,
        (SELECT COUNT(*) FILTER (WHERE observation.applied)::int
           FROM commerce_payment_observations observation
           JOIN commerce_payment_sessions session
             ON session.id = observation.payment_session_id
           WHERE session.order_id = orders.id) AS applied_observations
      FROM commerce_orders orders
      WHERE orders.id = $1
    `,
    [equalTimestampCheckout.order.id],
  );
  assert.deepEqual(afterEqualTimestampRecovery.rows[0], {
    applied_observations: 2,
    observations: 2,
    paid_sale_events: 1,
    paid_sales: 1,
    status: "paid",
  });

  await createBuyer(
    misroutingBuyerId,
    "misrouting-unit05@example.invalid",
    "Buyer Misrouting",
  );
  const misroutingCheckout = await checkoutFor(misroutingBuyerId, [
    UNIT05_FIXTURE_IDS.books.fullPrice,
  ]);
  const misroutingProvider: PaymentProviderAdapter = {
    createInvoice: provider.createInvoice.bind(provider),
    getInvoiceStatus: () => provider.getInvoiceStatus(primaryInvoiceId),
    id: "mono",
    verifyAndParseWebhook:
      provider.verifyAndParseWebhook.bind(provider),
  };
  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CASE
        WHEN correlation_id = $1
          AND job_type = 'commerce.reconcile-payment.v1'
          AND (payload->>'attempt')::int = 0
        THEN CURRENT_TIMESTAMP
        ELSE '2099-01-01T00:00:00.000Z'::timestamptz
      END
      WHERE queue = 'commerce'
    `,
    [misroutingCheckout.order.id],
  );
  const misroutingRun = await runWorkerOnce({
    database,
    handlers: {
      [PAYMENT_RECONCILIATION_JOB_TYPE]:
        createPaymentReconciliationHandler({
          database,
          intervalMs: 1_000,
          provider: misroutingProvider,
        }),
    },
    queue: COMMERCE_QUEUE,
    retryDelayMs: 1,
    workerId: "unit05-postgres-reconciliation-misrouting",
  });
  assert.equal(misroutingRun, true);
  const afterMisrouting = await database.query<{
    observations: number;
    order_status: string;
    paid_sales: number;
    payment_status: string;
    reconciliation_jobs: number;
    retried_jobs: number;
  }>(
    `
      SELECT
        orders.status AS order_status,
        payment.status AS payment_status,
        (SELECT COUNT(*)::int
           FROM commerce_payment_observations observation
           WHERE observation.payment_session_id = payment.id) AS observations,
        (SELECT COUNT(*)::int FROM commerce_paid_sales sale
           WHERE sale.order_id = orders.id) AS paid_sales,
        (SELECT COUNT(*)::int FROM durable_jobs job
           WHERE job.queue = 'commerce'
             AND job.correlation_id = orders.id::text
             AND job.job_type = 'commerce.reconcile-payment.v1')
          AS reconciliation_jobs,
        (SELECT COUNT(*) FILTER (
             WHERE attempts = 1
               AND last_error LIKE '%does not match the requested invoice%'
           )::int
           FROM durable_jobs job
           WHERE job.queue = 'commerce'
             AND job.correlation_id = orders.id::text
             AND job.job_type = 'commerce.reconcile-payment.v1')
          AS retried_jobs
      FROM commerce_orders orders
      JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
      WHERE orders.id = $1
    `,
    [misroutingCheckout.order.id],
  );
  assert.deepEqual(afterMisrouting.rows[0], {
    observations: 0,
    order_status: "payment_pending",
    paid_sales: 0,
    payment_status: "created",
    reconciliation_jobs: 2,
    retried_jobs: 1,
  });

  class FailingEmailAdapter implements TransactionalEmailAdapter {
    async send(): Promise<never> {
      throw new Error("unit05-proof-email-failure");
    }
  }
  const failedEmailWorker = await runWorkerOnce({
    database,
    handlers: {
      [PURCHASE_EMAIL_JOB_TYPE]: createPurchaseEmailHandler({
        adapter: new FailingEmailAdapter(),
        appOrigin,
        database,
        from: "purchases@ukiebook.test",
      }),
    },
    queue: NOTIFICATION_QUEUE,
    retryDelayMs: 1,
    workerId: "unit05-postgres-email-failure",
  });
  assert.equal(failedEmailWorker, true);
  const afterEmailFailure = await database.query<{
    job_attempts: number;
    job_status: string;
    last_error: string;
    order_status: string;
    paid_sales: number;
  }>(
    `
      SELECT
        orders.status AS order_status,
        (SELECT COUNT(*)::int FROM commerce_paid_sales
           WHERE order_id = orders.id) AS paid_sales,
        job.status AS job_status,
        job.attempts AS job_attempts,
        job.last_error
      FROM commerce_orders orders
      JOIN durable_jobs job
        ON job.correlation_id = orders.id::text
       AND job.queue = 'notifications'
      WHERE orders.id = $1
    `,
    [primaryCheckout.order.id],
  );
  assert.equal(afterEmailFailure.rows[0]?.order_status, "paid");
  assert.equal(afterEmailFailure.rows[0]?.paid_sales, 1);
  assert.equal(afterEmailFailure.rows[0]?.job_status, "pending");
  assert.equal(afterEmailFailure.rows[0]?.job_attempts, 1);
  assert.match(afterEmailFailure.rows[0]?.last_error ?? "", /email-failure/u);

  await database.query(
    `
      UPDATE durable_jobs
      SET available_at = CASE
        WHEN correlation_id = $1::uuid::text
        THEN CURRENT_TIMESTAMP
        ELSE '2099-01-01T00:00:00.000Z'::timestamptz
      END
      WHERE queue = 'notifications'
    `,
    [primaryCheckout.order.id],
  );
  const capturedEmail = new CapturedEmailAdapter();
  const capturedEmailWorker = await runWorkerOnce({
    database,
    handlers: {
      [PURCHASE_EMAIL_JOB_TYPE]: createPurchaseEmailHandler({
        adapter: capturedEmail,
        appOrigin,
        database,
        from: "purchases@ukiebook.test",
      }),
    },
    queue: NOTIFICATION_QUEUE,
    workerId: "unit05-postgres-email-capture",
  });
  assert.equal(capturedEmailWorker, true);
  assert.equal(capturedEmail.messages.length, 1);
  assert.match(
    capturedEmail.messages[0]?.text ?? "",
    new RegExp(UNIT05_FIXTURE_BOOKS.discounted.title, "u"),
  );
  assert.match(
    capturedEmail.messages[0]?.text ?? "",
    new RegExp(UNIT05_FIXTURE_BOOKS.fullPrice.title, "u"),
  );
  assert.match(capturedEmail.messages[0]?.text ?? "", /\/library/u);

  const cardColumns = await database.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name LIKE 'commerce_%'
        AND column_name ~* '(card|pan|cvv|cvc|expiry)'
    `,
  );
  assert.deepEqual(cardColumns.rows, []);
  const secretPersistence = await database.query<{ matches: number }>(
    `
      SELECT (
        (SELECT COUNT(*) FROM outbox_events
          WHERE payload::text LIKE '%' || $1 || '%')
        +
        (SELECT COUNT(*) FROM durable_jobs
          WHERE payload::text LIKE '%' || $1 || '%')
      )::int AS matches
    `,
    [merchantToken],
  );
  assert.equal(secretPersistence.rows[0]?.matches, 0);

  const paidSaleId = await database.query<{ id: string }>(
    "SELECT id FROM commerce_paid_sales WHERE order_id = $1",
    [primaryCheckout.order.id],
  );
  const orderItemId = await database.query<{ id: string }>(
    "SELECT id FROM commerce_order_items WHERE order_id = $1 LIMIT 1",
    [primaryCheckout.order.id],
  );
  const observationId = await database.query<{ id: string }>(
    `
      SELECT observation.id
      FROM commerce_payment_observations observation
      JOIN commerce_payment_sessions payment
        ON payment.id = observation.payment_session_id
      WHERE payment.order_id = $1
      LIMIT 1
    `,
    [primaryCheckout.order.id],
  );
  assert.ok(paidSaleId.rows[0]?.id);
  assert.ok(orderItemId.rows[0]?.id);
  assert.ok(observationId.rows[0]?.id);
  await assertImmutableMutation(
    "UPDATE commerce_paid_sales SET total_kopiykas = total_kopiykas + 1 WHERE id = $1",
    [paidSaleId.rows[0]!.id],
  );
  await assertImmutableMutation(
    "DELETE FROM commerce_order_items WHERE id = $1",
    [orderItemId.rows[0]!.id],
  );
  await assertImmutableMutation(
    "UPDATE commerce_payment_observations SET provider_status = 'failure' WHERE id = $1",
    [observationId.rows[0]!.id],
  );

  const lateInsertItemId = randomUUID();
  await assert.rejects(
    database.query(
      `
        INSERT INTO commerce_order_items (
          id, order_id, ordinal, book_id, book_version_id, author_id,
          title_snapshot, author_public_name_snapshot, cover_path_snapshot,
          quantity, base_price_kopiykas, discount_kopiykas,
          unit_price_kopiykas, line_total_kopiykas
        )
        SELECT
          $1, $2, 99, book_id, book_version_id, author_id,
          title_snapshot, author_public_name_snapshot, cover_path_snapshot,
          quantity, base_price_kopiykas, discount_kopiykas,
          unit_price_kopiykas, line_total_kopiykas
        FROM commerce_order_items
        WHERE order_id = $2
        ORDER BY ordinal
        LIMIT 1
      `,
      [lateInsertItemId, primaryCheckout.order.id],
    ),
    /order snapshot is sealed for payment/u,
  );
  const primaryItemCountAfterLateInsert = await database.query<{
    count: number;
  }>(
    "SELECT COUNT(*)::int AS count FROM commerce_order_items WHERE order_id = $1",
    [primaryCheckout.order.id],
  );
  assert.equal(primaryItemCountAfterLateInsert.rows[0]?.count, 2);

  await createBuyer(
    mismatchBuyerId,
    "mismatch-unit05@example.invalid",
    "Buyer Mismatch",
  );
  const mismatchOrder = {
    cartId: randomUUID(),
    itemId: randomUUID(),
    orderId: randomUUID(),
  };
  await createManualOrder({
    buyerUserId: mismatchBuyerId,
    ...mismatchOrder,
    orderTotalKopiykas: UNIT05_FIXTURE_BOOKS.fullPrice.actualPriceKopiykas,
    sourceOrderId: primaryCheckout.order.id,
  });
  await assert.rejects(
    database.query(
      `
        INSERT INTO commerce_payment_sessions (
          id, order_id, request_key, status, amount_kopiykas,
          currency_numeric, expires_at
        ) VALUES (
          $1, $2, $3, 'creating', $4, 980,
          CURRENT_TIMESTAMP + INTERVAL '1 hour'
        )
      `,
      [
        randomUUID(),
        mismatchOrder.orderId,
        `unit05-mismatch-${randomUUID()}`,
        UNIT05_FIXTURE_BOOKS.fullPrice.actualPriceKopiykas,
      ],
    ),
    /payment session does not match immutable order items/u,
  );
  const rejectedMismatchedSession = await database.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM commerce_payment_sessions
      WHERE order_id = $1
    `,
    [mismatchOrder.orderId],
  );
  assert.equal(rejectedMismatchedSession.rows[0]?.count, 0);

  await createBuyer(
    serializationBuyerId,
    "serialization-unit05@example.invalid",
    "Buyer Serialization",
  );
  const serializationOrder = {
    cartId: randomUUID(),
    itemId: randomUUID(),
    orderId: randomUUID(),
  };
  await createManualOrder({
    buyerUserId: serializationBuyerId,
    ...serializationOrder,
    orderTotalKopiykas:
      UNIT05_FIXTURE_BOOKS.discounted.actualPriceKopiykas,
    sourceOrderId: primaryCheckout.order.id,
  });
  const paymentConnection = await database.connect!();
  const lateItemConnection = await database.connect!();
  let paymentTransactionOpen = false;
  let lateItemTransactionOpen = false;
  try {
    await paymentConnection.query("BEGIN");
    paymentTransactionOpen = true;
    await paymentConnection.query(
      `
        INSERT INTO commerce_payment_sessions (
          id, order_id, request_key, status, amount_kopiykas,
          currency_numeric, expires_at
        ) VALUES (
          $1, $2, $3, 'creating', $4, 980,
          CURRENT_TIMESTAMP + INTERVAL '1 hour'
        )
      `,
      [
        randomUUID(),
        serializationOrder.orderId,
        `unit05-serialization-${randomUUID()}`,
        UNIT05_FIXTURE_BOOKS.discounted.actualPriceKopiykas,
      ],
    );
    await lateItemConnection.query("BEGIN");
    lateItemTransactionOpen = true;
    const concurrentLateInsert = lateItemConnection.query(
      `
        INSERT INTO commerce_order_items (
          id, order_id, ordinal, book_id, book_version_id, author_id,
          title_snapshot, author_public_name_snapshot, cover_path_snapshot,
          quantity, base_price_kopiykas, discount_kopiykas,
          unit_price_kopiykas, line_total_kopiykas
        )
        SELECT
          $1, $2, 99, book_id, book_version_id, author_id,
          title_snapshot, author_public_name_snapshot, cover_path_snapshot,
          quantity, base_price_kopiykas, discount_kopiykas,
          unit_price_kopiykas, line_total_kopiykas
        FROM commerce_order_items
        WHERE order_id = $2
        ORDER BY ordinal
        LIMIT 1
      `,
      [randomUUID(), serializationOrder.orderId],
    );
    const concurrentState = await Promise.race([
      concurrentLateInsert.then(
        () => "settled",
        () => "settled",
      ),
      new Promise<"blocked">((resolve) => {
        setTimeout(() => resolve("blocked"), 50);
      }),
    ]);
    assert.equal(concurrentState, "blocked");
    await paymentConnection.query("COMMIT");
    paymentTransactionOpen = false;
    await assert.rejects(
      concurrentLateInsert,
      /order snapshot is sealed for payment/u,
    );
    await lateItemConnection.query("ROLLBACK");
    lateItemTransactionOpen = false;
  } finally {
    if (paymentTransactionOpen) {
      await paymentConnection.query("ROLLBACK").catch(() => {});
    }
    if (lateItemTransactionOpen) {
      await lateItemConnection.query("ROLLBACK").catch(() => {});
    }
    paymentConnection.release?.();
    lateItemConnection.release?.();
  }
  const serializedSnapshot = await database.query<{
    items: number;
    sessions: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM commerce_order_items
           WHERE order_id = $1) AS items,
        (SELECT COUNT(*)::int FROM commerce_payment_sessions
           WHERE order_id = $1) AS sessions
    `,
    [serializationOrder.orderId],
  );
  assert.deepEqual(serializedSnapshot.rows[0], {
    items: 1,
    sessions: 1,
  });

  process.stdout.write(
    `${JSON.stringify({
      card_data_non_persistence: "passed",
      cart_merge_deduplication: "passed",
      cart_persistence: "passed",
      duplicate_checkout_reuses_session: "passed",
      email_failure_independence: "passed",
      equal_timestamp_reconciliation_recovery: "passed",
      financial_snapshot_serialization: "passed",
      migration_roundtrip: "passed",
      missing_modified_date_reconciliation: "passed",
      missing_webhook_reconciliation: "passed",
      multi_book_single_invoice: "passed",
      notification_isolation: "passed",
      order_price_snapshot: "passed",
      order_snapshot_sealed_after_payment_session: "passed",
      paid_sale_append_only: "passed",
      paid_sale_atomicity: "passed",
      paid_sale_rollback_recovery: "passed",
      provider_payload_binding: "passed",
      provider_response_invoice_binding: "passed",
      payment_session_item_sum_guard: "passed",
      purchase_email_capture: "passed",
      raw_cart_token_non_persistence: "passed",
      reconciliation_horizon_continuity: "passed",
      reconciliation_outage_continuity: "passed",
      schema_revision: PLATFORM_SCHEMA_REVISION,
      status: "passed",
      unpaid_cancelled_no_paid_sale: "passed",
      webhook_idempotency: "passed",
      webhook_out_of_order_guard: "passed",
      webhook_signature_verification: "passed",
    })}\n`,
  );
} finally {
  await database.close?.();
  await simulator.close();
  await new Promise<void>((resolve, reject) => {
    webhookReceiver.close((error) => (error ? reject(error) : resolve()));
  });
}
