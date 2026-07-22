import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  docxBytesFixture,
} from "../fixtures/publishing/conversion-fixtures";

const implementationRevision = process.env.UNIT03_IMPLEMENTATION_REVISION;
if (!implementationRevision) throw new Error("UNIT03_IMPLEMENTATION_REVISION is required");

const viewports = [390, 430, 768, 1280, 1440] as const;
const viewportHeights: Record<(typeof viewports)[number], number> = {
  390: 844,
  430: 932,
  768: 1024,
  1280: 900,
  1440: 1000,
};
const expectedReceiptCount = 30;
const expectedAccessibilityChecks = [
  "s10-keyboard-order-focus-activation",
  "s10-reflow-200",
  "s11-file-input-focus-proxy",
  "s11-keyboard-activation",
  "s11-reflow-200",
  "s12-tab-keyboard-activation",
  "s12-reflow-200",
] as const;
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/visual")
  : path.resolve("test-results/unit03-visual/evidence/visual");
const receipts: Array<Record<string, unknown>> = [];
const accessibilityReceipts: Array<Record<string, unknown>> = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
let visualSuiteFailed = false;

interface CaptureOptions {
  readonly covers?: Locator;
  readonly minimumCoverCount?: number;
  readonly mobilePreview?: Locator;
  readonly screen: "s10" | "s11" | "s12";
  readonly state: string;
  readonly width: (typeof viewports)[number];
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

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

async function computedAccessibility(page: Page) {
  const samples = await page.getByRole("main").evaluate((root) => {
    type Color = [number, number, number, number];
    const parseColor = (value: string): Color | null => {
      const channels = value.match(/[\d.]+/gu)?.map(Number);
      if (!channels || channels.length < 3) return null;
      const normalized = value.trim().startsWith("color(srgb");
      const scale = normalized ? 255 : 1;
      return [
        channels[0]! * scale,
        channels[1]! * scale,
        channels[2]! * scale,
        channels[3] ?? 1,
      ];
    };
    const over = (top: Color, bottom: Color): Color => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    };
    const css = (color: Color): string =>
      `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])})`;
    const effectiveBackground = (element: Element, includeSelf = true): string => {
      let combined: Color = [0, 0, 0, 0];
      let cursor: Element | null = includeSelf ? element : element.parentElement;
      while (cursor) {
        const parsed = parseColor(getComputedStyle(cursor).backgroundColor);
        if (parsed) combined = over(combined, parsed);
        if (combined[3] >= 0.999) break;
        cursor = cursor.parentElement;
      }
      return css(over(combined, [255, 255, 255, 1]));
    };
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };
    const label = (element: Element): string => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return element.labels?.[0]?.textContent?.trim() ?? element.getAttribute("aria-label") ?? element.id;
      }
      return element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName;
    };

    const text = Array.from(
      root.querySelectorAll("h1, h2, h3, p, li, label, strong, a, button, summary"),
    )
      .filter(visible)
      .filter((element) => !(element.closest("button:disabled, [aria-disabled='true']")))
      .filter((element) => Boolean(element.textContent?.trim()))
      .map((element) => {
        const style = getComputedStyle(element);
        const background = effectiveBackground(element);
        const foregroundColor = parseColor(style.color) ?? [0, 0, 0, 1];
        const backgroundColor = parseColor(background) ?? [255, 255, 255, 1];
        const foreground = css(over(foregroundColor, backgroundColor));
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const logoTextExemption = Boolean(
          element.matches("strong") && element.closest('a[aria-label="UkieBook — головна"]'),
        );
        return {
          background,
          fontSize,
          fontWeight,
          foreground,
          label: label(element).replace(/\s+/gu, " ").slice(0, 120),
          logoTextExemption,
          threshold: large ? 3 : 4.5,
        };
      });

    const controls = Array.from(
      root.querySelectorAll(
        "input:not([type='hidden']):not([type='file']):not([type='checkbox']), textarea, select, button[aria-selected='true'], button[aria-pressed='true']",
      ),
    )
      .filter(visible)
      .filter((element) => !(element instanceof HTMLButtonElement && element.disabled))
      .map((element) => {
        const style = getComputedStyle(element);
        const outside = effectiveBackground(element, false);
        const borderWidth = Number.parseFloat(style.borderTopWidth);
        const borderColor = parseColor(style.borderTopColor);
        const fillColor = parseColor(style.backgroundColor);
        const candidate =
          borderWidth > 0 && borderColor && borderColor[3] > 0
            ? css(over(borderColor, parseColor(outside) ?? [255, 255, 255, 1]))
            : fillColor
              ? css(over(fillColor, parseColor(outside) ?? [255, 255, 255, 1]))
              : style.color;
        return {
          background: outside,
          foreground: candidate,
          label: label(element).replace(/\s+/gu, " ").slice(0, 120),
          threshold: 3,
        };
      });

    const placeholders = Array.from(
      root.querySelectorAll("input[placeholder], textarea[placeholder]"),
    )
      .filter(visible)
      .map((element) => {
        const pseudo = getComputedStyle(element, "::placeholder");
        const background = effectiveBackground(element);
        const foregroundColor = parseColor(pseudo.color) ?? [0, 0, 0, 1];
        const backgroundColor = parseColor(background) ?? [255, 255, 255, 1];
        foregroundColor[3] *= Number.parseFloat(pseudo.opacity) || 1;
        return {
          background,
          foreground: css(over(foregroundColor, backgroundColor)),
          label: `${label(element)} placeholder`,
          threshold: 4.5,
        };
      });

    const formControls = Array.from(
      root.querySelectorAll("input:not([type='hidden']), textarea, select"),
    ).map((element) => {
      const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const describedBy = (control.getAttribute("aria-describedby") ?? "")
        .split(/\s+/u)
        .filter(Boolean);
      return {
        describedBy,
        describedByExists: describedBy.every((id) => Boolean(document.getElementById(id))),
        label: label(control).replace(/\s+/gu, " ").slice(0, 120),
        labelCount: control.labels?.length ?? 0,
        type: control instanceof HTMLInputElement ? control.type : control.tagName.toLocaleLowerCase("en-US"),
      };
    });

    const mobileInputs = Array.from(
      root.querySelectorAll(
        "input:not([type='hidden']):not([type='file']):not([type='checkbox']), textarea, select",
      ),
    )
      .filter(visible)
      .map((element) => ({
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        label: label(element).replace(/\s+/gu, " ").slice(0, 120),
      }));
    const alerts = Array.from(root.querySelectorAll('[role="alert"]'))
      .filter(visible)
      .map((element) => ({
        label: element.getAttribute("aria-labelledby") ?? element.getAttribute("aria-label") ?? "",
        text: element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 180) ?? "",
      }));
    return { alerts, controls, formControls, mobileInputs, placeholders, text };
  });

  const textContrast = samples.text.map((sample) => ({
    ...sample,
    ratio: rounded(contrastRatio(sample.foreground, sample.background)),
  }));
  for (const sample of textContrast) {
    if (sample.logoTextExemption) continue;
    expect(
      sample.ratio,
      `${sample.label} computed text contrast ${sample.ratio}:1 must meet ${sample.threshold}:1`,
    ).toBeGreaterThanOrEqual(sample.threshold);
  }
  const controlContrast = samples.controls.map((sample) => ({
    ...sample,
    ratio: rounded(contrastRatio(sample.foreground, sample.background)),
  }));
  for (const sample of controlContrast) {
    expect(
      sample.ratio,
      `${sample.label} computed UI contrast ${sample.ratio}:1 must meet 3:1`,
    ).toBeGreaterThanOrEqual(3);
  }
  const placeholderContrast = samples.placeholders.map((sample) => ({
    ...sample,
    ratio: rounded(contrastRatio(sample.foreground, sample.background)),
  }));
  for (const sample of placeholderContrast) {
    expect(
      sample.ratio,
      `${sample.label} contrast ${sample.ratio}:1 must meet 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  for (const control of samples.formControls) {
    expect(control.labelCount, `${control.type} must have a persistent semantic label`).toBeGreaterThan(0);
    expect(control.describedByExists, `${control.label} aria-describedby references must exist`).toBe(true);
  }
  for (const alert of samples.alerts) {
    expect(alert.text, "semantic error must contain persistent text").not.toBe("");
  }
  return {
    alerts: samples.alerts,
    controlContrast,
    formControls: samples.formControls,
    mobileInputs: samples.mobileInputs,
    placeholderContrast,
    textContrast,
  };
}

async function resetKeyboardOrigin(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.tabIndex = -1;
    document.documentElement.focus();
  });
}

async function tabToTarget(page: Page, target: Locator, maximumTabs = 40) {
  await resetKeyboardOrigin(page);
  const sequence: string[] = [];
  for (let step = 0; step < maximumTabs; step += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return { label: "", tag: "" };
      let label = element.getAttribute("aria-label") ?? "";
      if (!label && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
        label = element.labels?.[0]?.textContent?.trim() ?? element.name;
      }
      if (!label) label = element.textContent?.trim() ?? "";
      return {
        label: label.replace(/\s+/gu, " ").slice(0, 120),
        tag: element.tagName.toLocaleLowerCase("en-US"),
      };
    });
    sequence.push(`${active.tag}:${active.label}`);
    if (await target.evaluate((element) => document.activeElement === element)) {
      return sequence;
    }
  }
  throw new Error(`Keyboard target was not reached after ${maximumTabs} Tab presses`);
}

async function assertVisibleFocus(target: Locator, proxy: Locator = target) {
  const [targetFocused, appearance] = await Promise.all([
    target.evaluate((element) => document.activeElement === element),
    proxy.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        height: box.height,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        width: box.width,
      };
    }),
  ]);
  expect(targetFocused, "keyboard target must own focus").toBe(true);
  expect(appearance.outlineStyle, "focus indicator must be visible").not.toBe("none");
  expect(appearance.outlineWidth, "focus indicator must be at least 3 CSS px").toBeGreaterThanOrEqual(3);
  expect(appearance.width, "focus proxy must be visibly rendered").toBeGreaterThanOrEqual(44);
  expect(appearance.height, "focus proxy must be visibly rendered").toBeGreaterThanOrEqual(44);
  return {
    height: rounded(appearance.height),
    outlineColor: appearance.outlineColor,
    outlineStyle: appearance.outlineStyle,
    outlineWidth: appearance.outlineWidth,
    width: rounded(appearance.width),
  };
}

function isOrderedSubsequence(sequence: readonly string[], expected: readonly string[]): boolean {
  let expectedIndex = 0;
  for (const item of sequence) {
    if (item.includes(expected[expectedIndex] ?? "\u0000")) expectedIndex += 1;
  }
  return expectedIndex === expected.length;
}

async function assertReflow200(
  page: Page,
  screen: "s10" | "s11" | "s12",
  essentialControls: readonly Locator[],
) {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const layout = await assertNoHorizontalOverflow(page);
  const essentials: Array<Record<string, unknown>> = [];
  for (const control of essentialControls) {
    await expect(control).toBeVisible();
    await control.scrollIntoViewIfNeeded();
    const sample = await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const pointX = Math.min(window.innerWidth - 1, Math.max(0, box.left + Math.min(box.width / 2, 20)));
      const pointY = Math.min(window.innerHeight - 1, Math.max(0, box.top + Math.min(box.height / 2, 20)));
      const hit = document.elementFromPoint(pointX, pointY);
      return {
        bottom: box.bottom,
        height: box.height,
        hitTestable: Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element))),
        label: element.getAttribute("aria-label") ?? element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 120) ?? element.tagName,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
      };
    });
    expect(sample.left, `${sample.label} must not be clipped left at 200%`).toBeGreaterThanOrEqual(-0.5);
    expect(sample.right, `${sample.label} must reflow within the 200% viewport`).toBeLessThanOrEqual(layout.clientWidth + 0.5);
    expect(sample.hitTestable, `${sample.label} must remain hit-testable at 200%`).toBe(true);
    essentials.push({
      ...sample,
      bottom: rounded(sample.bottom),
      height: rounded(sample.height),
      left: rounded(sample.left),
      right: rounded(sample.right),
      top: rounded(sample.top),
      width: rounded(sample.width),
    });
  }
  accessibilityReceipts.push({
    check: `${screen}-reflow-200`,
    essentials,
    implementation_revision: implementationRevision,
    layout,
    screen,
    zoom: 2,
  });
  await page.evaluate(() => {
    document.body.style.zoom = "";
    window.scrollTo(0, 0);
  });
}

async function waitForImages(page: Page): Promise<void> {
  const images = page.locator("img");
  await expect
    .poll(
      () =>
        images.evaluateAll((elements) =>
          elements.every(
            (element) =>
              (element as HTMLImageElement).complete &&
              (element as HTMLImageElement).naturalWidth > 0,
          ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await images.evaluateAll(async (elements) => {
    await Promise.all(elements.map((element) => (element as HTMLImageElement).decode()));
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth, "page must not overflow horizontally").toBeLessThanOrEqual(
    layout.clientWidth,
  );
  return layout;
}

async function assertInteractiveTargets(root: Locator) {
  const selector = [
    "a:visible",
    "button:visible",
    "summary:visible",
    'input:visible:not([type="hidden"]):not([type="file"]):not([type="checkbox"])',
    "select:visible",
    "textarea:visible",
    'input[type="file"] + label:visible',
    'label:visible:has(input[type="checkbox"])',
  ].join(", ");
  const targets = root.locator(selector);
  const measurements: Array<{ height: number; label: string; width: number }> = [];
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    if (!box) continue;
    const label = await target.evaluate((element) => {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        return element.labels?.[0]?.textContent?.trim() ?? element.name ?? element.tagName;
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

async function assertCoverGeometry(covers: Locator, minimumCount: number) {
  const count = await covers.count();
  expect(count, "expected rendered book covers").toBeGreaterThanOrEqual(minimumCount);
  const geometry: Array<Record<string, unknown>> = [];
  for (let index = 0; index < count; index += 1) {
    const cover = covers.nth(index);
    await expect(cover).toBeVisible();
    await expect
      .poll(() =>
        cover.evaluate(
          (element) =>
            (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    const sample = await cover.evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return {
        alt: image.alt,
        borderRadii: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ],
        height: box.height,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        width: box.width,
      };
    });
    expect(sample.naturalWidth).toBeGreaterThan(0);
    expect(sample.naturalHeight).toBeGreaterThan(0);
    expect(Math.abs(sample.naturalWidth / sample.naturalHeight - 2 / 3)).toBeLessThanOrEqual(
      0.01,
    );
    expect(Math.abs(sample.width / sample.height - 2 / 3)).toBeLessThanOrEqual(0.01);
    expect(sample.borderRadii).toEqual(["0px", "0px", "0px", "0px"]);
    geometry.push({
      ...sample,
      height: rounded(sample.height),
      width: rounded(sample.width),
    });
  }
  return geometry;
}

async function capture(page: Page, options: CaptureOptions): Promise<void> {
  const height = viewportHeights[options.width];
  await page.setViewportSize({ height, width: options.width });
  await expect(page.getByRole("main")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await waitForImages(page);
  const layout = await assertNoHorizontalOverflow(page);
  const touchTargets = await assertInteractiveTargets(page.getByRole("main"));
  const accessibility = await computedAccessibility(page);
  if (options.width <= 430) {
    for (const input of accessibility.mobileInputs) {
      expect(
        input.fontSize,
        `${input.label} mobile input text must be at least 16 CSS px`,
      ).toBeGreaterThanOrEqual(16);
    }
  }
  const coverGeometry = options.covers
    ? await assertCoverGeometry(options.covers, options.minimumCoverCount ?? 1)
    : [];
  let mobilePreview: Record<string, unknown> | undefined;
  if (options.mobilePreview) {
    const box = await options.mobilePreview.boundingBox();
    expect(box).not.toBeNull();
    const maximumWidth = Math.min(430, layout.clientWidth);
    expect(box!.width, "mobile preview must fit its 430px cap and viewport").toBeLessThanOrEqual(
      maximumWidth + 0.5,
    );
    const internalLayout = await options.mobilePreview.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(
      internalLayout.scrollWidth,
      "mobile preview content must not overflow its frame horizontally",
    ).toBeLessThanOrEqual(internalLayout.clientWidth + 1);
    let coverTitleOverlap: Record<string, number> | undefined;
    if (options.covers && (await options.covers.count()) > 0) {
      const title = options.mobilePreview.getByRole("heading", { level: 2 }).first();
      const [coverBox, titleBox] = await Promise.all([
        options.covers.first().boundingBox(),
        title.boundingBox(),
      ]);
      expect(coverBox).not.toBeNull();
      expect(titleBox).not.toBeNull();
      const overlapWidth = Math.max(
        0,
        Math.min(coverBox!.x + coverBox!.width, titleBox!.x + titleBox!.width) -
          Math.max(coverBox!.x, titleBox!.x),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(coverBox!.y + coverBox!.height, titleBox!.y + titleBox!.height) -
          Math.max(coverBox!.y, titleBox!.y),
      );
      const overlapArea = rounded(overlapWidth * overlapHeight);
      expect(overlapArea, "mobile preview cover must not overlap its title").toBe(0);
      coverTitleOverlap = {
        area: overlapArea,
        height: rounded(overlapHeight),
        width: rounded(overlapWidth),
      };
    }
    mobilePreview = {
      coverTitleOverlap,
      height: rounded(box!.height),
      internalLayout,
      maximumWidth,
      width: rounded(box!.width),
    };
  }

  await mkdir(evidenceRoot, { recursive: true });
  const fileName = `${options.screen}-${options.state}-${options.width}@2x.png`;
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(evidenceRoot, fileName),
  });
  receipts.push({
    accessibility,
    console_error_count: consoleErrors.length,
    cover_geometry: coverGeometry,
    file: `evidence/visual/${fileName}`,
    layout,
    mobile_preview: mobilePreview,
    page_error_count: pageErrors.length,
    screen: options.screen,
    sha256: createHash("sha256").update(screenshot).digest("hex"),
    state: options.state,
    touch_targets: touchTargets,
    viewport: { deviceScaleFactor: 2, height, width: options.width },
  });
}

async function signInAuthor(page: Page): Promise<void> {
  await page.goto("/login?returnTo=%2Fauthor%2Fbooks&intent=author");
  await page.getByRole("button", { name: "Увійти через Google" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3204\/google\/authorize/u);
  await page.getByRole("link", { name: "Підтвердити" }).click();
  await expect(page).toHaveURL(/\/author\/(?:books|profile|publish)/u, { timeout: 15_000 });
  if (page.url().includes("/author/profile")) {
    await page.getByLabel(/Публічне ім’я або псевдонім/u).fill("Олена Вітрова");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page).toHaveURL(/\/author\/(?:profile\?saved=1|publish)/u);
  }
  await page.goto("/author/books");
  await expect(page.getByRole("heading", { name: "Мої книжки" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Опублікувати нову книжку/u }).first(),
  ).toBeVisible();
}

test.afterEach(({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) visualSuiteFailed = true;
});

test.afterAll(async () => {
  await mkdir(evidenceRoot, { recursive: true });
  const completedAccessibilityChecks = accessibilityReceipts
    .map((receipt) => String(receipt.check))
    .sort();
  const requiredAccessibilityChecks = [...expectedAccessibilityChecks].sort();
  const status =
    !visualSuiteFailed &&
    receipts.length === expectedReceiptCount &&
    JSON.stringify(completedAccessibilityChecks) === JSON.stringify(requiredAccessibilityChecks) &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0
      ? "passed"
      : "failed";
  await writeFile(
    path.join(evidenceRoot, "unit03-responsive-matrix.json"),
    `${JSON.stringify(
      {
        accessibility_receipts: accessibilityReceipts,
        baseline_id: "AVB-UKIEBOOK-AURORA-7B-V3",
        console_errors: consoleErrors,
        expected_receipts: expectedReceiptCount,
        expected_accessibility_checks: expectedAccessibilityChecks,
        implementation_revision: implementationRevision,
        page_errors: pageErrors,
        receipts,
        status,
        verified_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (status !== "passed") {
    throw new Error(
      `UNIT-03 visual matrix failed: ${receipts.length}/${expectedReceiptCount} receipts, ${accessibilityReceipts.length}/${expectedAccessibilityChecks.length} accessibility checks, ${consoleErrors.length} console errors, ${pageErrors.length} page errors`,
    );
  }
});

test("S-10/S-11/S-12 responsive author publishing flow", async ({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`${message.location().url || page.url()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(`${page.url()}: ${error.message}`));

  await signInAuthor(page);

  for (const width of viewports) {
    await capture(page, {
      covers: page.getByRole("img", { name: /— обкладинка$/u }),
      minimumCoverCount: 0,
      screen: "s10",
      state: "books-default",
      width,
    });
  }

  await assertReflow200(page, "s10", [
    page.getByRole("heading", { name: "Мої книжки" }),
    page.getByRole("button", { name: /Опублікувати нову книжку/u }).first(),
  ]);

  const continueDraft = page.getByRole("link", { name: "Продовжити" }).first();
  const startPublishing = (await continueDraft.isVisible())
    ? continueDraft
    : page.getByRole("button", { name: /Опублікувати нову книжку/u }).first();
  const s10Order = await tabToTarget(page, startPublishing);
  const expectedS10Order = [
    "UkieBook — головна",
    "Мої книжки",
    "Профіль",
    "До каталогу",
    "Вийти",
    "Опублікувати нову книжку",
    ...(await continueDraft.isVisible() ? ["Продовжити"] : []),
  ];
  expect(
    isOrderedSubsequence(s10Order, expectedS10Order),
    "S-10 keyboard order must follow header then primary workspace actions",
  ).toBe(true);
  const s10Focus = await assertVisibleFocus(startPublishing);
  accessibilityReceipts.push({
    activation_key: "Enter",
    check: "s10-keyboard-order-focus-activation",
    focus: s10Focus,
    implementation_revision: implementationRevision,
    order: s10Order,
    screen: "s10",
  });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Завантажте рукопис" })).toBeVisible();

  for (const width of viewports) {
    await capture(page, { screen: "s11", state: "manuscript", width });
  }

  const manuscriptInput = page.locator('input[type="file"]').first();
  const uploadFocusProxy = manuscriptInput.locator("xpath=following-sibling::label[1]");
  await assertReflow200(page, "s11", [
    page.getByRole("heading", { name: "Завантажте рукопис" }),
    uploadFocusProxy,
    page.getByLabel("Посилання Google Docs"),
  ]);
  const fileInputOrder = await tabToTarget(page, manuscriptInput);
  const fileInputFocus = await assertVisibleFocus(manuscriptInput, uploadFocusProxy);
  accessibilityReceipts.push({
    check: "s11-file-input-focus-proxy",
    focus: fileInputFocus,
    implementation_revision: implementationRevision,
    order: fileInputOrder,
    proxy_label: await uploadFocusProxy.textContent(),
    screen: "s11",
  });

  await manuscriptInput.setInputFiles({
    buffer: Buffer.from(docxBytesFixture()),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: "kvitne-nich-nad-dniprom.docx",
  });
  await expect(page).toHaveURL(/step=2/u);
  await expect(page.getByRole("heading", { name: "Назва, опис та ілюстрації" })).toBeVisible();
  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();
  await page.locator('input[type="file"]').setInputFiles({
    buffer: await readFile(path.resolve("public/books/covers/kryzhani-maky.png")),
    mimeType: "image/png",
    name: "kalyna-visual.png",
  });
  await expect(page).toHaveURL(/uploaded=illustration/u);
  await expect(
    page.getByRole("list", { name: "Додані ілюстрації" }).getByText("kalyna-visual.png"),
  ).toBeVisible();
  await page.getByLabel("Назва книжки").fill("Квітне ніч над Дніпром");
  await page
    .getByRole("textbox", { name: /^Опис \*/u })
    .fill("Українська історія про нічну подорож, памʼять і квітучу калину над Дніпром.");
  await page.setViewportSize({ height: viewportHeights[390], width: 390 });
  const s11Semantics = await computedAccessibility(page);
  expect(s11Semantics.mobileInputs.length, "S-11 must expose editable mobile inputs").toBeGreaterThan(0);
  for (const input of s11Semantics.mobileInputs) {
    expect(input.fontSize, `${input.label} mobile input text must be at least 16 CSS px`).toBeGreaterThanOrEqual(16);
  }
  await page.setViewportSize({ height: viewportHeights[1280], width: 1280 });
  const s11Next = page.getByRole("button", { name: "Далі" });
  const s11Order = await tabToTarget(page, s11Next);
  const s11Focus = await assertVisibleFocus(s11Next);
  accessibilityReceipts.push({
    activation_key: "Enter",
    check: "s11-keyboard-activation",
    focus: s11Focus,
    form_controls: s11Semantics.formControls,
    implementation_revision: implementationRevision,
    mobile_inputs: s11Semantics.mobileInputs,
    order: s11Order,
    screen: "s11",
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/step=3/u);
  await page.waitForLoadState("networkidle");
  await Promise.all([
    page.waitForURL(/step=4/u),
    page.getByRole("button", { name: "Створити обкладинку" }).click(),
  ]);

  await page.goto(`/author/publish?draft=${encodeURIComponent(draftId!)}&step=3`);
  await expect(page.getByRole("heading", { name: "Обкладинка" })).toBeVisible();
  const generatedCover = page.getByRole("img", {
    name: "Квітне ніч над Дніпром — обкладинка",
  });
  await expect(generatedCover).toBeVisible();
  await assertCoverGeometry(generatedCover, 1);
  const commerceStepLink = page.getByRole("link", { name: "Далі", exact: true });
  await expect(commerceStepLink).toHaveAttribute("href", new RegExp(`draft=${draftId}.*step=4`, "u"));
  const commerceStepHref = await commerceStepLink.getAttribute("href");
  expect(commerceStepHref).toBeTruthy();
  await page.goto(commerceStepHref!);
  await expect(page).toHaveURL(/step=4/u);

  await page.getByLabel("Основний жанр").selectOption("proza");
  await page.getByLabel("Базова ціна, грн").fill("199");
  await page.getByRole("button", { name: "Підготувати preview" }).click();
  await expect(page).toHaveURL(/\/author\/publish\/preview\?draft=/u);
  await expect(page.getByRole("heading", { name: "Попередній перегляд видання" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Квітне ніч над Дніпром" }).last()).toBeVisible({
    timeout: 45_000,
  });
  const readingPreview = page.getByLabel("Попередній перегляд книжки");
  await expect(readingPreview.locator("img")).toHaveCount(2);
  const sampleSelect = page.getByLabel("Безкоштовний фрагмент");
  const sampleHelpId = await sampleSelect.getAttribute("aria-describedby");
  expect(sampleHelpId).toBeTruthy();
  await expect(page.locator(`#${sampleHelpId}`)).toBeVisible();
  await expect(sampleSelect.locator("option:not([disabled])")).not.toHaveCount(0);
  const sampleContinue = page.getByRole("button", {
    name: "Зберегти фрагмент і перейти далі",
  });
  await expect(sampleContinue).toBeDisabled();
  await sampleSelect.selectOption("0");
  await expect(sampleContinue).toBeEnabled();

  for (const width of viewports) {
    if (width <= 430) {
      await page.getByRole("button", { name: "Мобільний" }).click();
    } else {
      await page.getByRole("button", { name: "Десктоп" }).click();
    }
    await capture(page, {
      mobilePreview: width <= 430 ? readingPreview : undefined,
      screen: "s12",
      state: width <= 430 ? "book-mobile" : "book-desktop",
      width,
    });
  }

  await assertReflow200(page, "s12", [
    page.getByRole("heading", { name: "Попередній перегляд видання" }),
    page.getByRole("tab", { name: "Книжка" }),
    sampleSelect,
    sampleContinue,
  ]);
  const bookTab = page.getByRole("tab", { name: "Книжка" });
  const pageTab = page.getByRole("tab", { name: "Сторінка книжки" });
  const tabOrder = await tabToTarget(page, bookTab);
  const tabFocus = await assertVisibleFocus(bookTab);
  await page.keyboard.press("ArrowRight");
  await expect(pageTab).toBeFocused();
  await expect(pageTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(bookTab).toBeFocused();
  await expect(bookTab).toHaveAttribute("aria-selected", "true");
  const tabSemantics = await page.getByRole("tablist", { name: "Тип попереднього перегляду" }).evaluate((tablist) => {
    const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
    return tabs.map((tab) => {
      const controls = tab.getAttribute("aria-controls") ?? "";
      const panel = controls ? document.getElementById(controls) : null;
      return {
        controls,
        controlsPanel: Boolean(panel && panel.getAttribute("role") === "tabpanel"),
        label: tab.textContent?.trim() ?? "",
        selected: tab.getAttribute("aria-selected"),
        tabIndex: tab.tabIndex,
      };
    });
  });
  expect(tabSemantics.every((tab) => tab.controls && tab.controlsPanel)).toBe(true);
  expect(tabSemantics.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  await expect(page.getByRole("group", { name: "Розмір попереднього перегляду" })).toBeVisible();
  accessibilityReceipts.push({
    activation_keys: ["ArrowRight", "Home"],
    check: "s12-tab-keyboard-activation",
    focus: tabFocus,
    implementation_revision: implementationRevision,
    order: tabOrder,
    screen: "s12",
    tabs: tabSemantics,
  });

  await page.getByRole("tab", { name: "Сторінка книжки" }).click();
  await expect(page.getByText("199 грн", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Мобільний" }).click();
  const bookPagePreview = page.getByLabel("Попередній перегляд Сторінки книжки");
  const previewCover = page.getByRole("img", { name: "Квітне ніч над Дніпром — Олена Вітрова" });
  for (const width of viewports) {
    await capture(page, {
      covers: previewCover,
      mobilePreview: bookPagePreview,
      screen: "s12",
      state: "book-page-mobile",
      width,
    });
  }

  await sampleContinue.click();
  await expect(page).toHaveURL(/step=6/u);
  const rights = page.getByLabel(/Підтверджую Декларацію прав/u);
  const license = page.getByLabel(/Окремо приймаю пʼятирічну/u);
  const submit = page.getByRole("button", { name: "Подати книжку" });
  await expect(rights).not.toBeChecked();
  await expect(license).not.toBeChecked();
  await expect(submit).toBeDisabled();

  for (const width of viewports) {
    await capture(page, { screen: "s11", state: "legal-unchecked", width });
  }

  await rights.check();
  await expect(submit).toBeDisabled();
  await license.check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/author\/books\?submitted=1/u);
  await expect(page.getByRole("status")).toContainText("Книжку подано");
  await expect(page.getByText("На модерації").first()).toBeVisible();

  for (const width of viewports) {
    await capture(page, {
      covers: page.getByRole("img", { name: /— обкладинка$/u }),
      minimumCoverCount: 1,
      screen: "s10",
      state: "books-submitted",
      width,
    });
  }

  expect(consoleErrors, "browser console must stay free of errors").toEqual([]);
  expect(pageErrors, "page runtime must stay free of uncaught errors").toEqual([]);
});
