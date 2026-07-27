import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import {
  UNIT05_EXPECTED_CART_TOTAL_KOPIYKAS,
  UNIT05_FIXTURE_BOOKS,
  UNIT05_FIXTURE_IDS,
} from "../fixtures/commerce/unit05-fixtures";

const { Client } = pg;
const monoOrigin =
  process.env.UNIT05_MONO_ORIGIN ?? "http://127.0.0.1:3317";
const monoControlToken = process.env.UNIT05_MONO_CONTROL_TOKEN;
const emailCaptureRoot = path.resolve(
  process.env.UNIT05_EMAIL_CAPTURE_ROOT ?? ".data/unit05-e2e-email",
);

interface CheckoutRow {
  readonly invoice_id: string;
  readonly order_id: string;
  readonly order_status: string;
  readonly payment_status: string;
  readonly reference: string;
  readonly total_kopiykas: number;
}

function databaseUrl(): string {
  const value = process.env.UNIT05_DATABASE_URL;
  if (!value) throw new Error("UNIT05_DATABASE_URL is required");
  return value;
}

async function withDatabase<T>(
  callback: (database: pg.Client) => Promise<T>,
): Promise<T> {
  const database = new Client({ connectionString: databaseUrl() });
  await database.connect();
  try {
    return await callback(database);
  } finally {
    await database.end();
  }
}

async function resetCommerceState(): Promise<void> {
  await withDatabase(async (database) => {
    await database.query(`
      TRUNCATE TABLE
        notifications_purchase_deliveries,
        commerce_paid_sales,
        commerce_reconciliation_issues,
        commerce_payment_observations,
        commerce_payment_sessions,
        commerce_order_items,
        commerce_orders,
        commerce_cart_items,
        commerce_carts
      CASCADE
    `);
    await database.query(
      "DELETE FROM durable_jobs WHERE queue IN ('commerce', 'notifications')",
    );
    await database.query(
      `
        DELETE FROM outbox_events
        WHERE event_type IN ('PaidSale', 'PurchaseNotificationRequested')
           OR topic IN ('commerce.paid-sale.v1', 'notifications.purchase-requested.v1')
      `,
    );
    await database.query(
      `
        UPDATE catalog_book_read_models
        SET discount_price_kopiykas = $2,
            discount_starts_at = '2026-01-01T00:00:00.000Z',
            discount_ends_at = '2030-01-01T00:00:00.000Z'
        WHERE book_id = $1
      `,
      [
        UNIT05_FIXTURE_IDS.books.discounted,
        UNIT05_FIXTURE_BOOKS.discounted.actualPriceKopiykas,
      ],
    );
  });
  await rm(emailCaptureRoot, { force: true, recursive: true });
  if (!monoControlToken) {
    throw new Error("UNIT05_MONO_CONTROL_TOKEN is required");
  }
  const response = await fetch(`${monoOrigin}/__control/reset`, {
    headers: { "X-Unit05-Control-Token": monoControlToken },
    method: "POST",
  });
  expect(response.status).toBe(200);
}

async function addBook(page: Page, bookId: string): Promise<void> {
  await page.goto(`/books/${bookId}`);
  await page.getByRole("button", { name: "Додати в кошик" }).click();
  await expect(page).toHaveURL(/\/cart(?:\?|$)/u);
}

async function signInFromCart(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Оплатити" }).click();
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fcart%3Fstep%3Dcheckout/u,
  );
  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3217\/google\/authorize/u);
  await page.getByRole("link", { name: "Підтвердити" }).click();
  await expect(page).toHaveURL(/\/cart(?:\?step=checkout)?$/u);
  await expect(page.getByRole("button", { name: "Оплатити" })).toBeVisible();
}

async function latestCheckout(): Promise<CheckoutRow> {
  return withDatabase(async (database) => {
    const result = await database.query<CheckoutRow>(
      `
        SELECT
          payment.provider_invoice_id AS invoice_id,
          orders.id AS order_id,
          orders.status AS order_status,
          payment.status AS payment_status,
          orders.reference,
          orders.total_kopiykas::int
        FROM commerce_orders orders
        JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
        ORDER BY orders.created_at DESC, orders.id DESC
        LIMIT 1
      `,
    );
    const row = result.rows[0];
    if (!row?.invoice_id) throw new Error("Checkout invoice was not persisted");
    return row;
  });
}

async function waitForSuccess(page: Page, orderId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/checkout/result?order=${orderId}`);
        const success = page.getByRole("heading", {
          level: 1,
          name: "Дякуємо за покупку",
        });
        return success.isVisible();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function monoControl(
  pathName: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!monoControlToken) {
    throw new Error("UNIT05_MONO_CONTROL_TOKEN is required");
  }
  return fetch(`${monoOrigin}${pathName}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "X-Unit05-Control-Token": monoControlToken,
    },
    method: "POST",
  });
}

