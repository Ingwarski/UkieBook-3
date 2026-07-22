import { expect, test } from "@playwright/test";

test("S-01 searches title/Author, composes filters and paginates through URL state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Затишні вечори/u })).toBeVisible();
  await expect(page.getByText("Прозора формула: з кожних 100 грн")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Знайдіть наступну книжку" })).toBeVisible();

  const search = page.locator('header form[role="search"]:visible');
  await search.getByLabel("Пошук за назвою або автором").fill("Ірина Верес");
  await search.getByLabel("Пошук за назвою або автором").press("Enter");
  await expect(page).toHaveURL(/\?q=%D0%86%D1%80%D0%B8%D0%BD%D0%B0\+%D0%92%D0%B5%D1%80%D0%B5%D1%81/u);
  await expect(page.getByRole("heading", { name: "Сад камʼяних птахів" }).last()).toBeVisible();
  await expect(page.getByText("1 книжка")).toBeVisible();

  await page.goto("/#catalog-results");
  const filters = page.locator('#catalog-results form:visible').first();
  await filters.getByLabel("Жанр").selectOption("proza");
  await filters.getByLabel("Зі знижкою").check();
  await filters.getByLabel("Сортування").selectOption("price_asc");
  await filters.getByRole("button", { name: "Застосувати" }).click();
  await expect(page).toHaveURL(/genre=proza/u);
  await expect(page).toHaveURL(/discounted=1/u);
  await expect(page).toHaveURL(/sort=price_asc/u);
  await expect(page.getByRole("heading", { name: "Сад камʼяних птахів" }).last()).toBeVisible();

  await page.goto("/#catalog-results");
  await page.getByRole("link", { name: /Наступна/u }).click();
  await expect(page).toHaveURL(/page=2#catalog-results/u);
  await expect(page.getByText("Сторінка 2 із 2")).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/page=2/u);
});

test("S-01 links into S-02 and S-02 exposes Discount, sample and paged reviews", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Сад камʼяних птахів, Ірина Верес/u }).first().click();
  await expect(page).toHaveURL(/\/books\/44444444-4444-4444-8444-444444444444/u);
  await expect(page.getByRole("heading", { level: 1, name: "Сад камʼяних птахів" })).toBeVisible();
  await expect(page.getByText("210 грн", { exact: true })).toBeVisible();
  await expect(page.getByText("−16%", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Додати в кошик" }).first()).toHaveAttribute(
    "href",
    /\/login\?returnTo=/u,
  );

  await page.getByRole("link", { name: "Читати фрагмент" }).click();
  await expect(page).toHaveURL(/sample=1#sample/u);
  await expect(page.locator("details#sample")).toHaveAttribute("open", "");
  await expect(page.getByText("Першого птаха Ірина побачила під грушею.")).toBeVisible();

  await page.getByRole("link", { name: "Наступні" }).click();
  await expect(page).toHaveURL(/reviews=2#reviews/u);
  await expect(page.getByText("2 / 2")).toBeVisible();

  await page.goto("/books/11111111-1111-4111-8111-111111111111");
  await expect(page.getByText("265 грн", { exact: true })).toBeVisible();
  await expect(page.locator("del")).toHaveCount(0);

  const description = page.getByText(/Родинна історія/u);
  const descriptionSummary = page.locator(
    'section[aria-labelledby="description-title"] summary',
  );
  await expect(description).toBeVisible();
  await descriptionSummary.click();
  await expect(description).not.toBeVisible();
  await descriptionSummary.click();
  await expect(description).toBeVisible();
});

test("S-02 distinguishes a known unavailable Book from an unknown ID", async ({ page }) => {
  await page.goto("/books/77777777-7777-4777-8777-777777777777");
  await expect(page.getByRole("heading", { level: 1, name: "Тіні над лиманом" })).toBeVisible();
  await expect(page.getByText("Книжка недоступна", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Додати в кошик" })).toHaveCount(0);

  await page.goto("/books/not-a-book-id");
  await expect(page.getByRole("heading", { name: "Такої книжки немає" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/u);
});

test("S-01 renders a constructive empty result without losing the locked shell", async ({ page }) => {
  await page.goto("/?q=%D0%BD%D0%B5%D0%B2%D1%96%D0%B4%D0%BE%D0%BC%D0%B0#catalog-results");
  await expect(page.getByRole("heading", { name: /Затишні вечори/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Нічого не знайдено" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Скинути фільтри" })).toBeVisible();
});

test("S-01 mobile search preserves active filters and S-02 announces no false current page", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?genre=proza&discounted=1&sort=price_asc#catalog-results");
  const catalogMain = page.locator("main:not([aria-label])");
  await expect(catalogMain).toBeVisible();
  await catalogMain.locator('header summary[aria-label="Відкрити меню"]').click();
  const mobileSearch = catalogMain.locator('header form[role="search"]:visible');
  await mobileSearch.getByLabel("Пошук за назвою або автором").fill("Ірина");
  await mobileSearch.getByRole("button", { name: "Знайти" }).click();
  await expect(page).toHaveURL(/genre=proza/u);
  await expect(page).toHaveURL(/discounted=1/u);
  await expect(page).toHaveURL(/sort=price_asc/u);
  await expect(page).toHaveURL(/q=%D0%86%D1%80%D0%B8%D0%BD%D0%B0/u);

  await page.goto("/books/44444444-4444-4444-8444-444444444444");
  await expect(page.locator('header a[aria-current="page"]')).toHaveCount(0);
  const titleBox = await page.getByRole("heading", { level: 1 }).boundingBox();
  const coverBox = await page.locator("article img").first().boundingBox();
  const fragmentLinkBox = await page.getByRole("link", { name: "Читати фрагмент" }).boundingBox();
  const sampleBox = await page.locator("details#sample").boundingBox();
  const descriptionBox = await page
    .locator('section[aria-labelledby="description-title"]')
    .boundingBox();
  expect(titleBox!.y).toBeLessThan(coverBox!.y);
  expect(fragmentLinkBox!.y).toBeLessThan(descriptionBox!.y);
  expect(descriptionBox!.y).toBeLessThan(sampleBox!.y);
  const primaryPurchase = page.locator("article").getByRole("link", { name: "Додати в кошик" });
  const fragmentLink = page.getByRole("link", { name: "Читати фрагмент" });
  await expect(primaryPurchase).toBeVisible();
  await expect(page.getByRole("link", { name: "Додати в кошик" })).toHaveCount(1);
  await page.evaluate(() => {
    document.documentElement.tabIndex = -1;
    document.documentElement.focus();
  });
  const purchaseOrder: string[] = [];
  for (let step = 0; step < 30 && purchaseOrder.length < 2; step += 1) {
    await page.keyboard.press("Tab");
    if (await primaryPurchase.evaluate((element) => document.activeElement === element)) {
      purchaseOrder.push("purchase");
    }
    if (await fragmentLink.evaluate((element) => document.activeElement === element)) {
      purchaseOrder.push("fragment");
    }
  }
  expect(purchaseOrder).toEqual(["purchase", "fragment"]);
  await page.evaluate(() => document.documentElement.removeAttribute("tabindex"));
});
