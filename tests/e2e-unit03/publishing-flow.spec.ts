import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

import { docxBytesFixture } from "../fixtures/publishing/conversion-fixtures";

const { Client } = pg;

async function approveProvider(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(/127\.0\.0\.1:3213\/google\/authorize/u);
  await page.getByRole("link", { name: "Підтвердити" }).click();
}

async function signInAuthor(page: import("@playwright/test").Page) {
  await page.goto("/login?returnTo=%2Fauthor%2Fbooks&intent=author");
  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await approveProvider(page);
  if (page.url().includes("/author/profile")) {
    await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("Олена Вітрова");
    await page.getByRole("button", { name: "Зберегти" }).click();
  }
}

async function startNewBook(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await Promise.all([
    page.waitForURL(/\/author\/publish\?draft=.*&step=1/u),
    page.getByRole("button", { name: /Опублікувати нову книжку/u }).first().click(),
  ]);
}

test("Author completes S-10 → S-11 → S-12 → separate confirmations → submitted", async ({
  page,
  request,
}) => {
  await signInAuthor(page);
  await expect(page).toHaveURL(/\/author\/(?:publish|books)/u);
  if (page.url().endsWith("/author/books")) {
    await startNewBook(page);
  }
  await expect(page.getByRole("heading", { name: "Завантажте рукопис" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(docxBytesFixture()),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: "nich-nad-dniprom.docx",
  });
  await expect(page).toHaveURL(/step=2/u);
  await expect(page.getByRole("heading", { name: "Назва, опис та ілюстрації" })).toBeVisible();
  const resumableDraftId = new URL(page.url()).searchParams.get("draft");
  expect(resumableDraftId).toBeTruthy();
  await page.goto(`/author/publish?draft=${resumableDraftId}&step=1`);
  await expect(page.getByRole("status")).toContainText("Поточний рукопис:");
  await page.getByRole("link", { name: "Далі" }).click();
  await expect(page).toHaveURL(/step=2/u);
  await page.goto("/author/books");
  await page.getByRole("link", { name: "Продовжити" }).first().click();
  await expect(page).toHaveURL(/step=2/u);
  await expect(page.getByRole("heading", { name: "Назва, опис та ілюстрації" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    buffer: await readFile(path.resolve("public/books/covers/kryzhani-maky.png")),
    mimeType: "image/png",
    name: "kalyna.png",
  });
  await expect(page.getByRole("list", { name: "Додані ілюстрації" }).getByText("kalyna.png")).toBeVisible();
  await page.getByLabel("Назва книжки").fill("Ніч над Дніпром");
  await page
    .getByRole("textbox", { name: /^Опис \*/u })
    .fill("Українська історія про тишу, памʼять і нічну подорож Дніпром.");
  await Promise.all([
    page.waitForURL(/step=3/u, { timeout: 30_000 }),
    page.getByRole("button", { name: "Далі" }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  await Promise.all([
    page.waitForURL(/step=4/u),
    page.getByRole("button", { name: "Створити обкладинку" }).click(),
  ]);
  await page.getByLabel("Основний жанр").selectOption("proza");
  await page.getByLabel("Базова ціна, грн").fill("199");
  await Promise.all([
    page.waitForURL(/\/author\/publish\/preview\?draft=/u, { timeout: 30_000 }),
    page.getByRole("button", { name: "Підготувати preview" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Попередній перегляд видання" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ніч над Дніпром" }).last()).toBeVisible({
    timeout: 60_000,
  });
  const readingSurface = page.locator("article").filter({ hasText: "Ніч над Дніпром" }).first();
  await expect(readingSurface.locator("img")).toHaveCount(2);
  await page.getByRole("tab", { name: "Сторінка книжки" }).click();
  await expect(page.getByText("199 грн", { exact: true })).toBeVisible();
  const previewCover = page.getByRole("img", { name: "Ніч над Дніпром — Олена Вітрова" });
  await expect(previewCover).toHaveCSS("border-radius", "0px");
  await page.getByRole("button", { name: "Мобільний" }).click();
  const frame = page.getByLabel("Попередній перегляд Сторінки книжки");
  await expect.poll(async () => (await frame.boundingBox())?.width ?? 999).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sampleSection = page.getByLabel("Безкоштовний фрагмент");
  await expect(sampleSection.locator("option:not([disabled])")).not.toHaveCount(0);
  await sampleSection.selectOption("0");
  await Promise.all([
    page.waitForURL(/step=6/u, { timeout: 30_000 }),
    page.getByRole("button", { name: "Зберегти фрагмент і перейти далі" }).click(),
  ]);
  const submit = page.getByRole("button", { name: "Подати книжку" });
  await expect(submit).toBeDisabled();
  await page
    .getByLabel(/Підтверджую Декларацію прав/u)
    .check();
  await expect(submit).toBeDisabled();
  await page
    .getByLabel(/Окремо приймаю пʼятирічну/u)
    .check();
  await expect(submit).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/author\/books\?submitted=1/u, { timeout: 30_000 }),
    submit.click(),
  ]);
  await expect(page.getByText("Книжку подано")).toBeVisible();
  await expect(page.getByText("На модерації", { exact: true })).toBeVisible();

  const databaseUrl = process.env.UNIT03_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const database = new Client({ connectionString: databaseUrl! });
  await database.connect();
  let epubObjectId = "";
  let mobiObjectId = "";
  try {
    const state = await database.query<{
      declarations: number;
      epub_object_id: string;
      events: number;
      mobi_object_id: string;
      public_books: number;
      versions: number;
    }>(
      `
        SELECT
          version.epub_object_id,
          version.mobi_object_id,
          (SELECT COUNT(*)::int FROM publishing_book_versions) AS versions,
          (SELECT COUNT(*)::int FROM publishing_rights_declarations) AS declarations,
          (SELECT COUNT(*)::int FROM outbox_events WHERE event_type = 'BookSubmitted') AS events,
          (SELECT COUNT(*)::int FROM catalog_book_read_models) AS public_books
        FROM publishing_book_versions version
        ORDER BY submitted_at DESC LIMIT 1
      `,
    );
    expect(state.rows[0]).toMatchObject({ declarations: 2, events: 1, public_books: 0, versions: 1 });
    epubObjectId = state.rows[0]!.epub_object_id;
    mobiObjectId = state.rows[0]!.mobi_object_id;
  } finally {
    await database.end();
  }
  const epub = await page.request.get(`/api/author/publishing/objects/${epubObjectId}`);
  expect(epub.status()).toBe(200);
  expect(epub.headers()["content-type"]).toContain("application/epub+zip");
  const mobi = await page.request.get(`/api/author/publishing/objects/${mobiObjectId}`);
  expect(mobi.status()).toBe(200);
  expect(mobi.headers()["content-type"]).toContain("application/x-mobipocket-ebook");
  expect((await request.get(`/api/author/publishing/objects/${epubObjectId}`)).status()).toBe(401);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Доступ заборонено" })).toBeVisible();
});

test("unsupported and broken uploads recover inline without losing the draft", async ({ page }) => {
  await signInAuthor(page);
  await expect(page).toHaveURL(/\/author\/(?:publish|books)/u);
  if (page.url().endsWith("/author/books")) {
    await startNewBook(page);
  }
  const input = page.locator('input[type="file"]');
  const googleDocs = page.getByLabel("Посилання Google Docs");
  await googleDocs.fill("https://example.com/not-a-google-document");
  await page.getByRole("button", { name: "Імпортувати з Google Docs" }).click();
  const googleError = googleDocs.locator("xpath=ancestor::form").getByRole("alert");
  await expect(googleError).toBeVisible();
  await expect(googleDocs).toBeFocused();
  await expect(googleDocs).toHaveAttribute("aria-invalid", "true");
  const googleDescriptionIds = (await googleDocs.getAttribute("aria-describedby"))?.split(/\s+/u) ?? [];
  expect(googleDescriptionIds.length).toBeGreaterThanOrEqual(2);
  for (const id of googleDescriptionIds) {
    expect(await page.evaluate((descriptionId) => Boolean(document.getElementById(descriptionId)), id)).toBe(true);
  }
  await input.setInputFiles({
    buffer: Buffer.from("%PDF-1.7 not accepted"),
    mimeType: "application/pdf",
    name: "wrong.pdf",
  });
  await expect(
    page.locator('[role="alert"]').filter({ hasText: "Підтримуються лише DOCX, TXT" }),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const uploadDescriptionIds = (await input.getAttribute("aria-describedby"))?.split(/\s+/u) ?? [];
  expect(uploadDescriptionIds.length).toBeGreaterThanOrEqual(2);
  for (const id of uploadDescriptionIds) {
    expect(await page.evaluate((descriptionId) => Boolean(document.getElementById(descriptionId)), id)).toBe(true);
  }
  await input.setInputFiles({
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: "broken.docx",
  });
  await expect(
    page.locator('[role="alert"]').filter({ hasText: "Не вдалося прочитати рукопис" }),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await input.setInputFiles({
    buffer: Buffer.from("# Перший розділ\n\nЧернетка збережена після помилок."),
    mimeType: "text/plain",
    name: "recovered.txt",
  });
  await expect(page).toHaveURL(/step=2/u);
  await page.goto("/author/books");
  await expect(page.getByText("Чернетка").first()).toBeVisible();
});

test("S-12 conversion failure is announced, retries, and preserves the same draft", async ({ page }) => {
  await signInAuthor(page);
  await expect(page).toHaveURL(/\/author\/(?:publish|books)/u);
  if (page.url().endsWith("/author/books")) {
    await startNewBook(page);
  }
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(docxBytesFixture()),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: "retry-preserved.docx",
  });
  await expect(page).toHaveURL(/step=2/u);
  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();
  await page.getByLabel("Назва книжки").fill("Чернетка, що пережила помилку");
  await page
    .getByRole("textbox", { name: /^Опис \*/u })
    .fill("Цей опис, рукопис, обкладинка і комерційні поля мають пережити невдалу конвертацію.");
  await Promise.all([
    page.waitForURL(/step=3/u, { timeout: 30_000 }),
    page.getByRole("button", { name: "Далі" }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  await Promise.all([
    page.waitForURL(/step=4/u),
    page.getByRole("button", { name: "Створити обкладинку" }).click(),
  ]);
  await page.getByLabel("Основний жанр").selectOption("proza");
  await page.getByLabel("Базова ціна, грн").fill("247");
  await Promise.all([
    page.waitForURL(/\/author\/publish\/preview\?draft=/u, { timeout: 30_000 }),
    page.getByRole("button", { name: "Підготувати preview" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Чернетка, що пережила помилку" }).last()).toBeVisible({
    timeout: 45_000,
  });
  await page.getByLabel("Безкоштовний фрагмент").selectOption("0");
  await Promise.all([
    page.waitForURL(/step=6/u, { timeout: 30_000 }),
    page.getByRole("button", { name: "Зберегти фрагмент і перейти далі" }).click(),
  ]);
  await page.goto("/author/books");
  await page
    .locator("article")
    .filter({ hasText: "Чернетка, що пережила помилку" })
    .getByRole("link", { name: "Продовжити" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/author/publish/preview\\?draft=${draftId}`));
  await expect(page.getByRole("heading", { name: "Чернетка, що пережила помилку" }).last()).toBeVisible();

  const databaseUrl = process.env.UNIT03_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const database = new Client({ connectionString: databaseUrl! });
  await database.connect();
  const before = await database.query<{
    base_price_kopiykas: number;
    cover_object_id: string;
    description: string;
    genre_slug: string;
    manuscript_object_id: string;
    revision: number;
    sample_preview_artifact_id: string;
    sample_section_index: number;
    title: string;
  }>(
    `
      SELECT revision, title, description, manuscript_object_id, cover_object_id,
             genre_slug, base_price_kopiykas, sample_section_index,
             sample_preview_artifact_id
      FROM publishing_book_drafts
      WHERE id = $1
    `,
    [draftId],
  );
  expect(before.rows).toHaveLength(1);
  try {
    await database.query("BEGIN");
    await database.query(
      `
        UPDATE publishing_conversion_runs
        SET status = 'failed', failure_code = 'CALIBRE_FAILED',
            failure_message = 'Не вдалося завершити конвертацію. Чернетку збережено.',
            completed_at = CURRENT_TIMESTAMP
        WHERE id = (
          SELECT id FROM publishing_conversion_runs
          WHERE draft_id = $1 AND status = 'completed'
          ORDER BY completed_at DESC LIMIT 1
        )
      `,
      [draftId],
    );
    await database.query(
      `
        UPDATE publishing_book_drafts
        SET status = 'conversion_failed', conversion_failure_code = 'CALIBRE_FAILED',
            conversion_failure_message = 'Не вдалося завершити конвертацію. Чернетку збережено.',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [draftId],
    );
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    await database.end();
    throw error;
  }
  await database.end();

  await page.goto("/author/books");
  await page
    .locator("article")
    .filter({ hasText: "Чернетка, що пережила помилку" })
    .getByRole("link", { name: "Продовжити" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/author/publish/preview\\?draft=${draftId}`));
  const conversionError = page.getByRole("alert", { name: "Не вдалося підготувати видання" });
  await expect(conversionError).toContainText("Чернетку збережено");
  await expect(conversionError.getByRole("button", { name: "Спробувати ще раз" })).toBeVisible();
  await expect(conversionError.getByRole("link", { name: "Завантажити інший файл" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await Promise.all([
    page.waitForURL(new RegExp(`/author/publish/preview\\?draft=${draftId}&retry=[^&]+`), {
      timeout: 30_000,
    }),
    conversionError.getByRole("button", { name: "Спробувати ще раз" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Чернетка, що пережила помилку" }).last()).toBeVisible({
    timeout: 45_000,
  });

  const verificationDatabase = new Client({ connectionString: databaseUrl! });
  await verificationDatabase.connect();
  const after = await verificationDatabase.query<{
    base_price_kopiykas: number;
    cover_object_id: string;
    description: string;
    genre_slug: string;
    manuscript_object_id: string;
    revision: number;
    sample_preview_artifact_id: string | null;
    sample_section_index: number | null;
    status: string;
    title: string;
  }>(
    `
      SELECT revision, status, title, description, manuscript_object_id, cover_object_id,
             genre_slug, base_price_kopiykas, sample_section_index,
             sample_preview_artifact_id
      FROM publishing_book_drafts
      WHERE id = $1
    `,
    [draftId],
  );
  expect(after.rows[0]).toMatchObject({
    base_price_kopiykas: before.rows[0]!.base_price_kopiykas,
    cover_object_id: before.rows[0]!.cover_object_id,
    description: before.rows[0]!.description,
    genre_slug: before.rows[0]!.genre_slug,
    manuscript_object_id: before.rows[0]!.manuscript_object_id,
    revision: before.rows[0]!.revision,
    sample_preview_artifact_id: null,
    sample_section_index: null,
    status: "ready",
    title: before.rows[0]!.title,
  });
  await verificationDatabase.end();

  await page.getByRole("link", { name: "Повернутися до редагування" }).click();
  await expect(page).toHaveURL(/step=4/u);
  await expect(page.getByLabel("Основний жанр")).toHaveValue("proza");
  await expect(page.getByLabel("Базова ціна, грн")).toHaveValue("247.00");
  await page.getByRole("link", { name: /Опис та ілюстрації/u }).click();
  await expect(page.getByLabel("Назва книжки")).toHaveValue("Чернетка, що пережила помилку");
  await expect(page.getByRole("textbox", { name: /^Опис \*/u })).toHaveValue(
    "Цей опис, рукопис, обкладинка і комерційні поля мають пережити невдалу конвертацію.",
  );
  await page.getByRole("link", { name: "Рукопис" }).click();
  await expect(page.getByRole("status")).toContainText("Поточний рукопис:");
  await page.getByRole("link", { name: "Далі" }).click();
  await expect(page).toHaveURL(/step=2/u);
  await expect(page.getByLabel("Назва книжки")).toHaveValue("Чернетка, що пережила помилку");
});
