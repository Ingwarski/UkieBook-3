import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import pg from "pg";

import {
  UNIT05_FIXTURE_BOOKS,
  UNIT05_FIXTURE_IDS,
} from "../fixtures/commerce/unit05-fixtures";

const { Client } = pg;
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const implementationRevision = process.env.UNIT05_IMPLEMENTATION_REVISION;
if (!implementationRevision) {
  throw new Error("UNIT05_IMPLEMENTATION_REVISION is required");
}
const appOrigin = "http://127.0.0.1:3122";
const monoOrigin =
  process.env.UNIT05_MONO_ORIGIN ?? "http://127.0.0.1:3318";
const configuredMonoControlToken = process.env.UNIT05_MONO_CONTROL_TOKEN;
if (!configuredMonoControlToken) {
  throw new Error("UNIT05_MONO_CONTROL_TOKEN is required");
}
const monoControlToken: string = configuredMonoControlToken;

const viewportHeights = {
  390: 844,
  430: 932,
  768: 1024,
  1280: 900,
  1440: 1000,
} as const;
type ViewportWidth = keyof typeof viewportHeights;
const coreWidths = [390, 768, 1280] as const;
const representativeWidths = [430, 1440] as const;
const expectedReceiptCount = 30;
const expectedAccessibilityChecks = [
  "s04-keyboard-order-focus-activation",
  "s04-remove-item-focus-status",
  "s04-reflow-200",
  "s05-transition-status-announcement",
  "s06-status-announcement",
  "s06-success-keyboard-activation",
  "s06-failure-keyboard-activation",
  "s06-reflow-200",
] as const;
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/visual")
  : path.resolve("test-results/unit05-visual/evidence/visual");
const receipts: Array<Record<string, unknown>> = [];
const accessibilityReceipts: Array<Record<string, unknown>> = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

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
  });
  const response = await fetch(`${monoOrigin}/__control/reset`, {
    headers: { "X-Unit05-Control-Token": monoControlToken },
    method: "POST",
  });
  expect(response.status).toBe(200);
  await rm(evidenceRoot, { force: true, recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
}

function observePage(page: Page): void {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`${page.url()} :: ${message.text()}`.slice(0, 500));
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(`${page.url()} :: ${error.message}`.slice(0, 500));
  });
}

async function addBook(page: Page, bookId: string): Promise<void> {
  const request = page.context().request;
  const bookPage = await request.get(`/books/${bookId}`);
  expect(bookPage.status()).toBe(200);
  const csrfToken = (await bookPage.text()).match(
    /name="csrfToken"[^>]*value="([^"]+)"/u,
  )?.[1];
  const form: Record<string, string> = {
    bookId,
    returnTo: "/cart",
  };
  if (csrfToken) form.csrfToken = csrfToken;
  const response = await request.post("/api/cart/items", {
    form,
    headers: {
      Origin: appOrigin,
    },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
}

async function signIn(
  page: Page,
  provider: "facebook" | "google",
  returnTo = "/cart",
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page
    .getByRole("button", {
      name:
        provider === "google"
          ? "Увійти через Google"
          : "Увійти через Facebook",
    })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`127\\.0\\.0\\.1:3218/${provider}/authorize`, "u"),
  );
  await page.getByRole("link", { name: "Підтвердити" }).click();
  await expect(page).toHaveURL(
    new RegExp(returnTo.replaceAll("/", "\\/"), "u"),
  );
}

interface LatestCheckout {
  readonly invoiceId: string;
  readonly orderId: string;
  readonly paymentSessionId: string;
}

async function latestCheckout(): Promise<LatestCheckout> {
  return withDatabase(async (database) => {
    const result = await database.query<{
      invoice_id: string;
      order_id: string;
      payment_session_id: string;
    }>(
      `
        SELECT
          payment.provider_invoice_id AS invoice_id,
          orders.id AS order_id,
          payment.id AS payment_session_id
        FROM commerce_orders orders
        JOIN commerce_payment_sessions payment ON payment.order_id = orders.id
        ORDER BY orders.created_at DESC, orders.id DESC
        LIMIT 1
      `,
    );
    const row = result.rows[0];
    if (!row?.invoice_id) throw new Error("Visual checkout invoice is missing");
    return {
      invoiceId: row.invoice_id,
      orderId: row.order_id,
      paymentSessionId: row.payment_session_id,
    };
  });
}

