import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import {
  UNIT06_CURRENT_EPUB_MARKER,
  UNIT06_FIXTURE_BOOK,
  UNIT06_FIXTURE_IDS,
} from "../fixtures/library/unit06-fixtures";

const { Client } = pg;
let signedDownloadHref = "";

function databaseUrl(): string {
  const value = process.env.UNIT06_DATABASE_URL;
  if (!value) throw new Error("UNIT06_DATABASE_URL is required");
  return value;
}

async function withDatabase<T>(callback: (database: pg.Client) => Promise<T>): Promise<T> {
  const database = new Client({ connectionString: databaseUrl() });
  await database.connect();
  try {
    return await callback(database);
  } finally {
    await database.end();
  }
}

async function approveProvider(page: Page, provider: "facebook" | "google") {
  await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:3231/${provider}/authorize`, "u"));
  await page.getByRole("link", { name: "Підтвердити" }).click();
}

async function signIn(page: Page, provider: "facebook" | "google", returnTo: string) {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole("button", {
    name: provider === "google" ? "Увійти через Google" : "Увійти через Facebook",
  }).click();
  await approveProvider(page, provider);
  await expect(page).toHaveURL(new RegExp(returnTo.replaceAll("/", "\\/"), "u"));
}

test.describe.configure({ mode: "serial" });

test("Buyer receives current approved EPUB/MOBI, can review, and can request a refund", async ({ page, request }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Flibrary/u);
  await signIn(page, "google", "/library");

  await expect(page.getByRole("heading", { level: 1, name: "Бібліотека" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: UNIT06_FIXTURE_BOOK.title })).toBeVisible();
  const epub = page.getByRole("link", { name: "EPUB" });
  const mobi = page.getByRole("link", { name: "MOBI" });
  await expect(epub).toBeVisible();
  await expect(mobi).toBeVisible();
  signedDownloadHref = (await epub.getAttribute("href")) ?? "";
  expect(signedDownloadHref).toContain(`/api/library/download/`);
  expect(signedDownloadHref).toContain("signature=");
  const download = await page.context().request.get(signedDownloadHref);
  expect(download.status()).toBe(200);
  expect((await download.body()).toString("utf8")).toBe(UNIT06_CURRENT_EPUB_MARKER);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  const forged = new URL(signedDownloadHref, process.env.UNIT06_APP_ORIGIN);
  forged.searchParams.set("signature", "forged");
  expect((await page.context().request.get(`${forged.pathname}${forged.search}`)).status()).toBe(404);
  expect((await request.get(signedDownloadHref)).status()).toBe(401);

  await page.goto(`/books/${UNIT06_FIXTURE_IDS.bookId}#reviews`);
  await expect(page.getByText("Ваш підтверджений відгук", { exact: true })).toBeVisible();
  await page.getByLabel("Оцінка").selectOption("5");
  await page.getByLabel("Текст відгуку").fill("Тиха й дуже тепла історія. Рекомендую читачам.");
  await page.getByRole("button", { name: "Надіслати на модерацію" }).click();
  await expect(page.getByRole("status")).toContainText("Відгук на модерації");
  await expect.poll(() => withDatabase(async (database) => {
    const result = await database.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM moderation_cases WHERE subject_type = 'review' AND status = 'manual_review_pending'",
    );
    return result.rows[0]?.count;
  })).toBe(1);

  await page.goto("/library");
  await page.getByRole("button", { name: "Запит на повернення" }).click();
  const dialog = page.getByRole("dialog", { name: "Поясніть причину" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Причина повернення").fill("Файл не підходить для мого пристрою читання.");
  await dialog.getByRole("button", { name: "Надіслати заявку" }).click();
  await expect(page.getByRole("status")).toContainText("Заявку на повернення надіслано");
  await expect(page.getByText("Заявку на повернення розглядають", { exact: true })).toBeVisible();
});

test("Manager publishes the review and records exactly one refund compensation", async ({ browser, page }) => {
  await signIn(page, "facebook", "/admin/moderation");
  await page.goto("/admin/moderation?type=review");
  await expect(page.getByRole("heading", { level: 2, name: UNIT06_FIXTURE_BOOK.title })).toBeVisible();
  await expect(page.getByText("Тиха й дуже тепла історія. Рекомендую читачам.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Опублікувати відгук" }).click();
  await expect(page.getByRole("status")).toContainText("Відгук опубліковано");

  await page.goto("/admin/refunds");
  await expect(page.getByRole("heading", { level: 1, name: "Повернення" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: UNIT06_FIXTURE_BOOK.title })).toBeVisible();
  await page.getByRole("button", { name: "Схвалити повернення" }).click();
  await expect(page.getByRole("status")).toContainText("компенсацію зафіксовано");

  const stored = await withDatabase(async (database) => {
    const result = await database.query<{
      compensation_count: number;
      event_count: number;
      review_count: number;
      status: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM refund_compensations) AS compensation_count,
          (SELECT COUNT(*)::int FROM outbox_events WHERE event_type = 'RefundApproved') AS event_count,
          (SELECT COUNT(*)::int FROM catalog_review_read_models) AS review_count,
          (SELECT status FROM library_entitlements LIMIT 1) AS status
      `,
    );
    return result.rows[0]!;
  });
  expect(stored).toEqual({
    compensation_count: 1,
    event_count: 1,
    review_count: 1,
    status: "refunded",
  });

  const buyerContext = await browser.newContext({ baseURL: process.env.UNIT06_APP_ORIGIN });
  const buyerPage = await buyerContext.newPage();
  try {
    await signIn(buyerPage, "google", "/library");
    await expect(buyerPage.getByText("Повернення схвалено", { exact: true })).toBeVisible();
    await expect(buyerPage.getByRole("link", { name: "EPUB" })).toHaveCount(0);
    await expect(buyerPage.getByRole("link", { name: "MOBI" })).toHaveCount(0);
    expect((await buyerContext.request.get(signedDownloadHref)).status()).toBe(404);
    await buyerPage.goto(`/books/${UNIT06_FIXTURE_IDS.bookId}#reviews`);
    await expect(buyerPage.getByRole("button", { name: "Надіслати на модерацію" })).toHaveCount(0);
  } finally {
    await buyerContext.close();
  }
});
