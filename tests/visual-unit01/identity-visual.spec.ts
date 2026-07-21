import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

const viewports = [390, 430, 768, 1280, 1440] as const;
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/visual")
  : path.resolve("test-results/unit01-visual/evidence");
const receipts: Array<Record<string, unknown>> = [];
let visualSuiteFailed = false;

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) {
      throw new Error(`Unsupported computed color: ${color}`);
    }
    const [red, green, blue] = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.afterEach(({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    visualSuiteFailed = true;
  }
});

async function capture(
  page: import("@playwright/test").Page,
  screen: string,
  state: string,
  width: number,
) {
  await page.setViewportSize({ height: width <= 430 ? 844 : 900, width });
  await expect(page.getByRole("main")).toBeVisible();
  const layout = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  const controlContrast = await page.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        foreground: style.color,
        label: button.textContent?.trim() ?? "",
      };
    }),
  );
  const contrast = controlContrast.map((sample) => ({
    ...sample,
    ratio: Number(
      contrastRatio(sample.foreground, sample.background).toFixed(2),
    ),
  }));
  for (const sample of contrast) {
    expect(
      sample.ratio,
      `${sample.label} contrast ${sample.ratio}:1 must meet WCAG AA 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  const fileName = `${screen}-${state}-${width}@2x.png`;
  await mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(evidenceRoot, fileName),
  });
  receipts.push({
    file: `evidence/visual/${fileName}`,
    contrast,
    layout,
    screen,
    state,
    viewport: { deviceScaleFactor: 2, height: width <= 430 ? 844 : 900, width },
  });
}

test.afterAll(async () => {
  await mkdir(evidenceRoot, { recursive: true });
  const status = !visualSuiteFailed && receipts.length === 27 ? "passed" : "failed";
  await writeFile(
    path.join(evidenceRoot, "unit01-responsive-matrix.json"),
    `${JSON.stringify(
      {
        baseline_id: "AVB-UKIEBOOK-AURORA-7B-V2",
        receipts,
        status,
        target_bundle_hash:
          "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d",
        verified_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (status !== "passed") {
    throw new Error(
      `UNIT-01 responsive matrix is incomplete (${receipts.length}/27 receipts)`,
    );
  }
});

test("S-03 Aurora public extension covers default, error, focus and 200% reflow", async ({
  page,
}) => {
  for (const width of viewports) {
    await page.goto("/login?returnTo=%2Fcart");
    await expect(page.getByText("Вхід потрібен для покупки чи публікації")).toBeVisible();
    for (const button of await page.getByRole("button", { name: /Увійти через/u }).all()) {
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await capture(page, "s03", "default", width);

    await page.goto("/login?error=provider_failed&returnTo=%2Fcart");
    await expect(
      page.getByRole("alert").filter({ hasText: "Не вдалося завершити вхід" }),
    ).toBeVisible();
    await capture(page, "s03", "oauth-error", width);
  }

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "UkieBook — головна" })).toBeFocused();
  await capture(page, "s03", "focus", 1280);

  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await expect(page.getByRole("button", { name: "Увійти через Google" })).toBeVisible();
  const reflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(reflow.scrollWidth).toBeLessThanOrEqual(reflow.clientWidth);
  receipts.push({ reflow, screen: "s03", state: "zoom-200", viewport: { width: 1280 } });
});

test("S-17 Aurora Author extension covers default, validation and saved states", async ({
  page,
}) => {
  await page.goto("/login?returnTo=%2Fauthor%2Fprofile&intent=author");
  await page.getByRole("button", { name: "Увійти через Facebook" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3201\/facebook\/authorize/u);
  await page.getByRole("link", { name: "Підтвердити" }).click();
  if (page.url().endsWith("/author/profile")) {
    await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("Візуальний Автор");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page).toHaveURL(
      /\/author\/(?:publish|profile\?saved=1)$/u,
    );
  }

  for (const width of viewports) {
    await page.goto("/author/profile");
    await expect(page.getByRole("heading", { name: "Профіль автора" })).toBeVisible();
    expect(
      (await page.getByRole("button", { name: "Зберегти" }).boundingBox())
        ?.height,
    ).toBeGreaterThanOrEqual(43.99);
    await capture(page, "s17", "default", width);

    await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("x");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page).toHaveURL(/\/author\/profile\?error=too_short&value=x$/u);
    await expect(page.getByText("Ім’я має містити щонайменше 2 символи.")).toBeVisible();
    await expect(page.getByLabel(/Публічне ім’я або псевдонім/u)).toBeFocused();
    await expect(page.getByLabel(/Публічне ім’я або псевдонім/u)).toHaveValue("x");
    await capture(page, "s17", "validation-error", width);

    await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("Візуальний Автор");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page).toHaveURL(/\/author\/profile\?saved=1$/u);
    await expect(page.getByRole("status")).toContainText("Публічне ім’я збережено");
    await capture(page, "s17", "saved", width);
  }
});