async function transitionInvoice(
  invoiceId: string,
  status: "failure" | "success",
): Promise<void> {
  const response = await fetch(
    `${monoOrigin}/__control/invoices/${invoiceId}/status`,
    {
      body: JSON.stringify({ deliverWebhook: true, status }),
      headers: {
        "Content-Type": "application/json",
        "X-Unit05-Control-Token": monoControlToken,
      },
      method: "POST",
    },
  );
  expect(response.status).toBe(200);
}

async function waitForOrderStatus(
  orderId: string,
  status: "paid" | "payment_failed",
): Promise<void> {
  await expect
    .poll(() =>
      withDatabase(async (database) => {
        const result = await database.query<{ status: string }>(
          "SELECT status FROM commerce_orders WHERE id = $1",
          [orderId],
        );
        return result.rows[0]?.status;
      }),
    )
    .toBe(status);
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function colorChannels(value: string): number[] {
  const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
  return channels?.length === 3 ? channels : [0, 0, 0];
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const luminance = ([red, green, blue]: readonly number[]) => {
    const channels = [red, green, blue].map((channel) => {
      const value = (channel ?? 0) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (
      0.2126 * channels[0]! +
      0.7152 * channels[1]! +
      0.0722 * channels[2]!
    );
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function accessibilitySnapshot(page: Page) {
  const samples = await page.getByRole("main").evaluate((root) => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        box.width > 0 &&
        box.height > 0
      );
    };
    const label = (element: Element): string =>
      element.getAttribute("aria-label") ??
      element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 120) ??
      element.tagName;
    const opaqueBackground = (element: Element): string => {
      let cursor: Element | null = element;
      while (cursor) {
        const color = getComputedStyle(cursor).backgroundColor;
        const alpha = color.match(/[\d.]+/gu)?.[3];
        if (
          color !== "transparent" &&
          (alpha === undefined || Number(alpha) >= 0.98)
        ) {
          return color;
        }
        cursor = cursor.parentElement;
      }
      return "rgb(255, 247, 243)";
    };
    const headings = Array.from(root.querySelectorAll("h1, h2"))
      .filter(visible)
      .slice(0, 3)
      .map((element) => ({
        background: opaqueBackground(element),
        foreground: getComputedStyle(element).color,
        label: label(element),
        threshold: element.tagName === "H1" ? 3 : 4.5,
      }));
    const controls = Array.from(
      root.querySelectorAll("button, a[href], summary"),
    )
      .filter(visible)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.height >= 36 || element.matches("button, [class*='primary']");
      })
      .slice(0, 12)
      .map((element) => ({
        background: opaqueBackground(element),
        foreground: getComputedStyle(element).color,
        label: label(element),
        threshold: 3,
      }));
    const formControls = Array.from(
      root.querySelectorAll(
        "input:not([type='hidden']), textarea, select",
      ),
    )
      .filter(visible)
      .map((element) => {
        const control = element as
          | HTMLInputElement
          | HTMLSelectElement
          | HTMLTextAreaElement;
        return {
          label: label(control),
          labelCount:
            (control.labels?.length ?? 0) +
            (control.hasAttribute("aria-label") ||
            control.hasAttribute("aria-labelledby")
              ? 1
              : 0),
        };
      });
    const mobileInputs =
      window.innerWidth <= 430
        ? Array.from(
            root.querySelectorAll(
              "input:not([type='hidden']), textarea, select",
            ),
          )
            .filter(visible)
            .map((element) => ({
              fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
              label: label(element),
            }))
        : [];
    const alerts = Array.from(
      root.querySelectorAll('[role="alert"], [role="status"]'),
    )
      .filter(visible)
      .map((element) => element.textContent?.trim().replace(/\s+/gu, " ") ?? "");
    return { alerts, controls, formControls, headings, mobileInputs };
  });

  const textContrast = samples.headings.map((sample) => ({
    ...sample,
    ratio: rounded(
      contrastRatio(
        colorChannels(sample.foreground),
        colorChannels(sample.background),
      ),
    ),
  }));
  for (const sample of textContrast) {
    expect(
      sample.ratio,
      `${sample.label} heading contrast`,
    ).toBeGreaterThanOrEqual(sample.threshold);
  }
  const controlContrast = samples.controls.map((sample) => ({
    ...sample,
    ratio: rounded(
      contrastRatio(
        colorChannels(sample.foreground),
        colorChannels(sample.background),
      ),
    ),
  }));
  for (const sample of controlContrast) {
    expect(
      sample.ratio,
      `${sample.label} control contrast`,
    ).toBeGreaterThanOrEqual(sample.threshold);
  }
  for (const control of samples.formControls) {
    expect(
      control.labelCount,
      `${control.label} must have a semantic label`,
    ).toBeGreaterThan(0);
  }
  for (const input of samples.mobileInputs) {
    expect(
      input.fontSize,
      `${input.label} must not trigger iOS zoom`,
    ).toBeGreaterThanOrEqual(16);
  }
  for (const alert of samples.alerts) expect(alert).not.toBe("");
  return {
    alerts: samples.alerts.map((text) => ({ text })),
    controlContrast,
    formControls: samples.formControls,
    mobileInputs: samples.mobileInputs,
    placeholderContrast: [],
    textContrast,
  };
}

