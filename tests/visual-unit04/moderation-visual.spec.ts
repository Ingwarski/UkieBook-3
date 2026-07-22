import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import {
  UNIT04_FIXTURE_IDS,
  UNIT04_FIXTURE_TITLES,
} from "../fixtures/moderation/unit04-fixtures";

const { Client } = pg;
const baselineId = "AVB-UKIEBOOK-AURORA-7B-V3";
const implementationRevision = process.env.UNIT04_IMPLEMENTATION_REVISION;
if (!implementationRevision) {
  throw new Error("UNIT04_IMPLEMENTATION_REVISION is required");
}

const expectedReceiptCount = 50;
const expectedAccessibilityChecks = [
  "s13-keyboard-order-focus-activation",
  "s13-reflow-200",
  "s18-queue-keyboard-list-detail",
  "s18-reason-validation-focus",
  "s18-removal-dialog-focus-trap-return",
  "s18-mobile-list-detail-back",
  "s18-reflow-200",
  "s02-unavailable-reflow-200",
] as const;
const viewportHeights = {
  390: 844,
  430: 932,
  768: 1024,
  1280: 900,
  1440: 1000,
} as const;
type ViewportWidth = keyof typeof viewportHeights;
const coreWidths = [390, 768, 1280] as const;
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/visual")
  : path.resolve("test-results/unit04-visual/evidence/visual");
