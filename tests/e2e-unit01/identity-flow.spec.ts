import { expect, test } from "@playwright/test";

import { openPostgresDatabase } from "../../db/postgres";

async function approveProvider(page: import("@playwright/test").Page, provider: "Google" | "Facebook") {
  await expect(page).toHaveURL(/127\.0\.0\.1:3200\/(google|facebook)\/authorize/u);
  const authorizationUrl = new URL(page.url());
  expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
  expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
  expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
    `http://127.0.0.1:3102/api/auth/${provider.toLowerCase()}/callback`,
  );
  if (provider === "Google") expect(authorizationUrl.searchParams.get("nonce")).toBeTruthy();
  await page.getByRole("link", { name: "Підтвердити" }).click();
}

test("S-03 exposes only Google/Facebook and returns to a trusted source", async ({
  browser,
  page,
  request,
}) => {
  const crossOrigin = await request.post("/api/auth/google/start", {
    form: { intent: "default", returnTo: "/cart" },
    headers: { Origin: "https://evil.example" },
    maxRedirects: 0,
  });
  expect(crossOrigin.status()).toBe(403);

  await page.goto("/login?returnTo=%2Fcart");
  await expect(page.getByRole("heading", { name: "Вхід" })).toBeVisible();
  await expect(page.getByText("Вхід потрібен для покупки чи публікації")).toBeVisible();
  await expect(page.getByRole("button", { name: "Увійти через Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Увійти через Facebook" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator("form").filter({ has: page.getByRole("button", { name: /Увійти через/u }) })).toHaveCount(2);

  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await expect(page).toHaveURL(/\/google\/authorize/u);
  await page.getByRole("link", { name: "Відхилити" }).click();
  await expect(page).toHaveURL(/\/login\?error=provider_failed/u);
  await expect(
    page.getByRole("alert").filter({ hasText: "Не вдалося завершити вхід" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Увійти через Google" }).click();
  let callbackUrl = "";
  page.on("request", (outgoing) => {
    if (outgoing.url().includes("/api/auth/google/callback")) callbackUrl = outgoing.url();
  });
  await approveProvider(page, "Google");
  await expect(page).toHaveURL("http://127.0.0.1:3102/cart");
  expect(callbackUrl).toContain("state=");

  await page.goto(callbackUrl);
  await expect(page).toHaveURL(/\/login\?error=invalid_flow/u);
  await expect(
    page.getByRole("alert").filter({ hasText: "вже використаний" }),
  ).toBeVisible();

  const facebookContext = await browser.newContext();
  const facebookPage = await facebookContext.newPage();
  await facebookPage.goto("/login?returnTo=%2Fcart");
  await facebookPage.getByRole("button", { name: "Увійти через Facebook" }).click();
  await approveProvider(facebookPage, "Facebook");
  await expect(facebookPage).toHaveURL("http://127.0.0.1:3102/cart");
  await facebookContext.close();
});

test("first Author completes S-17, rotates the session and cannot enter Manager routes", async ({
  page,
}) => {
  await page.goto("/login?returnTo=%2Fauthor%2Fbooks&intent=author");
  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await approveProvider(page, "Google");
  await expect(page).toHaveURL("http://127.0.0.1:3102/author/profile");
  await expect(page.getByRole("heading", { name: "Профіль автора" })).toBeVisible();
  await expect(page.getByText("Так це ім'я виглядатиме у книгарні")).toBeVisible();

  await page.locator('input[name="csrfToken"]').evaluate((input) => {
    (input as HTMLInputElement).value = "tampered-csrf-token";
  });
  await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("Не зберігати");
  await page.getByRole("button", { name: "Зберегти" }).click();
  await expect(page).toHaveURL(
    "http://127.0.0.1:3102/author/profile?error=request_rejected",
  );
  await expect(
    page.getByRole("alert").filter({
      hasText: "Не вдалося перевірити запит. Оновіть сторінку й спробуйте ще раз.",
    }),
  ).toBeVisible();

  await page.goto("/author/profile");
  await expect(page.getByRole("button", { name: "Зберегти" })).toBeEnabled();
  await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("Леся Українка");
  await page.getByRole("button", { name: "Зберегти" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3102/author/publish");
  await expect(page.getByRole("heading", { name: "Нова книжка" })).toBeVisible();

  await page.goto("/admin");
  expect((await page.request.get("/admin")).status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Доступ заборонено" })).toBeVisible();

  await page.goto("/author/profile");
  const userId = await page.evaluate(() => {
    const nextPayload = document.documentElement.innerHTML;
    return nextPayload.includes("private-google@simulator.test");
  });
  expect(userId).toBe(false);
  await expect(page.locator("body")).not.toContainText("private-google@simulator.test");

  const databaseUrl = process.env.UNIT01_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const database = openPostgresDatabase(databaseUrl!);
  try {
    const author = await database.query<{ user_id: string }>(
      "SELECT user_id FROM author_profiles WHERE public_name = $1",
      ["Леся Українка"],
    );
    await database.query(
      `
        INSERT INTO author_payout_details (
          user_id, schema_version, key_id, nonce, ciphertext, authentication_tag
        ) VALUES ($1, 1, 'browser-proof-key', $2, $3, $4)
        ON CONFLICT (user_id) DO NOTHING
      `,
      [
        author.rows[0]?.user_id,
        Buffer.alloc(12, 1),
        Buffer.from("BANK-TAX-PAYOUT-BROWSER-SENTINEL"),
        Buffer.alloc(16, 2),
      ],
    );
  } finally {
    await database.close();
  }
  await page.reload();
  const rendered = await page.locator("html").textContent();
  expect(rendered).not.toContain("BANK-TAX-PAYOUT-BROWSER-SENTINEL");
  expect(await page.content()).not.toContain("private-google@simulator.test");
});

test("existing Author returns to the Author cabinet and unsafe returnTo falls back", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal&intent=author");
  const hiddenReturn = page.locator('form[action="/api/auth/google/start"] input[name="returnTo"]');
  await expect(hiddenReturn).toHaveValue("/");
  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await approveProvider(page, "Google");
  await expect(page).toHaveURL("http://127.0.0.1:3102/");

  await context.clearCookies();
  await page.goto("/login?returnTo=%2Fauthor%2Fbooks&intent=author");
  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await approveProvider(page, "Google");
  await expect(page).toHaveURL("http://127.0.0.1:3102/author/books");
  await expect(page.getByRole("heading", { name: "Мої книжки" })).toBeVisible();
  await context.close();
});
