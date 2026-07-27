import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { formatUah, presentPrice } from "../../catalog/price";
import { requestPurchaseNotification } from "../../notifications/server/service";
import type { DurableJob } from "../../platform/durable-jobs";
import type { JsonObject } from "../../platform/envelopes";
import type {
  SqlConnection,
  SqlDatabase,
  SqlExecutor,
} from "../../platform/sql-port";
import {
  withDomainTransaction,
  type DomainTransaction,
} from "../../platform/transaction";
import {
  PaymentProviderConfigurationError,
  PaymentProviderProtocolError,
  PaymentProviderRejectedError,
  type PaymentProviderAdapter,
} from "../adapter";
import {
  anonymousCartTokenDigest,
  createAnonymousCartToken,
  isAnonymousCartToken,
} from "../cart-token";
import {
  COMMERCE_QUEUE,
  COMMERCE_SCHEMA_VERSION,
  PAYMENT_CREATION_WATCHDOG_JOB_TYPE,
  PAYMENT_RECONCILIATION_JOB_TYPE,
  PAYMENT_RECONCILIATION_JOB_VERSION,
  type CartReadModel,
  type CartStatus,
  type CheckoutOrder,
  type CheckoutResultReadModel,
  type MonoInvoiceObservation,
  type OrderItemSnapshot,
  type OrderStatus,
  type PaidSalePayload,
  type PaymentReconciliationJobPayload,
  type PaymentSession,
  type PaymentSessionStatus,
  type StartCheckoutResult,
} from "../types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPEN_PAYMENT_STATUSES = [
  "creating",
  "creation_unknown",
  "created",
  "processing",
  "hold",
] as const;

export interface CartIdentity {
  readonly anonymousToken?: string;
  readonly buyerUserId?: string;
}

export interface CartMutationResult {
  readonly anonymousToken: string | null;
  readonly cart: CartReadModel;
}

export interface PaymentObservationResult {
  readonly applied: boolean;
  readonly duplicate: boolean;
  readonly orderId: string;
  readonly paymentSessionId: string;
  readonly status: PaymentSessionStatus;
}

export class CommerceInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommerceInputError";
    this.code = code;
  }
}

export class CommerceConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommerceConflictError";
    this.code = code;
  }
}

export class CommerceNotFoundError extends Error {
  constructor(message = "Commerce resource was not found") {
    super(message);
    this.name = "CommerceNotFoundError";
  }
}

interface CartRow extends Record<string, unknown> {
  anonymous_token_digest: string | null;
  buyer_user_id: string | null;
  id: string;
  revision: number;
  status: CartStatus;
}

interface CartItemRow extends Record<string, unknown> {
  active_book_version_id: string | null;
  author_public_name: string;
  availability: "published" | "unavailable";
  base_price_kopiykas: number;
  book_id: string;
  cover_path: string;
  discount_ends_at: Date | string | null;
  discount_price_kopiykas: number | null;
  discount_starts_at: Date | string | null;
  publication_state: "published" | "unavailable" | null;
  source_book_version_id: string | null;
  title: string;
}

interface SnapshotCandidateRow extends CartItemRow {
  author_id: string;
  book_version_id: string;
}

interface OrderRow extends Record<string, unknown> {
  buyer_user_id: string;
  cart_id: string;
  cart_revision: number;
  created_at: Date | string;
  currency: "UAH";
  id: string;
  paid_at: Date | string | null;
  reference: string;
  status: OrderStatus;
  total_kopiykas: number | string;
}

interface OrderItemRow extends Record<string, unknown> {
  author_id: string;
  author_public_name_snapshot: string;
  base_price_kopiykas: number | string;
  book_id: string;
  book_version_id: string;
  cover_path_snapshot: string;
  discount_kopiykas: number | string;
  id: string;
  line_total_kopiykas: number | string;
  ordinal: number;
  quantity: number;
  title_snapshot: string;
  unit_price_kopiykas: number | string;
}

interface PaymentSessionRow extends Record<string, unknown> {
  amount_kopiykas: number | string;
  checkout_url: string | null;
  currency_numeric: number;
  failure_code: string | null;
  failure_reason: string | null;
  expires_at: Date | string;
  id: string;
  order_id: string;
  provider: "mono";
  provider_invoice_id: string | null;
  provider_modified_at: Date | string | null;
  reconciliation_attempt: number;
  request_key: string;
  status: PaymentSessionStatus;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new CommerceInputError("INVALID_ID", `${field} is invalid`);
  }
}