const receipts: Array<Record<string, unknown>> = [];
const accessibilityReceipts: Array<Record<string, unknown>> = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function contrastRatio(foreground: readonly number[], background: readonly number[]): number {
  const luminance = ([red, green, blue]: readonly number[]) => {
    const channels = [red, green, blue].map((channel) => {
      const value = (channel ?? 0) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function colorChannels(value: string): number[] {
  const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
  return channels?.length === 3 ? channels : [0, 0, 0];
}

async function accessibilitySnapshot(page: Page) {
  const samples = await page.getByRole("main").evaluate((root) => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const label = (element: Element): string => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return element.labels?.[0]?.textContent?.trim() ?? element.getAttribute("aria-label") ?? element.id;
      }
      return element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName;
    };
    const opaqueBackground = (element: Element, includeSelf = true): string => {
      let cursor: Element | null = includeSelf ? element : element.parentElement;
      while (cursor) {
        const color = getComputedStyle(cursor).backgroundColor;
        const alpha = color.match(/[\d.]+/gu)?.[3];
        if (color !== "transparent" && (alpha === undefined || Number(alpha) >= 0.98)) return color;
        cursor = cursor.parentElement;
      }
      return "rgb(255, 247, 243)";
    };
    const heading = Array.from(root.querySelectorAll("h1, h2"))
      .filter(visible)
      .find((element) => Boolean(element.textContent?.trim()));
    const text = heading
      ? [{
          background: opaqueBackground(heading),
          foreground: getComputedStyle(heading).color,
          label: label(heading).replace(/\s+/gu, " ").slice(0, 120),
          logoTextExemption: false,
          threshold: 3,
        }]
      : [];
    const controls = Array.from(
      root.querySelectorAll(
        "input:not([type='hidden']):not([type='file']):not([type='checkbox']), textarea, select",
      ),
    ).filter(visible).map((element) => {
      const style = getComputedStyle(element);
      const outside = opaqueBackground(element, false);
      const borderWidth = Number.parseFloat(style.borderTopWidth);
      return {
        background: outside,
        foreground: borderWidth > 0 ? style.borderTopColor : style.color,
        label: label(element).replace(/\s+/gu, " ").slice(0, 120),
        threshold: 3,
      };
    });
    const placeholders = Array.from(
      root.querySelectorAll("input[placeholder], textarea[placeholder]"),
    ).filter(visible).map((element) => {
      const pseudo = getComputedStyle(element, "::placeholder");
      return {
        background: opaqueBackground(element),
        foreground: pseudo.color,
        label: `${label(element)} placeholder`,
        threshold: 4.5,
      };
    });
    const formControls = Array.from(
      root.querySelectorAll("input:not([type='hidden']), textarea, select"),
    ).filter(visible).map((element) => {
      const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const describedBy = (control.getAttribute("aria-describedby") ?? "")
        .split(/\s+/u)
        .filter(Boolean);
      return {
        describedBy,
        describedByExists: describedBy.every((id) => Boolean(document.getElementById(id))),
        label: label(control).replace(/\s+/gu, " ").slice(0, 120),
        labelCount: (control.labels?.length ?? 0) +
          (control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby") ? 1 : 0),
        type: control instanceof HTMLInputElement ? control.type : control.tagName.toLocaleLowerCase("en-US"),
      };
    });
    const mobileInputs = window.innerWidth <= 430
      ? Array.from(root.querySelectorAll("input:not([type='hidden']), textarea, select"))
          .filter(visible)
          .map((element) => ({
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
            label: label(element).replace(/\s+/gu, " ").slice(0, 120),
          }))
      : [];
    const alerts = Array.from(root.querySelectorAll('[role="alert"]'))
      .filter(visible)
      .map((element) => ({
        label: element.getAttribute("aria-label") ?? element.getAttribute("aria-labelledby") ?? "",
        text: element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 180) ?? "",
      }));
    return { alerts, controls, formControls, mobileInputs, placeholders, text };
  });
  const textContrast = samples.text.map((sample) => ({
    ...sample,
    ratio: rounded(
      contrastRatio(colorChannels(sample.foreground), colorChannels(sample.background)),
    ),
  }));
  for (const sample of textContrast) {
    expect(sample.ratio, `${sample.label} heading contrast`).toBeGreaterThanOrEqual(sample.threshold);
  }
  const controlContrast = samples.controls.map((sample) => ({
    ...sample,
    ratio: rounded(
      contrastRatio(colorChannels(sample.foreground), colorChannels(sample.background)),
    ),
  }));
  for (const sample of controlContrast) {
    expect(sample.ratio, `${sample.label} UI contrast`).toBeGreaterThanOrEqual(sample.threshold);
  }
  const placeholderContrast = samples.placeholders.map((sample) => ({
    ...sample,
    ratio: rounded(
      contrastRatio(colorChannels(sample.foreground), colorChannels(sample.background)),
    ),
  }));
  for (const sample of placeholderContrast) {
    expect(sample.ratio, `${sample.label} contrast`).toBeGreaterThanOrEqual(sample.threshold);
  }
  for (const control of samples.formControls) {
    expect(control.labelCount, `${control.label} must have a semantic label`).toBeGreaterThan(0);
    expect(control.describedByExists, `${control.label} descriptions must resolve`).toBe(true);
  }
  for (const input of samples.mobileInputs) {
    expect(input.fontSize, `${input.label} must not trigger iOS zoom`).toBeGreaterThanOrEqual(16);
  }
  for (const alert of samples.alerts) expect(alert.text).not.toBe("");
  return {
    alerts: samples.alerts,
    controlContrast,
    formControls: samples.formControls,
    mobileInputs: samples.mobileInputs,
    placeholderContrast,
    textContrast,
  };
}

async function settleVisuals(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const images = page.locator("main img:visible");
  if ((await images.count()) > 0) {
    await expect.poll(
      () => images.evaluateAll((elements) => elements.every((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      })),
      { timeout: 30_000 },
    ).toBe(true);
    await images.evaluateAll(async (elements) => {
      await Promise.all(elements.map((element) => (element as HTMLImageElement).decode()));
    });
  }
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function layoutSnapshot(page: Page) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth, "page must not overflow horizontally").toBeLessThanOrEqual(
    layout.clientWidth + 1,
  );
  const covers = page.locator("main img");
  for (let index = 0; index < await covers.count(); index += 1) {
    await expect(covers.nth(index)).toHaveCSS("border-radius", "0px");
  }
  return layout;
}