test.describe.configure({ mode: "serial" });
test.beforeEach(resetCommerceState);

test("S-04 merges a two-book guest cart at auth and one signed payment emits one paid sale", async ({
  page,
  request,
}) => {
  await addBook(page, UNIT05_FIXTURE_IDS.books.discounted);
  await addBook(page, UNIT05_FIXTURE_IDS.books.fullPrice);
  await addBook(page, UNIT05_FIXTURE_IDS.books.discounted);

  await expect(page.getByRole("heading", { level: 1, name: "Кошик" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Книжки" })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Видалити «${UNIT05_FIXTURE_BOOKS.discounted.title}» з кошика`,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: `Видалити «${UNIT05_FIXTURE_BOOKS.fullPrice.title}» з кошика`,
    }),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Кошик, 2 книжки" })).toBeVisible();
  await expect(page.getByText("398 грн", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Для оплати увійдіть через Google або Facebook."),
  ).toBeVisible();

  const unavailable = await request.post("/api/cart/items", {
    form: {
      bookId: UNIT05_FIXTURE_IDS.books.unavailable,
      returnTo: "/cart",
    },
    headers: { Origin: "http://127.0.0.1:3121" },
    maxRedirects: 0,
  });
  expect([400, 404, 409, 422]).toContain(unavailable.status());

  await signInFromCart(page);
  await expect(page.getByRole("link", { name: "Кошик, 2 книжки" })).toBeVisible();
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "ukiebook_cart",
    ),
  ).toBe(false);

  await page.getByRole("button", { name: "Оплатити" }).click();
  await expect(page).toHaveURL(new RegExp(`^${monoOrigin}/checkout/`, "u"));
  const checkout = await latestCheckout();
  expect(checkout.total_kopiykas).toBe(UNIT05_EXPECTED_CART_TOTAL_KOPIYKAS);
  expect(checkout.order_status).toBe("payment_pending");

  await withDatabase(async (database) => {
    await database.query(
      `
        UPDATE catalog_book_read_models
        SET discount_price_kopiykas = 9900
        WHERE book_id = $1
      `,
      [UNIT05_FIXTURE_IDS.books.discounted],
    );
  });
  await page.getByRole("button", { name: "Оплатити" }).click();
  await waitForSuccess(page, checkout.order_id);
  await expect(
    page.getByRole("heading", { level: 2, name: "Книжки в замовленні" }),
  ).toBeVisible();
  await expect(page.getByText(UNIT05_FIXTURE_BOOKS.discounted.title)).toBeVisible();
  await expect(page.getByText(UNIT05_FIXTURE_BOOKS.fullPrice.title)).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти в бібліотеку" })).toBeVisible();

  const duplicate = await monoControl(
    `/__control/invoices/${checkout.invoice_id}/deliver`,
    { attempts: 2 },
  );
  expect(duplicate.status).toBe(200);
  const stale = await monoControl(
    `/__control/invoices/${checkout.invoice_id}/status`,
    {
      deliverWebhook: true,
      modifiedDate: "2026-01-01T00:00:00.000Z",
      status: "processing",
    },
  );
  expect(stale.status).toBe(200);

  const forged = await request.post("/api/payments/mono/webhook", {
    data: {
      amount: checkout.total_kopiykas,
      ccy: 980,
      finalAmount: checkout.total_kopiykas,
      invoiceId: checkout.invoice_id,
      modifiedDate: new Date().toISOString(),
      reference: checkout.reference,
      status: "success",
    },
    headers: {
      "Content-Type": "application/json",
      "X-Sign": "forged-unit05-signature",
    },
  });
  expect([400, 401, 403]).toContain(forged.status());

  await expect
    .poll(async () =>
      withDatabase(async (database) => {
        const counts = await database.query<{
          notifications: number;
          paid_orders: number;
          paid_sales: number;
          paid_sale_events: number;
        }>(
          `
            SELECT
              (SELECT COUNT(*)::int FROM commerce_orders WHERE id = $1 AND status = 'paid') AS paid_orders,
              (SELECT COUNT(*)::int FROM commerce_paid_sales WHERE order_id = $1) AS paid_sales,
              (SELECT COUNT(*)::int FROM outbox_events
                 WHERE aggregate_id = $1::uuid::text
                   AND event_type = 'PaidSale') AS paid_sale_events,
              (SELECT COUNT(*)::int FROM notifications_purchase_deliveries
                 WHERE order_id = $1) AS notifications
          `,
          [checkout.order_id],
        );
        return counts.rows[0];
      }),
    )
    .toEqual({
      notifications: 1,
      paid_orders: 1,
      paid_sale_events: 1,
      paid_sales: 1,
    });

  const snapshots = await withDatabase(async (database) => {
    const result = await database.query<{
      line_total_kopiykas: number;
      title_snapshot: string;
    }>(
      `
        SELECT title_snapshot, line_total_kopiykas::int
        FROM commerce_order_items
        WHERE order_id = $1
        ORDER BY ordinal
      `,
      [checkout.order_id],
    );
    return result.rows;
  });
  expect(snapshots).toEqual([
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

  await expect
    .poll(async () => {
      try {
        const files = await readdir(emailCaptureRoot);
        for (const file of files.filter((name) => name.endsWith(".json"))) {
          const content = await readFile(path.join(emailCaptureRoot, file), "utf8");
          if (
            content.includes(UNIT05_FIXTURE_BOOKS.discounted.title) &&
            content.includes(UNIT05_FIXTURE_BOOKS.fullPrice.title) &&
            content.includes("/library")
          ) {
            return true;
          }
        }
      } catch {
        return false;
      }
      return false;
    })
    .toBe(true);
});

test("S-06 failure preserves the cart and creates no PaidSale", async ({ page }) => {
  await addBook(page, UNIT05_FIXTURE_IDS.books.fullPrice);
  await signInFromCart(page);
  await page.getByRole("button", { name: "Оплатити" }).click();
  await expect(page).toHaveURL(new RegExp(`^${monoOrigin}/checkout/`, "u"));
  const checkout = await latestCheckout();

  const failed = await monoControl(
    `/__control/invoices/${checkout.invoice_id}/status`,
    { deliverWebhook: true, status: "failure" },
  );
  expect(failed.status).toBe(200);
  await expect
    .poll(() =>
      withDatabase(async (database) => {
        const result = await database.query<{ status: string }>(
          "SELECT status FROM commerce_orders WHERE id = $1",
          [checkout.order_id],
        );
        return result.rows[0]?.status;
      }),
    )
    .toBe("payment_failed");
  await page.goto(`/checkout/result?order=${checkout.order_id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Оплату не підтверджено" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Кошик збережено" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Повернутися в кошик" }).click();
  await expect(
    page.getByRole("button", {
      name: `Видалити «${UNIT05_FIXTURE_BOOKS.fullPrice.title}» з кошика`,
    }),
  ).toBeVisible();

  const state = await withDatabase(async (database) => {
    const result = await database.query<{
      paid_sales: number;
      status: string;
    }>(
      `
        SELECT
          orders.status,
          (SELECT COUNT(*)::int FROM commerce_paid_sales
             WHERE order_id = orders.id) AS paid_sales
        FROM commerce_orders orders
        WHERE orders.id = $1
      `,
      [checkout.order_id],
    );
    return result.rows[0];
  });
  expect(state).toEqual({ paid_sales: 0, status: "payment_failed" });
});

test("a missed webhook is recovered by provider-status reconciliation exactly once", async ({
  page,
}) => {
  await addBook(page, UNIT05_FIXTURE_IDS.books.discounted);
  await signInFromCart(page);
  await page.getByRole("button", { name: "Оплатити" }).click();
  await expect(page).toHaveURL(new RegExp(`^${monoOrigin}/checkout/`, "u"));
  const checkout = await latestCheckout();

  const providerOnly = await monoControl(
    `/__control/invoices/${checkout.invoice_id}/status`,
    { deliverWebhook: false, status: "success" },
  );
  expect(providerOnly.status).toBe(200);
  await page.goto(`/checkout/result?order=${checkout.order_id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Оплата підтверджується" }),
  ).toBeVisible();
  await waitForSuccess(page, checkout.order_id);

  await expect
    .poll(async () =>
      withDatabase(async (database) => {
        const result = await database.query<{
          paid_sales: number;
          reconciliation_observations: number;
        }>(
          `
            SELECT
              (SELECT COUNT(*)::int FROM commerce_paid_sales
                 WHERE order_id = $1) AS paid_sales,
              (SELECT COUNT(*)::int
                 FROM commerce_payment_observations observation
                 JOIN commerce_payment_sessions payment
                   ON payment.id = observation.payment_session_id
                 WHERE payment.order_id = $1
                   AND observation.source = 'reconciliation') AS reconciliation_observations
          `,
          [checkout.order_id],
        );
        return result.rows[0];
      }),
    )
    .toEqual({ paid_sales: 1, reconciliation_observations: 1 });
});