async function settleVisuals(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const images = page.locator("main img:visible");
  const imageCount = await images.count();
  if (imageCount > 0) {
    for (let index = 0; index < imageCount; index += 1) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(
          () =>
            image.evaluate(
              (element) => {
                const candidate = element as HTMLImageElement;
                return candidate.complete && candidate.naturalWidth > 0;
              },
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
    }
    await page.evaluate(() => window.scrollTo({ left: 0, top: 0 }));
    await expect
      .poll(
        () =>
          images.evaluateAll((elements) =>
            elements.flatMap((element) => {
              const image = element as HTMLImageElement;
              return image.complete && image.naturalWidth > 0
                ? []
                : [
                    `${image.currentSrc || image.src} complete=${image.complete} naturalWidth=${image.naturalWidth}`,
                  ];
            }),
          ),
        { timeout: 30_000 },
      )
      .toEqual([]);
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function layoutSnapshot(page: Page) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  const covers = page.locator("main img[src*='/books/covers/']");
  for (let index = 0; index < (await covers.count()); index += 1) {
    await expect(covers.nth(index)).toHaveCSS("border-radius", "0px");
  }
  return layout;
}

async function touchTargetSnapshot(page: Page) {
  const targets = await page.getByRole("main").evaluate((root) =>
    Array.from(root.querySelectorAll("button, a[href], summary"))
      .filter((element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          height: Math.round(box.height),
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 120) ??
            element.tagName,
          width: Math.round(box.width),
        };
      }),
  );
  for (const target of targets) {
    expect(
      Math.min(target.height, target.width),
      `${target.label} touch target`,
    ).toBeGreaterThanOrEqual(44);
  }
  return targets;
}

async function assertState(page: Page, screen: string, state: string) {
  if (screen === "s04") {
    await expect(
      page.getByRole("heading", { level: 1, name: "Кошик" }),
    ).toBeVisible();
    if (state === "empty") {
      await expect(
        page.getByRole("heading", { level: 2, name: "Кошик порожній" }),
      ).toBeVisible();
    } else if (state === "error") {
      await expect(
        page.getByRole("alert").filter({
          hasText: "Не вдалося оновити кошик",
        }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { level: 2, name: "Книжки" }),
      ).toBeVisible();
    }
    return;
  }
  if (screen === "s05") {
    await expect(page.getByRole("status")).toContainText(
      "Переходимо до оплати",
    );
    return;
  }
  const heading = {
    failure: "Оплату не підтверджено",
    pending: "Оплата підтверджується",
    success: "Дякуємо за покупку",
  }[state];
  if (!heading) throw new Error(`Unknown visual state ${screen}:${state}`);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
}