function safeInteger(value: number | string, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${field} is outside the safe integer range`);
  }
  return result;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid database timestamp");
  return parsed.toISOString();
}

function normalizedIdentity(identity: CartIdentity): {
  readonly anonymousToken: string | null;
  readonly buyerUserId: string | null;
} {
  const buyerUserId = identity.buyerUserId?.trim() || null;
  if (buyerUserId) assertUuid(buyerUserId, "buyerUserId");
  const anonymousToken = identity.anonymousToken?.trim() || null;
  if (anonymousToken && !isAnonymousCartToken(anonymousToken)) {
    throw new CommerceInputError(
      "INVALID_CART_TOKEN",
      "Anonymous cart token is invalid",
    );
  }
  return { anonymousToken, buyerUserId };
}

async function findOpenCart(
  executor: SqlExecutor,
  identity: ReturnType<typeof normalizedIdentity>,
  lock = false,
): Promise<CartRow | null> {
  const ownerSql = identity.buyerUserId
    ? "buyer_user_id = $1 AND anonymous_token_digest IS NULL"
    : "anonymous_token_digest = $1 AND buyer_user_id IS NULL";
  const owner = identity.buyerUserId
    ? identity.buyerUserId
    : identity.anonymousToken
      ? anonymousCartTokenDigest(identity.anonymousToken)
      : null;
  if (!owner) return null;
  const result = await executor.query<CartRow>(
    `
      SELECT id, buyer_user_id, anonymous_token_digest, status, revision
      FROM commerce_carts
      WHERE ${ownerSql}
        AND status IN ('active', 'checkout_pending')
      ${lock ? "FOR UPDATE" : ""}
    `,
    [owner],
  );
  return result.rows[0] ?? null;
}

async function createCart(
  connection: SqlConnection,
  identity: ReturnType<typeof normalizedIdentity>,
): Promise<CartRow> {
  const id = randomUUID();
  const digest = identity.anonymousToken
    ? anonymousCartTokenDigest(identity.anonymousToken)
    : null;
  await connection.query(
    `
      INSERT INTO commerce_carts (
        id, buyer_user_id, anonymous_token_digest, status
      ) VALUES ($1, $2, $3, 'active')
      ON CONFLICT DO NOTHING
    `,
    [id, identity.buyerUserId, digest],
  );
  const recovered = await findOpenCart(connection, identity, true);
  if (!recovered) throw new Error("Unable to create or recover cart");
  return recovered;
}

async function ensureCart(
  connection: SqlConnection,
  identity: ReturnType<typeof normalizedIdentity>,
): Promise<CartRow> {
  return (
    (await findOpenCart(connection, identity, true)) ??
    (await createCart(connection, identity))
  );
}

function isItemAvailable(row: CartItemRow): boolean {
  return (
    row.availability === "published" &&
    row.publication_state === "published" &&
    row.source_book_version_id !== null &&
    row.source_book_version_id === row.active_book_version_id
  );
}

async function loadCartById(
  executor: SqlExecutor,
  cartId: string,
  asOf: Date,
): Promise<CartReadModel> {
  const cartResult = await executor.query<CartRow>(
    `
      SELECT id, buyer_user_id, anonymous_token_digest, status, revision
      FROM commerce_carts
      WHERE id = $1
    `,
    [cartId],
  );
  const cart = cartResult.rows[0];
  if (!cart) throw new CommerceNotFoundError("Cart was not found");
  const items = await executor.query<CartItemRow>(
    `
      SELECT
        catalog.book_id,
        catalog.title,
        catalog.author_public_name,
        catalog.cover_path,
        catalog.base_price_kopiykas,
        catalog.discount_price_kopiykas,
        catalog.discount_starts_at,
        catalog.discount_ends_at,
        catalog.availability,
        catalog.source_book_version_id,
        publication.active_book_version_id,
        publication.state AS publication_state
      FROM commerce_cart_items cart_item
      JOIN catalog_book_read_models catalog
        ON catalog.book_id = cart_item.book_id
      LEFT JOIN book_publications publication
        ON publication.book_id = catalog.book_id
      WHERE cart_item.cart_id = $1
      ORDER BY cart_item.added_at ASC, catalog.book_id ASC
    `,
    [cartId],
  );
  const presented = items.rows.map((row) => {
    const price = presentPrice(
      {
        basePriceKopiykas: row.base_price_kopiykas,
        discountEndsAt: row.discount_ends_at,
        discountPriceKopiykas: row.discount_price_kopiykas,
        discountStartsAt: row.discount_starts_at,
      },
      asOf,
    );
    return {
      actualPriceKopiykas: price.actualPriceKopiykas,
      authorPublicName: row.author_public_name,
      available: isItemAvailable(row),
      basePriceKopiykas: price.basePriceKopiykas,
      bookId: row.book_id,
      coverPath: row.cover_path,
      discountKopiykas:
        price.basePriceKopiykas - price.actualPriceKopiykas,
      formattedActualPrice: price.formattedActualPrice,
      title: row.title,
    };
  });
  const totalKopiykas = presented.reduce(
    (total, item) => total + item.actualPriceKopiykas,
    0,
  );
  return {
    checkoutAllowed:
      cart.status === "active" &&
      presented.length > 0 &&
      totalKopiykas > 0 &&
      presented.every((item) => item.available),
    formattedTotal: formatUah(totalKopiykas),
    id: cart.id,
    items: presented,
    revision: cart.revision,
    schemaVersion: COMMERCE_SCHEMA_VERSION,
    status: cart.status,
    totalKopiykas,
  };
}

async function mergeAnonymousCartInTransaction(
  connection: SqlConnection,
  buyerUserId: string,
  anonymousToken: string,
): Promise<CartRow | null> {
  const buyerIdentity = normalizedIdentity({ buyerUserId });
  const anonymousIdentity = normalizedIdentity({ anonymousToken });
  const guest = await findOpenCart(connection, anonymousIdentity, true);
  let buyer = await findOpenCart(connection, buyerIdentity, true);
  if (!guest) return buyer;
  if (!buyer) buyer = await createCart(connection, buyerIdentity);
  if (buyer.status !== "active") {
    throw new CommerceConflictError(
      "CART_CHECKOUT_PENDING",
      "Завершіть поточну оплату перед об’єднанням кошика.",
    );
  }
  const copied = await connection.query<{ book_id: string }>(
    `
      INSERT INTO commerce_cart_items (cart_id, book_id, added_at)
      SELECT $1, book_id, added_at
      FROM commerce_cart_items
      WHERE cart_id = $2
      ON CONFLICT (cart_id, book_id) DO NOTHING
      RETURNING book_id
    `,
    [buyer.id, guest.id],
  );
  if (copied.rows.length > 0) {
    const updated = await connection.query<CartRow>(
      `
        UPDATE commerce_carts
        SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'active'
        RETURNING id, buyer_user_id, anonymous_token_digest, status, revision
      `,
      [buyer.id],
    );
    buyer = updated.rows[0] ?? buyer;
  }
  await connection.query(
    `
      UPDATE commerce_carts
      SET status = 'merged',
          merged_into_cart_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'active'
    `,
    [guest.id, buyer.id],
  );
  return buyer;
}

export async function loadCart(
  database: SqlDatabase,
  identityInput: CartIdentity,
  asOf = new Date(),
): Promise<CartReadModel | null> {
  const identity = normalizedIdentity(identityInput);
  const cart = await findOpenCart(database, identity);
  return cart ? loadCartById(database, cart.id, asOf) : null;
}

export async function getCartCount(
  database: SqlDatabase,
  identity: CartIdentity,
): Promise<number> {
  return (await loadCart(database, identity))?.items.length ?? 0;
}

export async function addCartItem(
  database: SqlDatabase,
  input: CartIdentity & { readonly bookId: string },
): Promise<CartMutationResult> {
  assertUuid(input.bookId, "bookId");
  let identity = normalizedIdentity(input);
  let rawToken = identity.anonymousToken;
  if (!identity.buyerUserId && !rawToken) {
    rawToken = createAnonymousCartToken();
    identity = normalizedIdentity({ anonymousToken: rawToken });
  }
  return withDomainTransaction(database, async (transaction) => {
    const { connection } = transaction;
    let cart: CartRow | null = null;
    if (identity.buyerUserId && identity.anonymousToken) {
      cart = await mergeAnonymousCartInTransaction(
        connection,
        identity.buyerUserId,
        identity.anonymousToken,
      );
    }
    cart ??= await ensureCart(
      connection,
      identity.buyerUserId
        ? normalizedIdentity({ buyerUserId: identity.buyerUserId })
        : identity,
    );
    if (cart.status !== "active") {
      throw new CommerceConflictError(
        "CART_CHECKOUT_PENDING",
        "Кошик уже очікує оплату.",
      );
    }
    const available = await connection.query<{ book_id: string }>(
      `
        SELECT catalog.book_id
        FROM catalog_book_read_models catalog
        JOIN book_publications publication
          ON publication.book_id = catalog.book_id
         AND publication.state = 'published'
         AND publication.active_book_version_id = catalog.source_book_version_id
        WHERE catalog.book_id = $1
          AND catalog.availability = 'published'
      `,
      [input.bookId],
    );
    if (!available.rows[0]) {
      throw new CommerceConflictError(
        "BOOK_UNAVAILABLE",
        "Ця книжка зараз недоступна для купівлі.",
      );
    }
    const inserted = await connection.query<{ book_id: string }>(
      `
        INSERT INTO commerce_cart_items (cart_id, book_id)
        VALUES ($1, $2)
        ON CONFLICT (cart_id, book_id) DO NOTHING
        RETURNING book_id
      `,
      [cart.id, input.bookId],
    );
    if (inserted.rows[0]) {
      await connection.query(
        `
          UPDATE commerce_carts
          SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [cart.id],
      );
    }
    return {
      anonymousToken: identity.buyerUserId ? null : rawToken,
      cart: await loadCartById(connection, cart.id, new Date()),
    };
  });
}