async function interactiveTargetSnapshot(page: Page) {
  const selector = [
    "a:visible",
    "button:visible",
    "summary:visible",
    "input:visible:not([type='hidden']):not([type='file']):not([type='checkbox'])",
    "select:visible",
    "textarea:visible",
  ].join(", ");
  const targets = page.getByRole("main").locator(selector);
  const measurements: Array<{ height: number; label: string; width: number }> = [];
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    if (!box) continue;
    const label = await target.evaluate((element) => {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return element.labels?.[0]?.textContent?.trim() ?? element.getAttribute("name") ?? element.tagName;
      }
      return element.textContent?.trim() ?? element.tagName;
    });
    const measurement = {
      height: rounded(box.height),
      label: label.replace(/\s+/gu, " ").slice(0, 120),
      width: rounded(box.width),
    };
    expect(
      measurement.height,
      `${measurement.label} touch-target height must be at least 44px`,
    ).toBeGreaterThanOrEqual(43.99);
    expect(
      measurement.width,
      `${measurement.label} touch-target width must be at least 44px`,
    ).toBeGreaterThanOrEqual(43.99);
    measurements.push(measurement);
  }
  expect(measurements.length).toBeGreaterThan(0);
  return measurements;
}

async function capture(
  page: Page,
  screen: "s02" | "s13" | "s18",
  state: string,
  width: ViewportWidth,
): Promise<void> {
  await page.setViewportSize({ height: viewportHeights[width], width });
  await settleVisuals(page);
  const layout = await layoutSnapshot(page);
  const touchTargets = await interactiveTargetSnapshot(page);
  const accessibility = await accessibilitySnapshot(page);
  const fileName = `unit04-${screen}-${state}-${width}.png`;
  await mkdir(evidenceRoot, { recursive: true });
  const absoluteFile = path.join(evidenceRoot, fileName);
  await page.screenshot({ animations: "disabled", fullPage: true, path: absoluteFile });
  const sha256 = createHash("sha256").update(await readFile(absoluteFile)).digest("hex");
  receipts.push({
    accessibility,
    baseline_id: baselineId,
    file: `evidence/visual/${fileName}`,
    implementation_revision: implementationRevision,
    layout,
    screen,
    sha256,
    state,
    touch_targets: touchTargets,
    viewport: { height: viewportHeights[width], width },
  });
}

async function captureWidths(
  page: Page,
  screen: "s02" | "s13" | "s18",
  state: string,
  widths: readonly ViewportWidth[] = coreWidths,
) {
  for (const width of widths) await capture(page, screen, state, width);
}

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
  await page.getByRole("button", {
    name: provider === "facebook" ? "Увійти через Facebook" : "Увійти через Google",
  }).click();
  await approveProvider(page, provider);
  await expect(page).toHaveURL(new RegExp(returnTo.replaceAll("/", "\\/"), "u"));
}