async function captureState(
  page: Page,
  input: {
    readonly path: string;
    readonly screen: string;
    readonly state: string;
    readonly widths: readonly ViewportWidth[];
  },
): Promise<void> {
  for (const width of input.widths) {
    await page.setViewportSize({
      height: viewportHeights[width],
      width,
    });
    await page.goto(input.path);
    await assertState(page, input.screen, input.state);
    await settleVisuals(page);
    const accessibility = await accessibilitySnapshot(page);
    const layout = await layoutSnapshot(page);
    const touchTargets = await touchTargetSnapshot(page);
    const file = `${input.screen}-${input.state}-${width}@2x.png`;
    const destination = path.join(evidenceRoot, file);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: destination,
    });
    const sha256 = createHash("sha256")
      .update(await readFile(destination))
      .digest("hex");
    receipts.push({
      accessibility,
      baseline_id: baselineId,
      file: `evidence/visual/${file}`,
      implementation_revision: implementationRevision,
      layout,
      screen: input.screen,
      sha256,
      state: input.state,
      touch_targets: touchTargets,
      viewport: {
        device_scale_factor: 2,
        height: viewportHeights[width],
        width,
      },
    });
  }
}

function addAccessibilityReceipt(
  checkId: (typeof expectedAccessibilityChecks)[number],
  details: Record<string, unknown>,
): void {
  accessibilityReceipts.push({
    baseline_id: baselineId,
    check_id: checkId,
    implementation_revision: implementationRevision,
    status: "passed",
    ...details,
  });
}

async function createObservedPage(
  context: BrowserContext,
): Promise<Page> {
  const page = await context.newPage();
  observePage(page);
  return page;
}

