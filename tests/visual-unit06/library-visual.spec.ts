import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { UNIT06_FIXTURE_BOOK, UNIT06_FIXTURE_IDS } from "../fixtures/library/unit06-fixtures";

const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const implementationRevision = process.env.UNIT06_IMPLEMENTATION_REVISION;
if (!implementationRevision) throw new Error("UNIT06_IMPLEMENTATION_REVISION is required");
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/visual")
  : path.resolve("test-results/unit06-visual/evidence/visual");
const viewportHeights = { 390: 844, 768: 1024, 1280: 900 } as const;
type ViewportWidth = keyof typeof viewportHeights;
const widths = [390, 768, 1280] as const;
const receipts: Array<Record<string, unknown>> = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

async function approveProvider(page: Page, provider: "facebook" | "google") {
  await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:3232/${provider}/authorize`, "u"));
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

function observe(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function capture(page: Page, screen: "s07" | "s08" | "s09" | "s20", state: string, width: ViewportWidth) {
  await page.setViewportSize({ width, height: viewportHeights[width] });
  await settle(page);
  const audit = await page.getByRole("main").evaluate((main) => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const controls = Array.from(main.querySelectorAll("button, textarea, select, input:not([type='hidden'])"))
      .filter(visible)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        return {
          height: Number(box.height.toFixed(2)),
          labelCount: (control.labels?.length ?? 0) + (element.hasAttribute("aria-label") ? 1 : 0),
          tag: element.tagName.toLowerCase(),
          width: Number(box.width.toFixed(2)),
        };
      });
    return {
      clientWidth: document.documentElement.clientWidth,
      controls,
      mainCount: document.querySelectorAll("main").length,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(audit.mainCount).toBe(1);
  expect(audit.scrollWidth).toBeLessThanOrEqual(audit.clientWidth + 1);
  for (const control of audit.controls) {
    expect(control.height).toBeGreaterThanOrEqual(43.9);
    if (control.tag !== "button") expect(control.labelCount).toBeGreaterThan(0);
  }
  await mkdir(evidenceRoot, { recursive: true });
  const fileName = `unit06-${screen}-${state}-${width}.png`;
  const absolute = path.join(evidenceRoot, fileName);
  await page.screenshot({ animations: "disabled", fullPage: true, path: absolute });
  receipts.push({
    accessibility: { controls: audit.controls, semantic_main: "passed" },
    baseline_id: baselineId,
    file: `evidence/visual/${fileName}`,
    implementation_revision: implementationRevision,
    layout: { clientWidth: audit.clientWidth, scrollWidth: audit.scrollWidth },
    screen,
    sha256: createHash("sha256").update(await readFile(absolute)).digest("hex"),
    state,
    viewport: { device_scale_factor: 2, height: viewportHeights[width], width },
  });
}

async function captureWidths(page: Page, screen: "s07" | "s08" | "s09" | "s20", state: string) {
  for (const width of widths) await capture(page, screen, state, width);
}

async function managerContext(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  observe(page);
  await signIn(page, "facebook", "/admin/refunds");
  return page;
}

test("S-07, S-08, S-09 and S-20 retain the approved Aurora system at 390/768/1280", async ({ browser, page }) => {
  observe(page);
  await signIn(page, "google", "/library");
  await expect(page.getByRole("heading", { level: 2, name: UNIT06_FIXTURE_BOOK.title })).toBeVisible();
  await captureWidths(page, "s07", "buyer-library",);

  await page.goto(`/books/${UNIT06_FIXTURE_IDS.bookId}#reviews`);
  await expect(page.getByText("Ваш підтверджений відгук", { exact: true })).toBeVisible();
  await captureWidths(page, "s08", "verified-review-form");

  await page.goto("/library");
  await page.getByRole("button", { name: "Запит на повернення" }).click();
  const dialog = page.getByRole("dialog", { name: "Поясніть причину" });
  await expect(dialog).toBeVisible();
  await captureWidths(page, "s09", "refund-dialog");
  await dialog.getByLabel("Причина повернення").fill("Файл не підходить для мого пристрою читання.");
  await dialog.getByRole("button", { name: "Надіслати заявку" }).click();
  await expect(page.getByRole("status")).toContainText("Заявку на повернення надіслано");

  const context = await browser.newContext({ baseURL: process.env.UNIT06_APP_ORIGIN });
  try {
    const managerPage = await managerContext(context);
    await expect(managerPage.getByRole("heading", { level: 1, name: "Повернення" })).toBeVisible();
    await expect(managerPage.getByRole("heading", { level: 2, name: UNIT06_FIXTURE_BOOK.title })).toBeVisible();
    await captureWidths(managerPage, "s20", "manager-refund-queue");
  } finally {
    await context.close();
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  const matrix = {
    baseline_id: baselineId,
    console_errors: consoleErrors,
    expected_receipt_count: 12,
    implementation_revision: implementationRevision,
    page_errors: pageErrors,
    receipts,
    status: receipts.length === 12 ? "passed" : "failed",
    verified_at: new Date().toISOString(),
  };
  await writeFile(path.join(evidenceRoot, "unit06-responsive-matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
  expect(receipts).toHaveLength(12);
});