async function tabTo(page: Page, target: Locator, maximum = 50): Promise<string[]> {
  const firstFocusable = page.getByRole("main").locator(
    "a:visible, button:visible, summary:visible, input:visible:not([type='hidden']), select:visible, textarea:visible",
  ).first();
  await firstFocusable.focus();
  const sequence: string[] = [];
  for (let index = 0; index <= maximum; index += 1) {
    sequence.push(await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return "";
      return `${active.tagName.toLocaleLowerCase("en-US")}:${active.getAttribute("aria-label") ?? active.textContent?.trim().replace(/\s+/gu, " ").slice(0, 100) ?? ""}`;
    }));
    if (await target.evaluate((element) => document.activeElement === element)) return sequence;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard target was not reached: ${JSON.stringify(sequence)}`);
}

async function focusAppearance(locator: Locator) {
  const appearance = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      height: box.height,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      width: box.width,
    };
  });
  expect(await locator.evaluate((element) => document.activeElement === element)).toBe(true);
  expect(appearance.outlineStyle).not.toBe("none");
  expect(appearance.outlineWidth).toBeGreaterThanOrEqual(2);
  return appearance;
}

async function reflow200(
  page: Page,
  check: "s02-unavailable-reflow-200" | "s13-reflow-200" | "s18-reflow-200",
  essentials: readonly Locator[],
) {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
    window.scrollTo(0, 0);
  });
  await settleVisuals(page);
  const layout = await layoutSnapshot(page);
  const controls: Array<Record<string, unknown>> = [];
  for (const essential of essentials) {
    await expect(essential).toBeVisible();
    await essential.scrollIntoViewIfNeeded();
    const box = await essential.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(layout.clientWidth + 1);
    controls.push({
      height: rounded(box!.height),
      label: (await essential.getAttribute("aria-label")) ?? (await essential.textContent())?.trim().slice(0, 120),
      left: rounded(box!.x),
      width: rounded(box!.width),
    });
  }
  accessibilityReceipts.push({
    check,
    controls,
    implementation_revision: implementationRevision,
    layout,
    zoom: 2,
  });
  await page.evaluate(() => {
    document.body.style.zoom = "";
    window.scrollTo(0, 0);
  });
}

async function emptyModerationQueue(): Promise<void> {
  const databaseUrl = process.env.UNIT04_DATABASE_URL;
  if (!databaseUrl) throw new Error("UNIT04_DATABASE_URL is required");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `
        UPDATE moderation_cases
        SET status = 'approved', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::uuid[]) AND status = 'manual_review_pending'
      `,
      [Object.values(UNIT04_FIXTURE_IDS.cases)],
    );
  } finally {
    await client.end();
  }
}

test("captures the complete UNIT-04 responsive and accessibility matrix", async ({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await signIn(page, "author");
  const authorStates = [
    ["submitted", "submitted"],
    ["manual", "manual-review"],
    ["rejected", "rejected"],
    ["published", "published"],
    ["removed", "removed"],
  ] as const;
  for (const [fixture, state] of authorStates) {
    await page.goto(`/author/books/${UNIT04_FIXTURE_IDS.books[fixture]}`);
    await expect(page.getByRole("heading", { name: UNIT04_FIXTURE_TITLES[fixture], level: 1 })).toBeVisible();
    await captureWidths(page, "s13", state);
    if (state === "published") await captureWidths(page, "s13", state, [430, 1440]);
  }

  await page.goto(`/author/books/${UNIT04_FIXTURE_IDS.books.published}`);
  await page.setViewportSize({ height: 900, width: 1280 });
  const publicLink = page.getByRole("link", { name: "Переглянути сторінку книжки" });
  const authorSequence = await tabTo(page, publicLink);
  const authorFocus = await focusAppearance(publicLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/books/${UNIT04_FIXTURE_IDS.books.published}$`, "u"));
  accessibilityReceipts.push({
    activation: "enter",
    check: "s13-keyboard-order-focus-activation",
    focus: authorFocus,
    implementation_revision: implementationRevision,
    sequence: authorSequence,
  });
  await page.goto(`/author/books/${UNIT04_FIXTURE_IDS.books.published}`);
  await reflow200(page, "s13-reflow-200", [
    page.getByRole("heading", { name: UNIT04_FIXTURE_TITLES.published, level: 1 }),
    page.getByRole("link", { name: "Переглянути сторінку книжки" }),
  ]);

  await page.context().clearCookies();
  await signIn(page, "manager");
  await page.goto("/admin/moderation");
  await captureWidths(page, "s18", "mixed-queue", [390, 430, 768, 1280, 1440]);

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/moderation");
  const updateQueueLink = page.locator(`a[href*="case=${UNIT04_FIXTURE_IDS.cases.update}"]`).first();
  const queueSequence = await tabTo(page, updateQueueLink);
  const queueFocus = await focusAppearance(updateQueueLink);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: UNIT04_FIXTURE_TITLES.update, level: 2 })).toBeVisible();
  accessibilityReceipts.push({
    activation: "enter",
    check: "s18-queue-keyboard-list-detail",
    focus: queueFocus,
    implementation_revision: implementationRevision,
    sequence: queueSequence,
  });

  const managerStates = [
    [UNIT04_FIXTURE_IDS.cases.manual, UNIT04_FIXTURE_TITLES.manual, "book-selected"],
    [UNIT04_FIXTURE_IDS.cases.update, UNIT04_FIXTURE_TITLES.update, "book-update-selected"],
    [UNIT04_FIXTURE_IDS.cases.review, UNIT04_FIXTURE_TITLES.review, "review-selected"],
    [UNIT04_FIXTURE_IDS.cases.providerError, UNIT04_FIXTURE_TITLES.providerError, "ai-unavailable"],
  ] as const;
  for (const [caseId, title, state] of managerStates) {
    await page.goto(`/admin/moderation?case=${caseId}`);
    await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
    await captureWidths(page, "s18", state);
  }

  await page.goto(
    `/admin/moderation?case=${UNIT04_FIXTURE_IDS.cases.manual}&decision=reject_publication&error=reason_required`,
  );
  const category = page.getByLabel("Категорія причини");
  await expect(category).toBeFocused();
  await expect(category).toHaveAttribute("aria-invalid", "true");
  accessibilityReceipts.push({
    check: "s18-reason-validation-focus",
    entry_state: "server-validated reason_required",
    focused_label: "Категорія причини",
    implementation_revision: implementationRevision,
    invalid: (await category.getAttribute("aria-invalid")) === "true",
  });
  await captureWidths(page, "s18", "category-error");

  await page.goto(`/admin/moderation?case=${UNIT04_FIXTURE_IDS.cases.removal}`);
  const removalTrigger = page.getByRole("button", { name: "Прибрати з Каталогу" });
  await removalTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Прибрати книжку з Каталогу?" });
  const ground = dialog.getByLabel("Підстава");
  await expect(ground).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(removalTrigger).toBeFocused();
  accessibilityReceipts.push({
    check: "s18-removal-dialog-focus-trap-return",
    focus_returned: true,
    implementation_revision: implementationRevision,
    initial_focus: "Підстава",
    trapped: true,
  });
  await removalTrigger.click();
  await captureWidths(page, "s18", "removal-dialog", [390, 430, 768, 1280, 1440]);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/admin/moderation");
  await page.locator(`a[href*="case=${UNIT04_FIXTURE_IDS.cases.review}"]`).first().click();
  await expect(page.getByRole("heading", { name: UNIT04_FIXTURE_TITLES.review, level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "До черги" }).click();
  await expect(page.getByRole("region", { name: "Ризикові випадки" })).toBeVisible();
  accessibilityReceipts.push({
    back_control: "До черги",
    check: "s18-mobile-list-detail-back",
    detail_visible: true,
    implementation_revision: implementationRevision,
    list_restored: true,
    viewport: 390,
  });

  await page.goto(`/admin/moderation?case=${UNIT04_FIXTURE_IDS.cases.manual}`);
  await reflow200(page, "s18-reflow-200", [
    page.getByRole("heading", { name: "Ручна перевірка", level: 1 }),
    page.getByLabel("Тип випадку"),
    page.getByRole("button", { name: "Схвалити й опублікувати" }),
  ]);

  await emptyModerationQueue();
  await page.goto("/admin/moderation");
  await expect(page.getByRole("heading", { name: "Все перевірено" })).toBeVisible();
  await captureWidths(page, "s18", "empty");

  await page.context().clearCookies();
  await page.goto(`/books/${UNIT04_FIXTURE_IDS.books.removed}`);
  await expect(page.getByText("Книжка недоступна", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Додати в кошик" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Читати фрагмент" })).toHaveCount(0);
  await captureWidths(page, "s02", "unavailable-after-removal", [390, 430, 768, 1280, 1440]);
  await reflow200(page, "s02-unavailable-reflow-200", [
    page.getByRole("heading", { name: UNIT04_FIXTURE_TITLES.removed, level: 1 }),
    page.getByText("Книжка недоступна", { exact: true }),
  ]);

  expect(receipts).toHaveLength(expectedReceiptCount);
  expect(accessibilityReceipts.map(({ check }) => check).sort()).toEqual(
    [...expectedAccessibilityChecks].sort(),
  );
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await writeFile(
    path.join(evidenceRoot, "unit04-responsive-matrix.json"),
    `${JSON.stringify({
      accessibility_receipts: accessibilityReceipts,
      baseline_id: baselineId,
      console_errors: consoleErrors,
      expected_accessibility_checks: expectedAccessibilityChecks,
      expected_receipts: expectedReceiptCount,
      implementation_revision: implementationRevision,
      page_errors: pageErrors,
      receipts,
      status: "passed",
    }, null, 2)}\n`,
    "utf8",
  );
});