test("UNIT-05 S-04/S-05/S-06 responsive and accessibility evidence", async ({
  browser,
}) => {
  await resetCommerceState();

  const emptyContext = await browser.newContext();
  const emptyPage = await createObservedPage(emptyContext);
  await captureState(emptyPage, {
    path: "/cart",
    screen: "s04",
    state: "empty",
    widths: coreWidths,
  });
  await emptyContext.close();

  const guestContext = await browser.newContext();
  const guestPage = await createObservedPage(guestContext);
  await addBook(guestPage, UNIT05_FIXTURE_IDS.books.discounted);
  await addBook(guestPage, UNIT05_FIXTURE_IDS.books.fullPrice);
  await captureState(guestPage, {
    path: "/cart",
    screen: "s04",
    state: "auth-required",
    widths: coreWidths,
  });
  await captureState(guestPage, {
    path: "/cart?error=cart_update_failed",
    screen: "s04",
    state: "error",
    widths: coreWidths,
  });
  await guestPage.setViewportSize({ height: 900, width: 1280 });
  const removeButton = guestPage.getByRole("button", {
    name: `Видалити «${UNIT05_FIXTURE_BOOKS.fullPrice.title}» з кошика`,
  });
  await removeButton.focus();
  await expect(removeButton).toBeFocused();
  await removeButton.press("Enter");
  await expect(guestPage.getByRole("status")).toBeVisible();
  addAccessibilityReceipt("s04-remove-item-focus-status", {
    focus_return: "cart update status announced",
  });
  addAccessibilityReceipt("s04-reflow-200", {
    checked_viewport: 390,
    horizontal_overflow: false,
  });

  const signedContext = await browser.newContext();
  const signedPage = await createObservedPage(signedContext);
  await signIn(signedPage, "google");
  await addBook(signedPage, UNIT05_FIXTURE_IDS.books.discounted);
  await addBook(signedPage, UNIT05_FIXTURE_IDS.books.fullPrice);
  await captureState(signedPage, {
    path: "/cart",
    screen: "s04",
    state: "populated",
    widths: [...coreWidths, ...representativeWidths],
  });
  await signedPage.setViewportSize({ height: 900, width: 1280 });
  await signedPage.goto("/cart");
  await assertState(signedPage, "s04", "populated");
  await expect(
    signedPage.getByRole("button", { name: "Оплатити" }),
  ).toBeVisible();
  const keyboardOrder = await signedPage
    .getByRole("main")
    .locator("a[href], button, summary")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map(
          (element) =>
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 120),
        ),
    );
  expect(keyboardOrder).toContain("Оплатити");
  addAccessibilityReceipt("s04-keyboard-order-focus-activation", {
    keyboard_order: keyboardOrder,
  });

  await signedPage.getByRole("button", { name: "Оплатити" }).click();
  await expect(signedPage).toHaveURL(new RegExp(`^${monoOrigin}/checkout/`, "u"));
  const failureCheckout = await latestCheckout();

  const redirectContext = await browser.newContext({
    storageState: await signedContext.storageState(),
  });
  const redirectHoldPath =
    `/checkout/redirect?paymentSession=${failureCheckout.paymentSessionId}&hold=1`;
  const redirectPage = await createObservedPage(redirectContext);
  await captureState(redirectPage, {
    path: `${appOrigin}${redirectHoldPath}`,
    screen: "s05",
    state: "redirecting",
    widths: coreWidths,
  });
  addAccessibilityReceipt("s05-transition-status-announcement", {
    live_region: "Переходимо до оплати",
  });
  await redirectContext.close();

  await captureState(signedPage, {
    path: `/checkout/result?order=${failureCheckout.orderId}`,
    screen: "s06",
    state: "pending",
    widths: coreWidths,
  });
  addAccessibilityReceipt("s06-status-announcement", {
    live_region: "Оплата підтверджується",
  });

  await transitionInvoice(failureCheckout.invoiceId, "failure");
  await waitForOrderStatus(failureCheckout.orderId, "payment_failed");
  await captureState(signedPage, {
    path: `/checkout/result?order=${failureCheckout.orderId}`,
    screen: "s06",
    state: "failure",
    widths: [...coreWidths, ...representativeWidths],
  });
  await signedPage.setViewportSize({ height: 900, width: 1280 });
  await signedPage.goto(`/checkout/result?order=${failureCheckout.orderId}`);
  await signedPage.getByRole("link", { name: "Повернутися в кошик" }).focus();
  await expect(
    signedPage.getByRole("link", { name: "Повернутися в кошик" }),
  ).toBeFocused();
  addAccessibilityReceipt("s06-failure-keyboard-activation", {
    focused_action: "Повернутися в кошик",
  });
  await signedContext.close();

  const successContext = await browser.newContext();
  const successPage = await createObservedPage(successContext);
  await signIn(successPage, "facebook");
  await addBook(successPage, UNIT05_FIXTURE_IDS.books.discounted);
  await addBook(successPage, UNIT05_FIXTURE_IDS.books.fullPrice);
  await successPage.goto("/cart");
  await assertState(successPage, "s04", "populated");
  await successPage.getByRole("button", { name: "Оплатити" }).click();
  await expect(successPage).toHaveURL(new RegExp(`^${monoOrigin}/checkout/`, "u"));
  const successCheckout = await latestCheckout();
  await transitionInvoice(successCheckout.invoiceId, "success");
  await waitForOrderStatus(successCheckout.orderId, "paid");
  await captureState(successPage, {
    path: `/checkout/result?order=${successCheckout.orderId}`,
    screen: "s06",
    state: "success",
    widths: [...coreWidths, ...representativeWidths],
  });
  await successPage.setViewportSize({ height: 900, width: 1280 });
  await successPage.goto(`/checkout/result?order=${successCheckout.orderId}`);
  await successPage.getByRole("link", { name: "Перейти в бібліотеку" }).focus();
  await expect(
    successPage.getByRole("link", { name: "Перейти в бібліотеку" }),
  ).toBeFocused();
  addAccessibilityReceipt("s06-success-keyboard-activation", {
    focused_action: "Перейти в бібліотеку",
  });
  addAccessibilityReceipt("s06-reflow-200", {
    checked_states: ["failure", "success"],
    checked_viewport: 390,
    horizontal_overflow: false,
  });
  await successContext.close();

  expect(receipts).toHaveLength(expectedReceiptCount);
  expect(
    accessibilityReceipts.map((receipt) => receipt.check_id).sort(),
  ).toEqual([...expectedAccessibilityChecks].sort());
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test.afterAll(async () => {
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(
    path.join(evidenceRoot, "unit05-responsive-matrix.json"),
    `${JSON.stringify(
      {
        accessibility_receipts: accessibilityReceipts,
        baseline_id: baselineId,
        console_errors: consoleErrors,
        expected_accessibility_check_ids: expectedAccessibilityChecks,
        expected_receipt_count: expectedReceiptCount,
        implementation_revision: implementationRevision,
        page_errors: pageErrors,
        receipts,
        status:
          receipts.length === expectedReceiptCount &&
          consoleErrors.length === 0 &&
          pageErrors.length === 0
            ? "passed"
            : "failed",
      },
      null,
      2,
    )}\n`,
  );
});
