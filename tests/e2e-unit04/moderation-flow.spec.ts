import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import {
  UNIT04_FIXTURE_IDS,
  UNIT04_FIXTURE_TITLES,
} from "../fixtures/moderation/unit04-fixtures";

const { Client } = pg;

async function approveProvider(page: Page, provider: "facebook" | "google") {
  await expect(page).toHaveURL(
    new RegExp(`127\\.0\\.0\\.1:32\\d{2}/${provider}/authorize`, "u"),
  );
  await page.getByRole("link", { name: "Підтвердити" }).click();
}

async function signIn(page: Page, role: "author" | "manager") {
  const provider = role === "author" ? "facebook" : "google";
  const returnTo = role === "author" ? "/author/books" : "/admin/moderation";
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page
    .getByRole("button", {
      name: provider === "facebook" ? "Увійти через Facebook" : "Увійти через Google",
    })
    .click();
  await approveProvider(page, provider);
  await expect(page).toHaveURL(new RegExp(returnTo.replaceAll("/", "\\/"), "u"));
}

async function chooseCase(page: Page, caseId: string, title: string) {
  await page.goto(`/admin/moderation?case=${caseId}`);
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
}

test("S-13 exposes the five author-visible lifecycle states without internal AI signals", async ({
  page,
}) => {
  await signIn(page, "author");
  const expected = [
    ["submitted", "На модерації"],
    ["manual", "На ручній перевірці"],
    ["rejected", "Відхилено"],
    ["published", "Опубліковано"],
    ["removed", "Прибрано з Каталогу"],
  ] as const;

  for (const [name, label] of expected) {
    await page.goto(`/author/books/${UNIT04_FIXTURE_IDS.books[name]}`);
    await expect(page.getByRole("heading", { name: UNIT04_FIXTURE_TITLES[name], level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Стан книжки" })).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText("Потрібна уважна ручна перевірка")).toHaveCount(0);
    await expect(page.getByText("Сигнал ШІ")).toHaveCount(0);
  }

  await page.goto(`/author/books/${UNIT04_FIXTURE_IDS.books.rejected}`);
  await expect(page.getByRole("heading", { name: "Категорія причини" })).toBeVisible();
  await expect(page.getByText("Невідповідність вимогам платформи", { exact: true })).toBeVisible();
  await page.goto(`/author/books/${UNIT04_FIXTURE_IDS.books.removed}`);
  await expect(page.getByRole("link", { name: "Переглянути сторінку книжки" })).toBeVisible();
});

test("anonymous and author sessions cannot enter manager moderation", async ({ page }) => {
  await page.goto("/admin/moderation");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fmoderation/u);

  await signIn(page, "author");
  await page.goto("/admin/moderation");
  await expect(page.getByRole("heading", { name: "Доступ заборонено" })).toBeVisible();
});

test("invalid CSRF cannot mutate a moderation case", async ({ page }) => {
  await signIn(page, "manager");
  await chooseCase(page, UNIT04_FIXTURE_IDS.cases.manual, UNIT04_FIXTURE_TITLES.manual);

  const approve = page.getByRole("button", { name: "Схвалити й опублікувати" });
  const approveForm = approve.locator("xpath=ancestor::form");
  await approveForm.locator('input[name="csrfToken"]').evaluate((element) => {
    (element as HTMLInputElement).value = "invalid-csrf-token";
  });
  await approve.click();
  await expect(page).toHaveURL(/error=request_rejected/u);
  await expect(
    page.getByRole("alert").filter({ hasText: "Не вдалося виконати дію" }),
  ).toContainText("Не вдалося виконати дію");

  const databaseUrl = process.env.UNIT04_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const database = new Client({ connectionString: databaseUrl! });
  await database.connect();
  try {
    const result = await database.query<{ decisions: number; status: string }>(
      `
        SELECT moderation.status,
               COUNT(decision.id)::int AS decisions
        FROM moderation_cases moderation
        LEFT JOIN moderation_decisions decision ON decision.case_id = moderation.id
        WHERE moderation.id = $1
        GROUP BY moderation.status
      `,
      [UNIT04_FIXTURE_IDS.cases.manual],
    );
    expect(result.rows[0]).toEqual({ decisions: 0, status: "manual_review_pending" });
  } finally {
    await database.end();
  }
});

test("S-18 manager resolves every subject type and removal makes S-02 unavailable", async ({
  page,
}) => {
  await signIn(page, "manager");
  await expect(page.getByRole("heading", { name: "Ручна перевірка", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ризикові випадки" })).toBeVisible();
  await expect(page.getByLabel("Тип випадку")).toBeVisible();

  await chooseCase(page, UNIT04_FIXTURE_IDS.cases.manual, UNIT04_FIXTURE_TITLES.manual);
  await page.getByRole("button", { name: "Схвалити й опублікувати" }).click();
  await expect(page.getByRole("status")).toContainText("Книжку схвалено й опубліковано");

  await chooseCase(page, UNIT04_FIXTURE_IDS.cases.providerError, UNIT04_FIXTURE_TITLES.providerError);
  await expect(page.getByText("Автоматичний скринінг недоступний")).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Відхилити книжку" })
    .click();
  const reason = page.getByLabel("Категорія причини");
  const rejectBook = page.getByRole("button", { name: "Відхилити книжку" });
  await rejectBook.click();
  await expect(reason).toBeFocused();
  await reason.selectOption("platform_requirements");
  await rejectBook.click();
  await expect(page.getByRole("status")).toContainText("Книжку відхилено");

  await chooseCase(page, UNIT04_FIXTURE_IDS.cases.update, UNIT04_FIXTURE_TITLES.update);
  await page.getByRole("button", { name: "Схвалити оновлення" }).click();
  await expect(page.getByRole("status")).toContainText("Оновлення схвалено");

  await chooseCase(page, UNIT04_FIXTURE_IDS.cases.review, UNIT04_FIXTURE_TITLES.review);
  await expect(page.getByLabel("Категорія причини")).toHaveCount(0);
  await page.getByRole("button", { name: "Не публікувати" }).click();
  await expect(page.getByRole("status")).toContainText("Відгук не буде опубліковано");

  await chooseCase(page, UNIT04_FIXTURE_IDS.cases.removal, UNIT04_FIXTURE_TITLES.published);
  await page.getByRole("button", { name: "Прибрати з Каталогу" }).click();
  const dialog = page.getByRole("dialog", { name: "Прибрати книжку з Каталогу?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Підстава").selectOption("platform_rules_violation");
  await dialog.getByRole("button", { name: "Прибрати з Каталогу" }).click();
  await expect(page.getByRole("status")).toContainText("Книжку прибрано з Каталогу");

  await expect(page.getByRole("heading", { name: "Все перевірено" })).toBeVisible();
  await page.goto(`/books/${UNIT04_FIXTURE_IDS.books.published}`);
  await expect(page.getByText("Книжка недоступна", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Додати в кошик" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Читати фрагмент" })).toHaveCount(0);

  const databaseUrl = process.env.UNIT04_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const database = new Client({ connectionString: databaseUrl! });
  await database.connect();
  try {
    const result = await database.query<{
      decisions: number;
      pending: number;
      publication_state: string;
      catalog_availability: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM moderation_cases WHERE status = 'manual_review_pending') AS pending,
          (SELECT COUNT(*)::int FROM moderation_decisions
             WHERE case_id = ANY($1::uuid[])) AS decisions,
          (SELECT state FROM book_publications WHERE book_id = $2) AS publication_state,
          (SELECT availability FROM catalog_book_read_models WHERE book_id = $2) AS catalog_availability
      `,
      [Object.values(UNIT04_FIXTURE_IDS.cases), UNIT04_FIXTURE_IDS.books.published],
    );
    expect(result.rows[0]).toEqual({
      catalog_availability: "unavailable",
      decisions: 5,
      pending: 0,
      publication_state: "unavailable",
    });
  } finally {
    await database.end();
  }
});