export async function removeCartItem(
  database: SqlDatabase,
  input: CartIdentity & { readonly bookId: string },
): Promise<CartMutationResult | null> {
  assertUuid(input.bookId, "bookId");
  const identity = normalizedIdentity(input);
  if (!identity.buyerUserId && !identity.anonymousToken) return null;
  return withDomainTransaction(database, async ({ connection }) => {
    let cart: CartRow | null = null;
    if (identity.buyerUserId && identity.anonymousToken) {
      cart = await mergeAnonymousCartInTransaction(
        connection,
        identity.buyerUserId,
        identity.anonymousToken,
      );
    }
    cart ??= await findOpenCart(
      connection,
      identity.buyerUserId
        ? normalizedIdentity({ buyerUserId: identity.buyerUserId })
        : identity,
      true,
    );
    if (!cart) return null;
    if (cart.status !== "active") {
      throw new CommerceConflictError(
        "CART_CHECKOUT_PENDING",
        "Кошик уже очікує оплату.",
      );
    }
    const removed = await connection.query<{ book_id: string }>(
      `
        DELETE FROM commerce_cart_items
        WHERE cart_id = $1 AND book_id = $2
        RETURNING book_id
      `,
      [cart.id, input.bookId],
    );
    if (removed.rows[0]) {
      await connection.query(
        `
          UPDATE commerce_carts
          SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [cart.id],
      );
    }
    return {
      anonymousToken: identity.buyerUserId ? null : identity.anonymousToken,
      cart: await loadCartById(connection, cart.id, new Date()),
    };
  });
}

export async function mergeAnonymousCart(
  database: SqlDatabase,
  input: { readonly anonymousToken: string; readonly buyerUserId: string },
): Promise<CartReadModel | null> {
  const identity = normalizedIdentity(input);
  if (!identity.buyerUserId || !identity.anonymousToken) {
    throw new CommerceInputError(
      "CART_IDENTITY_REQUIRED",
      "Buyer and anonymous cart identities are required",
    );
  }
  const buyerUserId = identity.buyerUserId;
  const anonymousToken = identity.anonymousToken;
  return withDomainTransaction(database, async ({ connection }) => {
    const cart = await mergeAnonymousCartInTransaction(
      connection,
      buyerUserId,
      anonymousToken,
    );
    return cart ? loadCartById(connection, cart.id, new Date()) : null;
  });
}

function mapOrderItem(row: OrderItemRow): OrderItemSnapshot {
  if (row.quantity !== 1) throw new Error("Order item quantity is invalid");
  return {
    authorId: row.author_id,
    authorPublicName: row.author_public_name_snapshot,
    basePriceKopiykas: safeInteger(
      row.base_price_kopiykas,
      "base_price_kopiykas",
    ),
    bookId: row.book_id,
    bookVersionId: row.book_version_id,
    coverPath: row.cover_path_snapshot,
    discountKopiykas: safeInteger(
      row.discount_kopiykas,
      "discount_kopiykas",
    ),
    id: row.id,
    lineTotalKopiykas: safeInteger(
      row.line_total_kopiykas,
      "line_total_kopiykas",
    ),
    ordinal: row.ordinal,
    quantity: 1,
    title: row.title_snapshot,
    unitPriceKopiykas: safeInteger(
      row.unit_price_kopiykas,
      "unit_price_kopiykas",
    ),
  };
}

async function loadOrder(
  executor: SqlExecutor,
  orderId: string,
  buyerUserId?: string,
): Promise<CheckoutOrder | null> {
  const orderResult = await executor.query<OrderRow>(
    `
      SELECT
        id, buyer_user_id, cart_id, cart_revision, reference, status,
        currency, total_kopiykas, paid_at, created_at
      FROM commerce_orders
      WHERE id = $1
        AND ($2::uuid IS NULL OR buyer_user_id = $2)
    `,
    [orderId, buyerUserId ?? null],
  );
  const order = orderResult.rows[0];
  if (!order) return null;
  const items = await executor.query<OrderItemRow>(
    `
      SELECT
        id, ordinal, book_id, book_version_id, author_id, title_snapshot,
        author_public_name_snapshot, cover_path_snapshot, quantity,
        base_price_kopiykas, discount_kopiykas, unit_price_kopiykas,
        line_total_kopiykas
      FROM commerce_order_items
      WHERE order_id = $1
      ORDER BY ordinal ASC
    `,
    [orderId],
  );
  return {
    buyerUserId: order.buyer_user_id,
    cartId: order.cart_id,
    cartRevision: order.cart_revision,
    createdAt: iso(order.created_at) as string,
    currency: order.currency,
    id: order.id,
    items: items.rows.map(mapOrderItem),
    paidAt: iso(order.paid_at),
    reference: order.reference,
    status: order.status,
    totalKopiykas: safeInteger(order.total_kopiykas, "total_kopiykas"),
  };
}

function mapPaymentSession(row: PaymentSessionRow): PaymentSession {
  if (row.currency_numeric !== 980) {
    throw new Error("Payment session currency is invalid");
  }
  return {
    amountKopiykas: safeInteger(row.amount_kopiykas, "amount_kopiykas"),
    checkoutUrl: row.checkout_url,
    currencyNumeric: 980,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    expiresAt: iso(row.expires_at) as string,
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    providerInvoiceId: row.provider_invoice_id,
    providerModifiedAt: iso(row.provider_modified_at),
    reconciliationAttempt: row.reconciliation_attempt,
    requestKey: row.request_key,
    status: row.status,
  };
}

async function loadPaymentSession(
  executor: SqlExecutor,
  paymentSessionId: string,
): Promise<PaymentSession | null> {
  const result = await executor.query<PaymentSessionRow>(
    `
      SELECT
        id, order_id, provider, request_key, provider_invoice_id,
        checkout_url, status, amount_kopiykas, currency_numeric,
        provider_modified_at, failure_code, failure_reason, expires_at,
        reconciliation_attempt
      FROM commerce_payment_sessions
      WHERE id = $1
    `,
    [paymentSessionId],
  );
  return result.rows[0] ? mapPaymentSession(result.rows[0]) : null;
}

async function snapshotCandidates(
  executor: SqlExecutor,
  cartId: string,
  asOf: Date,
): Promise<readonly (SnapshotCandidateRow & {
  readonly actualPriceKopiykas: number;
  readonly discountKopiykas: number;
})[]> {
  const cartCount = await executor.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM commerce_cart_items
      WHERE cart_id = $1
    `,
    [cartId],
  );
  const rows = await executor.query<SnapshotCandidateRow>(
    `
      SELECT
        catalog.book_id,
        catalog.title,
        catalog.author_public_name,
        catalog.cover_path,
        catalog.base_price_kopiykas,
        catalog.discount_price_kopiykas,
        catalog.discount_starts_at,
        catalog.discount_ends_at,
        catalog.availability,
        catalog.source_book_version_id,
        publication.active_book_version_id,
        publication.state AS publication_state,
        version.id AS book_version_id,
        version.author_id
      FROM commerce_cart_items cart_item
      JOIN catalog_book_read_models catalog
        ON catalog.book_id = cart_item.book_id
      JOIN book_publications publication
        ON publication.book_id = catalog.book_id
       AND publication.state = 'published'
       AND publication.active_book_version_id = catalog.source_book_version_id
      JOIN publishing_book_versions version
        ON version.id = publication.active_book_version_id
       AND version.book_id = catalog.book_id
       AND version.author_id = catalog.author_public_id
      JOIN author_profiles author
        ON author.user_id = version.author_id
      WHERE cart_item.cart_id = $1
        AND catalog.availability = 'published'
      ORDER BY cart_item.added_at ASC, catalog.book_id ASC
    `,
    [cartId],
  );
  if ((cartCount.rows[0]?.count ?? 0) === 0) {
    throw new CommerceConflictError("CART_EMPTY", "Кошик порожній.");
  }
  if (rows.rows.length !== cartCount.rows[0]?.count) {
    throw new CommerceConflictError(
      "CART_ITEM_UNAVAILABLE",
      "Одна або кілька книжок більше недоступні. Кошик збережено.",
    );
  }
  return rows.rows.map((row) => {
    const price = presentPrice(
      {
        basePriceKopiykas: row.base_price_kopiykas,
        discountEndsAt: row.discount_ends_at,
        discountPriceKopiykas: row.discount_price_kopiykas,
        discountStartsAt: row.discount_starts_at,
      },
      asOf,
    );
    return {
      ...row,
      actualPriceKopiykas: price.actualPriceKopiykas,
      discountKopiykas:
        price.basePriceKopiykas - price.actualPriceKopiykas,
    };
  });
}

async function scheduleReconciliation(
  transaction: DomainTransaction,
  input: {
    readonly attempt: number;
    readonly correlationId: string;
    readonly maxAttempts: number;
    readonly notBefore: string;
    readonly paymentSessionId: string;
    readonly purpose: "creation_watchdog" | "status";
  },
): Promise<void> {
  const payload: PaymentReconciliationJobPayload = {
    attempt: input.attempt,
    notBefore: input.notBefore,
    paymentSessionId: input.paymentSessionId,
    purpose: input.purpose,
    schemaVersion: COMMERCE_SCHEMA_VERSION,
  };
  const idempotencyKey =
    input.purpose === "creation_watchdog"
      ? `commerce.creation-watchdog:${input.paymentSessionId}`
      : `commerce.reconcile:${input.paymentSessionId}:${input.attempt}`;
  const jobType =
    input.purpose === "creation_watchdog"
      ? PAYMENT_CREATION_WATCHDOG_JOB_TYPE
      : PAYMENT_RECONCILIATION_JOB_TYPE;
  const existing = await transaction.connection.query<{
    correlation_id: string;
    job_type: string;
    payload: JsonObject | string;
  }>(
    `
      SELECT job_type, correlation_id, payload
      FROM durable_jobs
      WHERE queue = $1 AND idempotency_key = $2
    `,
    [COMMERCE_QUEUE, idempotencyKey],
  );
  if (existing.rows[0]) {
    const storedPayload =
      typeof existing.rows[0].payload === "string"
        ? (JSON.parse(existing.rows[0].payload) as JsonObject)
        : existing.rows[0].payload;
    if (
      existing.rows[0].job_type !== jobType ||
      existing.rows[0].correlation_id !== input.correlationId ||
      storedPayload.schemaVersion !== COMMERCE_SCHEMA_VERSION ||
      storedPayload.paymentSessionId !== input.paymentSessionId ||
      storedPayload.attempt !== input.attempt ||
      storedPayload.purpose !== input.purpose
    ) {
      throw new Error(
        `Payment job idempotency conflict for ${idempotencyKey}`,
      );
    }
    return;
  }
  await transaction.enqueue({
    availableAt: input.notBefore,
    correlationId: input.correlationId,
    idempotencyKey,
    jobType,
    jobVersion: PAYMENT_RECONCILIATION_JOB_VERSION,
    maxAttempts: input.maxAttempts,
    payload: payload as unknown as JsonObject,
    queue: COMMERCE_QUEUE,
  });
}

interface PreparedCheckout {
  readonly expiresAt: string;
  readonly items: readonly OrderItemSnapshot[];
  readonly orderId: string;
  readonly paymentSessionId: string;
  readonly reused: boolean;
}

async function prepareCheckout(
  database: SqlDatabase,
  input: {
    readonly anonymousToken?: string;
    readonly buyerUserId: string;
    readonly validitySeconds: number;
  },
): Promise<PreparedCheckout> {
  const identity = normalizedIdentity(input);
  if (!identity.buyerUserId) {
    throw new CommerceInputError(
      "AUTHENTICATION_REQUIRED",
      "Увійдіть, щоб перейти до оплати.",
    );
  }
  return withDomainTransaction(database, async (transaction) => {
    const { connection } = transaction;
    let cart =
      identity.anonymousToken === null
        ? null
        : await mergeAnonymousCartInTransaction(
            connection,
            identity.buyerUserId as string,
            identity.anonymousToken,
          );
    cart ??= await findOpenCart(
      connection,
      normalizedIdentity({ buyerUserId: identity.buyerUserId as string }),
      true,
    );
    if (!cart) {
      throw new CommerceConflictError("CART_EMPTY", "Кошик порожній.");
    }
    if (cart.status === "checkout_pending") {
      const existing = await connection.query<{
        order_id: string;
        payment_session_id: string;
      }>(
        `
          SELECT
            orders.id AS order_id,
            session.id AS payment_session_id
          FROM commerce_orders orders
          JOIN commerce_payment_sessions session
            ON session.order_id = orders.id
           AND session.status = ANY($3::text[])
          WHERE orders.cart_id = $1
            AND orders.cart_revision = $2
          ORDER BY session.created_at DESC
          LIMIT 1
        `,
        [cart.id, cart.revision, OPEN_PAYMENT_STATUSES],
      );
      const pending = existing.rows[0];
      if (!pending) {
        throw new CommerceConflictError(
          "PAYMENT_STATE_UNAVAILABLE",
          "Не вдалося відновити поточну оплату.",
        );
      }
      const session = await loadPaymentSession(
        connection,
        pending.payment_session_id,
      );
      const order = await loadOrder(connection, pending.order_id);
      if (!session || !order) {
        throw new Error("Checkout state was lost");
      }
      if (!session.checkoutUrl) {
        throw new CommerceConflictError(
          "PAYMENT_START_IN_PROGRESS",
          "Платіжна сторінка ще готується. Спробуйте за мить.",
        );
      }
      return {
        expiresAt: new Date(
          Date.now() + input.validitySeconds * 1_000,
        ).toISOString(),
        items: order.items,
        orderId: order.id,
        paymentSessionId: session.id,
        reused: true,
      };
    }
    const asOf = new Date();
    const candidates = await snapshotCandidates(connection, cart.id, asOf);
    const totalKopiykas = candidates.reduce(
      (total, item) => total + item.actualPriceKopiykas,
      0,
    );
    if (totalKopiykas <= 0) {
      throw new CommerceConflictError(
        "PAYMENT_AMOUNT_INVALID",
        "Сума замовлення має бути більшою за нуль.",
      );
    }
    let orderResult = await connection.query<OrderRow>(
      `
        SELECT
          id, buyer_user_id, cart_id, cart_revision, reference, status,
          currency, total_kopiykas, paid_at, created_at
        FROM commerce_orders
        WHERE cart_id = $1 AND cart_revision = $2
        FOR UPDATE
      `,
      [cart.id, cart.revision],
    );
    let order = orderResult.rows[0];
    if (!order) {
      const orderId = randomUUID();
      const reference = `ukiebook-${orderId}`;
      orderResult = await connection.query<OrderRow>(
        `
          INSERT INTO commerce_orders (
            id, buyer_user_id, cart_id, cart_revision, reference,
            status, currency, total_kopiykas
          ) VALUES ($1, $2, $3, $4, $5, 'payment_pending', 'UAH', $6)
          RETURNING
            id, buyer_user_id, cart_id, cart_revision, reference, status,
            currency, total_kopiykas, paid_at, created_at
        `,
        [
          orderId,
          identity.buyerUserId,
          cart.id,
          cart.revision,
          reference,
          totalKopiykas,
        ],
      );
      order = orderResult.rows[0];
      if (!order) throw new Error("Unable to create order");
      for (const [index, item] of candidates.entries()) {
        await connection.query(
          `
            INSERT INTO commerce_order_items (
              id, order_id, ordinal, book_id, book_version_id, author_id,
              title_snapshot, author_public_name_snapshot, cover_path_snapshot,
              quantity, base_price_kopiykas, discount_kopiykas,
              unit_price_kopiykas, line_total_kopiykas
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              1, $10, $11, $12, $12
            )
          `,
          [
            randomUUID(),
            order.id,
            index + 1,
            item.book_id,
            item.book_version_id,
            item.author_id,
            item.title,
            item.author_public_name,
            item.cover_path,
            item.base_price_kopiykas,
            item.discountKopiykas,
            item.actualPriceKopiykas,
          ],
        );
      }
    } else {
      if (order.status === "paid") {
        throw new CommerceConflictError(
          "ORDER_ALREADY_PAID",
          "Замовлення вже оплачено.",
        );
      }
      // The existing immutable snapshot wins on a retry even if a timed
      // catalog discount has changed without a cart mutation.
      await connection.query(
        `
          UPDATE commerce_orders
          SET status = 'payment_pending',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'payment_failed'
        `,
        [order.id],
      );
    }
    const immutableOrder = await loadOrder(connection, order.id);
    if (!immutableOrder) throw new Error("Order snapshot was lost");
    const attempts = await connection.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM commerce_payment_sessions
        WHERE order_id = $1
      `,
      [order.id],
    );
    const attempt = (attempts.rows[0]?.count ?? 0) + 1;
    const paymentSessionId = randomUUID();
    const expiresAt = new Date(
      Date.now() + input.validitySeconds * 1_000,
    ).toISOString();
    await connection.query(
      `
        INSERT INTO commerce_payment_sessions (
          id, order_id, request_key, status, amount_kopiykas,
          currency_numeric, expires_at
        ) VALUES (
          $1, $2, $3, 'creating', $4, 980,
          $5
        )
      `,
      [
        paymentSessionId,
        order.id,
        `mono:${order.id}:${attempt}`,
        immutableOrder.totalKopiykas,
        expiresAt,
      ],
    );
    await connection.query(
      `
        UPDATE commerce_carts
        SET status = 'checkout_pending', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'active'
      `,
      [cart.id],
    );
    await scheduleReconciliation(transaction, {
      attempt: 0,
      correlationId: order.id,
      maxAttempts: 8,
      // Mono validity begins provider-side. The grace window exceeds the
      // adapter timeout so an uncertain invoice is no longer payable before
      // the cart can be unlocked.
      notBefore: new Date(Date.parse(expiresAt) + 60_000).toISOString(),
      paymentSessionId,
      purpose: "creation_watchdog",
    });
    return {
      expiresAt,
      items: immutableOrder.items,
      orderId: order.id,
      paymentSessionId,
      reused: false,
    };
  });
}

export async function startCheckout(input: {
  readonly anonymousToken?: string;
  readonly appOrigin: string;
  readonly buyerUserId: string;
  readonly database: SqlDatabase;
  readonly provider: PaymentProviderAdapter;
  readonly reconciliationIntervalMs: number;
  readonly validitySeconds: number;
}): Promise<StartCheckoutResult> {
  const prepared = await prepareCheckout(input.database, input);
  if (prepared.reused) {
    const [order, paymentSession] = await Promise.all([
      loadOrder(input.database, prepared.orderId, input.buyerUserId),
      loadPaymentSession(input.database, prepared.paymentSessionId),
    ]);
    if (!order || !paymentSession?.checkoutUrl) {
      throw new Error("Reusable checkout state was lost");
    }
    return {
      order,
      paymentSession,
      redirectUrl: paymentSession.checkoutUrl,
    };
  }
  const order = await loadOrder(
    input.database,
    prepared.orderId,
    input.buyerUserId,
  );
  if (!order) throw new Error("Prepared order was lost");
  const appOrigin = new URL(input.appOrigin).origin;
  let created: Awaited<ReturnType<PaymentProviderAdapter["createInvoice"]>>;
  try {
    created = await input.provider.createInvoice({
      amountKopiykas: order.totalKopiykas,
      currencyNumeric: 980,
      destination: `Книжки UkieBook: ${order.items.length}`,
      items: order.items.map((item) => ({
        bookId: item.bookId,
        name: item.title,
        unitPriceKopiykas: item.unitPriceKopiykas,
      })),
      orderReference: order.reference,
      redirectUrl: new URL(
        `/checkout/result?order=${encodeURIComponent(order.id)}`,
        appOrigin,
      ).toString(),
      validitySeconds: input.validitySeconds,
      webhookUrl: new URL("/api/payments/mono/webhook", appOrigin).toString(),
    });
  } catch (error) {
    await withDomainTransaction(input.database, async ({ connection }) => {
      if (
        error instanceof PaymentProviderConfigurationError ||
        error instanceof PaymentProviderRejectedError
      ) {
        await connection.query(
          `
            UPDATE commerce_payment_sessions
            SET status = 'failure',
                failure_code = 'invoice_rejected',
                failure_reason = 'Платіжний сервіс відхилив запит.',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'creating'
          `,
          [prepared.paymentSessionId],
        );
        await connection.query(
          `
            UPDATE commerce_orders
            SET status = 'payment_failed', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'payment_pending'
          `,
          [prepared.orderId],
        );
        await connection.query(
          `
            UPDATE commerce_carts
            SET status = 'active', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'checkout_pending'
          `,
          [order.cartId],
        );
      } else {
        await connection.query(
          `
            UPDATE commerce_payment_sessions
            SET status = 'creation_unknown',
                failure_code = 'invoice_creation_unknown',
                failure_reason = 'Стан створення платежу уточнюється.',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'creating'
          `,
          [prepared.paymentSessionId],
        );
        await recordIssue(
          connection,
          prepared.paymentSessionId,
          "creation_unknown",
          { orderId: prepared.orderId },
        );
      }
    });
    throw error;
  }
  const firstReconciliationAt = new Date(
    Date.now() + input.reconciliationIntervalMs,
  ).toISOString();
  await withDomainTransaction(input.database, async (transaction) => {
    const updated = await transaction.connection.query<{ id: string }>(
      `
        UPDATE commerce_payment_sessions
        SET provider_invoice_id = $2,
            checkout_url = $3,
            status = 'created',
            provider_created_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'creating'
        RETURNING id
      `,
      [prepared.paymentSessionId, created.invoiceId, created.checkoutUrl],
    );
    if (!updated.rows[0]) {
      throw new CommerceConflictError(
        "PAYMENT_SESSION_CHANGED",
        "Стан платіжної сесії вже змінився.",
      );
    }
    await scheduleReconciliation(transaction, {
      attempt: 0,
      correlationId: order.id,
      maxAttempts: 8,
      notBefore: firstReconciliationAt,
      paymentSessionId: prepared.paymentSessionId,
      purpose: "status",
    });
  });
  const paymentSession = await loadPaymentSession(
    input.database,
    prepared.paymentSessionId,
  );
  if (!paymentSession?.checkoutUrl) {
    throw new Error("Created payment session was lost");
  }
  return {
    order,
    paymentSession,
    redirectUrl: paymentSession.checkoutUrl,
  };
}

interface LockedPaymentRow extends PaymentSessionRow {
  buyer_user_id: string;
  cart_id: string;
  order_reference: string;
  order_status: OrderStatus;
  order_total_kopiykas: number | string;
}

function providerEventKey(
  observation: MonoInvoiceObservation,
  source: "reconciliation" | "webhook",
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        observation.invoiceId,
        observation.status,
        observation.modifiedAt,
        observation.amountKopiykas,
        observation.finalAmountKopiykas,
        observation.currencyNumeric,
        observation.reference,
        // A provider timestamp identifies the same semantic event across
        // delivery channels. Without it, keep webhook evidence distinct from
        // a later authoritative status read so reconciliation can promote the
        // terminal state safely.
        observation.modifiedAt === null ? source : "provider",
      ]),
    )
    .digest("hex");
}

function isAllowedPaymentTransition(
  current: PaymentSessionStatus,
  next: PaymentSessionStatus,
): boolean {
  if (current === next) return true;
  const transitions: Readonly<
    Partial<Record<PaymentSessionStatus, readonly PaymentSessionStatus[]>>
  > = {
    created: [
      "processing",
      "hold",
      "success",
      "failure",
      "reversed",
      "expired",
    ],
    processing: ["hold", "success", "failure", "reversed", "expired"],
    hold: ["processing", "success", "failure", "reversed", "expired"],
  };
  return transitions[current]?.includes(next) ?? false;
}

async function recordIssue(
  connection: SqlConnection,
  paymentSessionId: string,
  issueType:
    | "amount_mismatch"
    | "currency_mismatch"
    | "reference_mismatch"
    | "duplicate_success"
    | "status_conflict"
    | "creation_unknown"
    | "reconciliation_overdue",
  details: JsonObject,
): Promise<void> {
  await connection.query(
    `
      INSERT INTO commerce_reconciliation_issues (
        id, payment_session_id, issue_type, details
      ) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT DO NOTHING
    `,
    [randomUUID(), paymentSessionId, issueType, JSON.stringify(details)],
  );
}

async function applyPaymentObservation(
  database: SqlDatabase,
  input: {
    readonly bodySha256?: string;
    readonly nextReconciliation?: {
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly notBefore: string;
    };
    readonly observation: MonoInvoiceObservation;
    readonly observedAt: string;
    readonly signatureVerified: boolean;
    readonly source: "reconciliation" | "webhook";
  },
): Promise<PaymentObservationResult> {
  return withDomainTransaction(database, async (transaction) => {
    const locked = await transaction.connection.query<LockedPaymentRow>(
      `
        SELECT
          session.id,
          session.order_id,
          session.provider,
          session.request_key,
          session.provider_invoice_id,
          session.checkout_url,
          session.status,
          session.amount_kopiykas,
          session.currency_numeric,
          session.provider_modified_at,
          session.failure_code,
          session.failure_reason,
          session.expires_at,
          session.reconciliation_attempt,
          orders.buyer_user_id,
          orders.cart_id,
          orders.reference AS order_reference,
          orders.status AS order_status,
          orders.total_kopiykas AS order_total_kopiykas
        FROM commerce_payment_sessions session
        JOIN commerce_orders orders ON orders.id = session.order_id
        WHERE session.provider_invoice_id = $1
        FOR UPDATE OF session, orders
      `,
      [input.observation.invoiceId],
    );
    const payment = locked.rows[0];
    if (!payment) {
      throw new CommerceNotFoundError("Mono invoice was not found");
    }
    const scheduleNextIfOpen = async (): Promise<void> => {
      if (
        input.nextReconciliation &&
        (["created", "processing", "hold"] as const).includes(
          payment.status as "created" | "processing" | "hold",
        )
      ) {
        await scheduleReconciliation(transaction, {
          ...input.nextReconciliation,
          correlationId: payment.order_id,
          paymentSessionId: payment.id,
          purpose: "status",
        });
      }
    };
    const eventKey = providerEventKey(input.observation, input.source);
    const inserted = await transaction.connection.query<{ id: string }>(
      `
        INSERT INTO commerce_payment_observations (
          id, payment_session_id, provider_event_key, source,
          provider_status, amount_kopiykas, final_amount_kopiykas,
          currency_numeric, provider_reference, provider_modified_at,
          body_sha256, signature_verified
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        ON CONFLICT (provider_event_key) DO NOTHING
        RETURNING id
      `,
      [
        randomUUID(),
        payment.id,
        eventKey,
        input.source,
        input.observation.status,
        input.observation.amountKopiykas,
        input.observation.finalAmountKopiykas,
        input.observation.currencyNumeric,
        input.observation.reference,
        input.observation.modifiedAt,
        input.bodySha256 ?? null,
        input.signatureVerified,
      ],
    );
    let promotesWebhookEvidence = false;
    if (!inserted.rows[0]) {
      const existingObservation =
        await transaction.connection.query<{
          applied: boolean;
          payment_session_id: string;
          source: "reconciliation" | "webhook";
        }>(
          `
            SELECT payment_session_id, source, applied
            FROM commerce_payment_observations
            WHERE provider_event_key = $1
          `,
          [eventKey],
        );
      const existing = existingObservation.rows[0];
      promotesWebhookEvidence =
        input.source === "reconciliation" &&
        existing?.payment_session_id === payment.id &&
        existing.source === "webhook" &&
        !existing.applied;
      if (!promotesWebhookEvidence) {
        await scheduleNextIfOpen();
        return {
          applied: false,
          duplicate: true,
          orderId: payment.order_id,
          paymentSessionId: payment.id,
          status: payment.status,
        };
      }
    }

    const expectedAmount = safeInteger(
      payment.amount_kopiykas,
      "amount_kopiykas",
    );
    const orderTotal = safeInteger(
      payment.order_total_kopiykas,
      "order_total_kopiykas",
    );
    if (expectedAmount !== orderTotal) {
      await recordIssue(
        transaction.connection,
        payment.id,
        "amount_mismatch",
        {
          actualSessionAmount: expectedAmount,
          expectedOrderTotal: orderTotal,
          providerEventKey: eventKey,
        },
      );
      return {
        applied: false,
        duplicate: false,
        orderId: payment.order_id,
        paymentSessionId: payment.id,
        status: payment.status,
      };
    }
    const mismatch: {
      readonly actual: string | number | null;
      readonly expected: string | number;
      readonly type:
        | "amount_mismatch"
        | "currency_mismatch"
        | "reference_mismatch";
    } | null =
      input.observation.amountKopiykas !== expectedAmount ||
      (input.observation.status === "success" &&
        input.observation.finalAmountKopiykas !== null &&
        input.observation.finalAmountKopiykas !== expectedAmount)
        ? {
            actual:
              input.observation.status === "success"
                ? input.observation.finalAmountKopiykas
                : input.observation.amountKopiykas,
            expected: expectedAmount,
            type: "amount_mismatch",
          }
        : input.observation.currencyNumeric !== 980
          ? {
              actual: input.observation.currencyNumeric,
              expected: 980,
              type: "currency_mismatch",
            }
          : input.observation.reference !== null &&
              input.observation.reference !== payment.order_reference
            ? {
                actual: input.observation.reference,
                expected: payment.order_reference,
                type: "reference_mismatch",
              }
            : null;
    if (mismatch) {
      await recordIssue(
        transaction.connection,
        payment.id,
        mismatch.type,
        {
          actual: mismatch.actual,
          expected: mismatch.expected,
          providerEventKey: eventKey,
        },
      );
      return {
        applied: false,
        duplicate: false,
        orderId: payment.order_id,
        paymentSessionId: payment.id,
        status: payment.status,
      };
    }

    if (
      input.observation.modifiedAt === null &&
      (input.source === "webhook" ||
        ["created", "processing", "hold"].includes(input.observation.status))
    ) {
      await scheduleNextIfOpen();
      return {
        applied: false,
        duplicate: false,
        orderId: payment.order_id,
        paymentSessionId: payment.id,
        status: payment.status,
      };
    }
    const previousModifiedAt = iso(payment.provider_modified_at);
    const observedTime =
      input.observation.modifiedAt === null
        ? null
        : Date.parse(input.observation.modifiedAt);
    const previousTime = previousModifiedAt
      ? Date.parse(previousModifiedAt)
      : Number.NEGATIVE_INFINITY;
    if (observedTime !== null && observedTime < previousTime) {
      await scheduleNextIfOpen();
      return {
        applied: false,
        duplicate: false,
        orderId: payment.order_id,
        paymentSessionId: payment.id,
        status: payment.status,
      };
    }
    if (
      observedTime !== null &&
      observedTime === previousTime &&
      input.observation.status !== payment.status &&
      input.source !== "reconciliation"
    ) {
      await recordIssue(
        transaction.connection,
        payment.id,
        "status_conflict",
        {
          currentStatus: payment.status,
          observedStatus: input.observation.status,
          providerModifiedAt: input.observation.modifiedAt,
        },
      );
      await scheduleNextIfOpen();
      return {
        applied: false,
        duplicate: false,
        orderId: payment.order_id,
        paymentSessionId: payment.id,
        status: payment.status,
      };
    }
    if (!isAllowedPaymentTransition(payment.status, input.observation.status)) {
      await recordIssue(
        transaction.connection,
        payment.id,
        "status_conflict",
        {
          currentStatus: payment.status,
          observedStatus: input.observation.status,
          providerModifiedAt: input.observation.modifiedAt,
        },
      );
      await scheduleNextIfOpen();
      return {
        applied: false,
        duplicate: false,
        orderId: payment.order_id,
        paymentSessionId: payment.id,
        status: payment.status,
      };
    }

    await transaction.connection.query(
      `
        UPDATE commerce_payment_sessions
        SET status = $2,
            provider_created_at = COALESCE(provider_created_at, $3),
            provider_modified_at = COALESCE($4, provider_modified_at),
            failure_code = $5,
            failure_reason = $6,
            reconciliation_attempt = CASE
              WHEN $7::text = 'reconciliation'
                THEN reconciliation_attempt + 1
              ELSE reconciliation_attempt
            END,
            last_reconciled_at = CASE
              WHEN $7::text = 'reconciliation' THEN CURRENT_TIMESTAMP
              ELSE last_reconciled_at
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        payment.id,
        input.observation.status,
        input.observation.createdAt,
        input.observation.modifiedAt,
        input.observation.failureCode,
        input.observation.failureReason,
        input.source,
      ],
    );
    if (
      ["success", "failure", "reversed", "expired"].includes(
        input.observation.status,
      )
    ) {
      await transaction.connection.query(
        `
          UPDATE commerce_reconciliation_issues
          SET resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
          WHERE payment_session_id = $1
            AND issue_type = 'reconciliation_overdue'
        `,
        [payment.id],
      );
    }

    if (input.observation.status === "success") {
      if (payment.order_status === "paid") {
        const existingSale = await transaction.connection.query<{
          payment_session_id: string;
        }>(
          `
            SELECT payment_session_id
            FROM commerce_paid_sales
            WHERE order_id = $1
          `,
          [payment.order_id],
        );
        if (existingSale.rows[0]?.payment_session_id !== payment.id) {
          await recordIssue(
            transaction.connection,
            payment.id,
            "duplicate_success",
            { orderId: payment.order_id },
          );
        }
      } else {
        const paidSaleId = randomUUID();
        const insertedSale = await transaction.connection.query<{
          id: string;
          payment_session_id: string;
        }>(
          `
            INSERT INTO commerce_paid_sales (
              id, order_id, payment_session_id, provider_invoice_id,
              total_kopiykas, currency, paid_at
            ) VALUES ($1, $2, $3, $4, $5, 'UAH', $6)
            ON CONFLICT (order_id) DO NOTHING
            RETURNING id, payment_session_id
          `,
          [
            paidSaleId,
            payment.order_id,
            payment.id,
            input.observation.invoiceId,
            expectedAmount,
            input.observation.modifiedAt ?? input.observedAt,
          ],
        );
        const sale = insertedSale.rows[0];
        if (!sale || sale.payment_session_id !== payment.id) {
          await recordIssue(
            transaction.connection,
            payment.id,
            "duplicate_success",
            { orderId: payment.order_id },
          );
        } else {
          await transaction.connection.query(
            `
              UPDATE commerce_orders
              SET status = 'paid',
                  paid_at = $2,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND status <> 'paid'
            `,
            [payment.order_id, input.observation.modifiedAt ?? input.observedAt],
          );
          await transaction.connection.query(
            `
              UPDATE commerce_carts
              SET status = 'purchased', updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND status IN ('active', 'checkout_pending')
            `,
            [payment.cart_id],
          );
          await transaction.connection.query(
            `
              UPDATE commerce_payment_sessions
              SET status = 'failure',
                  failure_code = 'superseded_by_paid_session',
                  failure_reason = 'Іншу платіжну сесію вже успішно завершено.',
                  updated_at = CURRENT_TIMESTAMP
              WHERE order_id = $1
                AND id <> $2
                AND status IN (
                  'creating', 'creation_unknown', 'created', 'processing', 'hold'
                )
            `,
            [payment.order_id, payment.id],
          );
          const orderItems = await transaction.connection.query<OrderItemRow>(
            `
              SELECT
                id, ordinal, book_id, book_version_id, author_id,
                title_snapshot, author_public_name_snapshot,
                cover_path_snapshot, quantity, base_price_kopiykas,
                discount_kopiykas, unit_price_kopiykas,
                line_total_kopiykas
              FROM commerce_order_items
              WHERE order_id = $1
              ORDER BY ordinal
            `,
            [payment.order_id],
          );
          const paidSale: PaidSalePayload = {
            buyerUserId: payment.buyer_user_id,
            currency: "UAH",
            items: orderItems.rows.map((item) => ({
              authorId: item.author_id,
              bookId: item.book_id,
              bookVersionId: item.book_version_id,
              orderItemId: item.id,
              paidPriceKopiykas: safeInteger(
                item.unit_price_kopiykas,
                "unit_price_kopiykas",
              ),
              quantity: 1,
            })),
            orderId: payment.order_id,
            paidAt: input.observation.modifiedAt ?? input.observedAt,
            paidSaleId: sale.id,
            paymentSessionId: payment.id,
            provider: "mono",
            providerInvoiceId: input.observation.invoiceId,
            schemaVersion: COMMERCE_SCHEMA_VERSION,
            totalKopiykas: expectedAmount,
          };
          await transaction.emit({
            aggregateId: payment.order_id,
            aggregateType: "Order",
            correlationId: payment.order_id,
            eventType: "PaidSale",
            eventVersion: 1,
            idempotencyKey: `commerce.paid-sale:${payment.order_id}`,
            payload: paidSale as unknown as JsonObject,
            topic: "commerce.paid-sale.v1",
          });
          await requestPurchaseNotification(transaction, {
            buyerUserId: payment.buyer_user_id,
            correlationId: payment.order_id,
            orderId: payment.order_id,
            paidSaleId: sale.id,
          });
        }
      }
    } else if (
      ["failure", "reversed", "expired"].includes(input.observation.status)
    ) {
      if (payment.order_status === "paid") {
        await recordIssue(
          transaction.connection,
          payment.id,
          "status_conflict",
          {
            currentOrderStatus: payment.order_status,
            observedStatus: input.observation.status,
          },
        );
      } else {
        const sibling = await transaction.connection.query<{ id: string }>(
          `
            SELECT id
            FROM commerce_payment_sessions
            WHERE order_id = $1
              AND id <> $2
              AND status IN (
                'creating', 'creation_unknown', 'created', 'processing', 'hold'
              )
            LIMIT 1
          `,
          [payment.order_id, payment.id],
        );
        if (sibling.rows[0]) {
          await transaction.connection.query(
            `
              UPDATE commerce_payment_observations
              SET applied = TRUE
              WHERE provider_event_key = $1
            `,
            [eventKey],
          );
          return {
            applied: true,
            duplicate: false,
            orderId: payment.order_id,
            paymentSessionId: payment.id,
            status: input.observation.status,
          };
        }
        await transaction.connection.query(
          `
            UPDATE commerce_orders
            SET status = 'payment_failed', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'payment_pending'
          `,
          [payment.order_id],
        );
        await transaction.connection.query(
          `
            UPDATE commerce_carts
            SET status = 'active', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'checkout_pending'
          `,
          [payment.cart_id],
        );
      }
    }
    await transaction.connection.query(
      `
        UPDATE commerce_payment_observations
        SET applied = TRUE
        WHERE provider_event_key = $1
      `,
      [eventKey],
    );
    if (
      input.nextReconciliation &&
      (["created", "processing", "hold"] as const).includes(
        input.observation.status as "created" | "processing" | "hold",
      )
    ) {
      await scheduleReconciliation(transaction, {
        ...input.nextReconciliation,
        correlationId: payment.order_id,
        paymentSessionId: payment.id,
        purpose: "status",
      });
    }
    return {
      applied: true,
      duplicate: false,
      orderId: payment.order_id,
      paymentSessionId: payment.id,
      status: input.observation.status,
    };
  });
}

export async function processMonoWebhook(input: {
  readonly database: SqlDatabase;
  readonly maxBodyBytes: number;
  readonly provider: PaymentProviderAdapter;
  readonly rawBody: Uint8Array;
  readonly signature: string;
}): Promise<PaymentObservationResult> {
  if (
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > input.maxBodyBytes
  ) {
    throw new CommerceInputError(
      "WEBHOOK_BODY_INVALID",
      "Webhook body has an invalid size",
    );
  }
  const observation = await input.provider.verifyAndParseWebhook(
    input.rawBody,
    input.signature,
  );
  return applyPaymentObservation(input.database, {
    bodySha256: createHash("sha256").update(input.rawBody).digest("hex"),
    observation,
    observedAt: new Date().toISOString(),
    signatureVerified: true,
    source: "webhook",
  });
}

function reconciliationPayload(job: DurableJob): PaymentReconciliationJobPayload {
  const payload = job.payload;
  const expectedPurpose =
    job.jobType === PAYMENT_CREATION_WATCHDOG_JOB_TYPE
      ? "creation_watchdog"
      : job.jobType === PAYMENT_RECONCILIATION_JOB_TYPE
        ? "status"
        : null;
  if (
    expectedPurpose === null ||
    payload.schemaVersion !== COMMERCE_SCHEMA_VERSION ||
    typeof payload.paymentSessionId !== "string" ||
    typeof payload.attempt !== "number" ||
    !Number.isSafeInteger(payload.attempt) ||
    payload.attempt < 0 ||
    typeof payload.notBefore !== "string" ||
    Number.isNaN(Date.parse(payload.notBefore)) ||
    payload.purpose !== expectedPurpose
  ) {
    throw new Error("Invalid payment reconciliation job payload");
  }
  return {
    attempt: payload.attempt,
    notBefore: new Date(payload.notBefore).toISOString(),
    paymentSessionId: payload.paymentSessionId,
    purpose: expectedPurpose,
    schemaVersion: COMMERCE_SCHEMA_VERSION,
  };
}

export function createPaymentCreationWatchdogHandler(options: {
  readonly database: SqlDatabase;
}) {
  return async (
    job: DurableJob,
    context: { readonly signal: AbortSignal },
  ): Promise<void> => {
    const payload = reconciliationPayload(job);
    if (payload.purpose !== "creation_watchdog") {
      throw new Error("Creation watchdog received a status job");
    }
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    await withDomainTransaction(options.database, async ({ connection }) => {
      const locked = await connection.query<{
        cart_id: string;
        expires_at: Date | string;
        order_id: string;
        order_status: OrderStatus;
        provider_invoice_id: string | null;
        status: PaymentSessionStatus;
      }>(
        `
          SELECT
            session.status,
            session.provider_invoice_id,
            session.expires_at,
            orders.id AS order_id,
            orders.cart_id,
            orders.status AS order_status
          FROM commerce_payment_sessions session
          JOIN commerce_orders orders ON orders.id = session.order_id
          WHERE session.id = $1
          FOR UPDATE OF session, orders
        `,
        [payload.paymentSessionId],
      );
      const session = locked.rows[0];
      if (
        !session ||
        session.provider_invoice_id ||
        !["creating", "creation_unknown"].includes(session.status) ||
        session.order_status === "paid"
      ) {
        return;
      }
      if (Date.parse(iso(session.expires_at) as string) > Date.now()) {
        throw new Error("Payment creation watchdog ran before expiry");
      }
      await connection.query(
        `
          UPDATE commerce_payment_sessions
          SET status = 'failure',
              failure_code = 'invoice_creation_expired',
              failure_reason = 'Не вдалося підтвердити створення платежу.',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND status IN ('creating', 'creation_unknown')
            AND provider_invoice_id IS NULL
        `,
        [payload.paymentSessionId],
      );
      await connection.query(
        `
          UPDATE commerce_orders
          SET status = 'payment_failed', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'payment_pending'
        `,
        [session.order_id],
      );
      await connection.query(
        `
          UPDATE commerce_carts
          SET status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'checkout_pending'
        `,
        [session.cart_id],
      );
      await recordIssue(
        connection,
        payload.paymentSessionId,
        "creation_unknown",
        { expiredWithoutProviderIdentity: true, orderId: session.order_id },
      );
    });
  };
}

export function createPaymentReconciliationHandler(options: {
  readonly database: SqlDatabase;
  readonly intervalMs: number;
  /**
   * Backward-compatible observability threshold. Reaching it records an
   * overdue issue but never terminates the durable reconciliation chain.
   */
  readonly maxReconciliations?: number;
  readonly provider: PaymentProviderAdapter;
}) {
  return async (
    job: DurableJob,
    context: { readonly signal: AbortSignal },
  ): Promise<void> => {
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    const payload = reconciliationPayload(job);
    if (payload.purpose !== "status") {
      throw new Error("Reconciliation handler received a watchdog job");
    }
    const session = await loadPaymentSession(
      options.database,
      payload.paymentSessionId,
    );
    if (
      !session ||
      !session.providerInvoiceId ||
      !(["created", "processing", "hold"] as const).includes(
        session.status as "created" | "processing" | "hold",
      )
    ) {
      return;
    }
    const now = Date.now();
    const providerExpirySafetyMs = 60_000;
    const reconciliationHorizon =
      Date.parse(session.expiresAt) + providerExpirySafetyMs;
    const thresholdReached =
      options.maxReconciliations !== undefined &&
      payload.attempt >= options.maxReconciliations;
    const overdue = now >= reconciliationHorizon || thresholdReached;
    const nextAttempt = payload.attempt + 1;
    const nextDelayMs = overdue
      ? Math.max(options.intervalMs, 5 * 60_000)
      : options.intervalMs;
    await withDomainTransaction(options.database, async (transaction) => {
      await scheduleReconciliation(transaction, {
        attempt: nextAttempt,
        correlationId: session.orderId,
        maxAttempts: 8,
        notBefore: new Date(now + nextDelayMs).toISOString(),
        paymentSessionId: session.id,
        purpose: "status",
      });
      if (overdue) {
        await recordIssue(
          transaction.connection,
          session.id,
          "reconciliation_overdue",
          {
            attempt: payload.attempt,
            expiresAt: session.expiresAt,
            status: session.status,
          },
        );
      }
    });
    const observation = await options.provider.getInvoiceStatus(
      session.providerInvoiceId,
    );
    if (observation.invoiceId !== session.providerInvoiceId) {
      throw new PaymentProviderProtocolError(
        "mono status response invoiceId does not match the requested invoice",
      );
    }
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error("Worker lease was lost");
    }
    await applyPaymentObservation(options.database, {
      observation,
      observedAt: new Date().toISOString(),
      signatureVerified: false,
      source: "reconciliation",
    });
  };
}

export async function loadCheckoutResult(
  database: SqlDatabase,
  input: { readonly buyerUserId: string; readonly orderId: string },
): Promise<CheckoutResultReadModel | null> {
  assertUuid(input.buyerUserId, "buyerUserId");
  assertUuid(input.orderId, "orderId");
  const order = await loadOrder(database, input.orderId, input.buyerUserId);
  if (!order) return null;
  const sessionResult = await database.query<PaymentSessionRow>(
    `
      SELECT
        id, order_id, provider, request_key, provider_invoice_id,
        checkout_url, status, amount_kopiykas, currency_numeric,
        provider_modified_at, failure_code, failure_reason, expires_at,
        reconciliation_attempt
      FROM commerce_payment_sessions
      WHERE order_id = $1
      ORDER BY
        CASE
          WHEN id = (
            SELECT payment_session_id
            FROM commerce_paid_sales
            WHERE order_id = $1
          ) THEN 0
          ELSE 1
        END,
        created_at DESC,
        id DESC
      LIMIT 1
    `,
    [order.id],
  );
  const payment = sessionResult.rows[0]
    ? mapPaymentSession(sessionResult.rows[0])
    : null;
  if (!payment) throw new Error("Order has no payment session");
  const delivery = await database.query<{
    job_status: "completed" | "dead_letter" | "pending" | "running" | null;
    status: "pending" | "sent";
  }>(
    `
      SELECT delivery.status, job.status AS job_status
      FROM notifications_purchase_deliveries delivery
      LEFT JOIN durable_jobs job
        ON job.queue = 'notifications'
       AND job.idempotency_key =
         'notifications.purchase-email:' || delivery.id::text
      WHERE delivery.order_id = $1
    `,
    [order.id],
  );
  const notification = delivery.rows[0];
  const emailStatus =
    notification?.status === "sent"
      ? "sent"
      : notification?.job_status === "dead_letter"
        ? "failed"
        : notification
          ? "queued"
          : null;
  const failed =
    order.status !== "paid" &&
    (order.status === "payment_failed" ||
      ["failure", "reversed", "expired"].includes(payment.status));
  const failureMessage =
    payment.status === "expired"
      ? "Час дії платіжної сторінки минув. Кошик збережено — почніть оплату ще раз."
      : payment.status === "reversed"
        ? "Платіж скасовано. Кошик збережено — за потреби спробуйте ще раз."
        : "Оплату не підтверджено. Кошик збережено — спробуйте ще раз.";
  return {
    emailStatus,
    // Provider failure text is retained for operations, never shown directly
    // to a buyer.
    failureMessage: failed ? failureMessage : null,
    formattedTotal: formatUah(order.totalKopiykas),
    items: order.items.map((item) => ({
      authorPublicName: item.authorPublicName,
      bookId: item.bookId,
      coverPath: item.coverPath,
      title: item.title,
      unitPriceKopiykas: item.unitPriceKopiykas,
    })),
    orderId: order.id,
    orderStatus: order.status,
    paymentStatus: payment.status,
    schemaVersion: COMMERCE_SCHEMA_VERSION,
    totalKopiykas: order.totalKopiykas,
  };
}

export async function loadPaymentRedirect(
  database: SqlDatabase,
  input: { readonly buyerUserId: string; readonly paymentSessionId: string },
): Promise<{ readonly checkoutUrl: string; readonly orderId: string } | null> {
  assertUuid(input.buyerUserId, "buyerUserId");
  assertUuid(input.paymentSessionId, "paymentSessionId");
  const result = await database.query<{
    checkout_url: string;
    order_id: string;
  }>(
    `
      SELECT session.checkout_url, session.order_id
      FROM commerce_payment_sessions session
      JOIN commerce_orders orders ON orders.id = session.order_id
      WHERE session.id = $1
        AND orders.buyer_user_id = $2
        AND session.status IN ('created', 'processing', 'hold')
        AND session.checkout_url IS NOT NULL
    `,
    [input.paymentSessionId, input.buyerUserId],
  );
  const row = result.rows[0];
  return row
    ? { checkoutUrl: row.checkout_url, orderId: row.order_id }
    : null;
}
