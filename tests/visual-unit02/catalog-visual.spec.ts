import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { openPostgresDatabase } from "../../db/postgres";
import { requireDedicatedUnit02DatabaseUrl } from "../../scripts/unit02-database-guard";

const unit02DatabaseUrl = requireDedicatedUnit02DatabaseUrl(process.env.UNIT02_DATABASE_URL);
const implementationRevision = process.env.UNIT02_IMPLEMENTATION_REVISION;
if (!implementationRevision) throw new Error("UNIT02_IMPLEMENTATION_REVISION is required");

const responsiveWidths = [390, 430, 768, 1440] as const;
const expectedReceiptCount = 53;

const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/visual")
  : path.resolve("test-results/unit02-visual/evidence/visual");
const receipts: Array<Record<string, unknown>> = [];
const consoleErrors: string[] = [];

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastAgainstWhite(red: number, green: number, blue: number): number {
  const luminance =
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue);
  return 1.05 / (luminance + 0.05);
}

async function scrollInstantly(
  page: import("@playwright/test").Page,
  position: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.evaluate(async ({ x, y }) => {
    const root = document.documentElement;
    const originalScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(x, y);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    root.style.scrollBehavior = originalScrollBehavior;
  }, position);
  await expect
    .poll(() => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })))
    .toEqual(position);
}

async function waitForImages(
  images: import("@playwright/test").Locator,
  options: { readonly intersectingOnly?: boolean } = {},
): Promise<void> {
  const intersectingOnly = options.intersectingOnly ?? true;
  const loaded = () =>
    images.evaluateAll(
      (elements, onlyIntersecting) => {
        const relevant = elements.filter((element) => {
          if (!onlyIntersecting) return true;
          const box = element.getBoundingClientRect();
          return box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight;
        });
        return relevant.every(
          (element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0,
        );
      },
      intersectingOnly,
    );
  await expect.poll(loaded, { timeout: 15_000 }).toBe(true);
  await images.evaluateAll(
    async (elements, onlyIntersecting) => {
      const relevant = elements.filter((element) => {
        if (!onlyIntersecting) return true;
        const box = element.getBoundingClientRect();
        return box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight;
      });
      await Promise.all(relevant.map((element) => (element as HTMLImageElement).decode()));
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    },
    intersectingOnly,
  );
}

async function minimumCoverCopyContrast(
  page: import("@playwright/test").Page,
  coverLink: import("@playwright/test").Locator,
): Promise<number> {
  const cover = coverLink.locator("span").first();
  const copy = coverLink.locator('span[aria-hidden="true"]').last();
  const scrollPosition = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await cover.scrollIntoViewIfNeeded();
  try {
    const coverBox = await cover.boundingBox();
    expect(coverBox).not.toBeNull();
    const textBoxes = (
      await Promise.all(
        (await copy.locator(":scope > span").all()).map((text) => text.boundingBox()),
      )
    ).filter((value): value is NonNullable<typeof value> => value !== null);
    expect(textBoxes.length).toBeGreaterThan(0);
    const renderedBuffer = await page.screenshot({ animations: "disabled", clip: coverBox! });
    let backdropBuffer: Buffer;
    await copy.evaluate((element) => {
      element.style.visibility = "hidden";
    });
    try {
      backdropBuffer = await page.screenshot({ animations: "disabled", clip: coverBox! });
    } finally {
      await copy.evaluate((element) => {
        element.style.removeProperty("visibility");
      });
    }
    const rendered = await sharp(renderedBuffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const backdrop = await sharp(backdropBuffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = backdrop;
    const scaleX = info.width / coverBox!.width;
    const scaleY = info.height / coverBox!.height;
    let glyphPixels = 0;
    let minimum = Number.POSITIVE_INFINITY;
    for (const textBox of textBoxes) {
      const startX = Math.max(0, Math.floor((textBox.x - coverBox!.x) * scaleX));
      const endX = Math.min(
        info.width,
        Math.ceil((textBox.x + textBox.width - coverBox!.x) * scaleX),
      );
      const startY = Math.max(0, Math.floor((textBox.y - coverBox!.y) * scaleY));
      const endY = Math.min(
        info.height,
        Math.ceil((textBox.y + textBox.height - coverBox!.y) * scaleY),
      );
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * info.width + x) * info.channels;
          const brightnessDelta =
            rendered.data[offset]! +
            rendered.data[offset + 1]! +
            rendered.data[offset + 2]! -
            data[offset]! -
            data[offset + 1]! -
            data[offset + 2]!;
          if (brightnessDelta < 24) continue;
          glyphPixels += 1;
          minimum = Math.min(
            minimum,
            contrastAgainstWhite(data[offset]!, data[offset + 1]!, data[offset + 2]!),
          );
        }
      }
    }
    expect(glyphPixels).toBeGreaterThan(10);
    return rounded(minimum);
  } finally {
    await scrollInstantly(page, scrollPosition);
  }
}

async function minimumWhiteContrastAcrossElement(
  element: import("@playwright/test").Locator,
): Promise<number> {
  await expect(element).toBeVisible();
  const renderedBuffer = await element.screenshot({ animations: "disabled" });
  await element.evaluate((node) => {
    node.setAttribute("data-original-color", (node as HTMLElement).style.color);
    (node as HTMLElement).style.color = "transparent";
  });
  let backdropBuffer: Buffer;
  try {
    backdropBuffer = await element.screenshot({ animations: "disabled" });
  } finally {
    await element.evaluate((node) => {
      const original = node.getAttribute("data-original-color") ?? "";
      (node as HTMLElement).style.color = original;
      node.removeAttribute("data-original-color");
    });
  }
  const rendered = await sharp(renderedBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const backdrop = await sharp(backdropBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(rendered.info).toEqual(backdrop.info);
  const { data, info } = backdrop;
  let glyphPixels = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const brightnessDelta =
      rendered.data[offset]! +
      rendered.data[offset + 1]! +
      rendered.data[offset + 2]! -
      data[offset]! -
      data[offset + 1]! -
      data[offset + 2]!;
    if (brightnessDelta < 24) continue;
    glyphPixels += 1;
    minimum = Math.min(
      minimum,
      contrastAgainstWhite(data[offset]!, data[offset + 1]!, data[offset + 2]!),
    );
  }
  expect(glyphPixels).toBeGreaterThan(10);
  return rounded(minimum);
}

async function minimumHeroGlyphContrast(
  page: import("@playwright/test").Page,
  hero: import("@playwright/test").Locator,
  text: import("@playwright/test").Locator,
): Promise<number> {
  const heroBox = await hero.boundingBox();
  const textBox = await text.boundingBox();
  expect(heroBox).not.toBeNull();
  expect(textBox).not.toBeNull();
  const gradient = await text.evaluate((node) => getComputedStyle(node).backgroundImage);
  const colors = [...gradient.matchAll(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/gu)].map(
    (match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const,
  );
  expect(colors).toHaveLength(3);
  const rendered = await page.screenshot({ animations: "disabled", clip: heroBox! });
  await text.evaluate((node) => {
    node.setAttribute("data-original-visibility", (node as HTMLElement).style.visibility);
    (node as HTMLElement).style.visibility = "hidden";
  });
  let backdrop: Buffer;
  try {
    backdrop = await page.screenshot({ animations: "disabled", clip: heroBox! });
  } finally {
    await text.evaluate((node) => {
      const original = node.getAttribute("data-original-visibility") ?? "";
      (node as HTMLElement).style.visibility = original;
      node.removeAttribute("data-original-visibility");
    });
  }
  const renderedRaw = await sharp(rendered).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const backdropRaw = await sharp(backdrop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scaleX = renderedRaw.info.width / heroBox!.width;
  const scaleY = renderedRaw.info.height / heroBox!.height;
  const startX = Math.max(0, Math.floor((textBox!.x - heroBox!.x) * scaleX));
  const endX = Math.min(
    renderedRaw.info.width,
    Math.ceil((textBox!.x + textBox!.width - heroBox!.x) * scaleX),
  );
  const startY = Math.max(0, Math.floor((textBox!.y - heroBox!.y) * scaleY));
  const endY = Math.min(
    renderedRaw.info.height,
    Math.ceil((textBox!.y + textBox!.height - heroBox!.y) * scaleY),
  );
  let glyphPixels = 0;
  let minimum = Number.POSITIVE_INFINITY;
  const interpolate = (left: readonly number[], right: readonly number[], progress: number) =>
    left.map((value, index) => Math.round(value + (right[index]! - value) * progress));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * renderedRaw.info.width + x) * renderedRaw.info.channels;
      const delta = [0, 1, 2].reduce(
        (sum, channel) =>
          sum + Math.abs(renderedRaw.data[offset + channel]! - backdropRaw.data[offset + channel]!),
        0,
      );
      if (delta < 24) continue;
      glyphPixels += 1;
      const position = (x - startX) / Math.max(1, endX - startX - 1);
      const foreground =
        position <= 0.55
          ? interpolate(colors[0]!, colors[1]!, position / 0.55)
          : interpolate(colors[1]!, colors[2]!, (position - 0.55) / 0.45);
      minimum = Math.min(
        minimum,
        (() => {
          const background = [
            backdropRaw.data[offset]!,
            backdropRaw.data[offset + 1]!,
            backdropRaw.data[offset + 2]!,
          ];
          const luminance = (channels: readonly number[]) =>
            0.2126 * channelToLinear(channels[0]!) +
            0.7152 * channelToLinear(channels[1]!) +
            0.0722 * channelToLinear(channels[2]!);
          const first = luminance(foreground);
          const second = luminance(background);
          return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        })(),
      );
    }
  }
  expect(glyphPixels).toBeGreaterThan(100);
  return rounded(minimum);
}

async function minimumSolidGlyphContrast(
  page: import("@playwright/test").Page,
  text: import("@playwright/test").Locator,
): Promise<number> {
  const scrollPosition = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await text.scrollIntoViewIfNeeded();
  const foreground = await text.evaluate((node) => {
    const match = getComputedStyle(node).color.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/u);
    if (!match) throw new Error("Expected an RGB computed text color");
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  });
  const rendered = await text.screenshot({ animations: "disabled" });
  let backdrop: Buffer | undefined;
  try {
    await text.evaluate((node) => {
      node.setAttribute("data-original-color", (node as HTMLElement).style.color);
      (node as HTMLElement).style.color = "transparent";
    });
    backdrop = await text.screenshot({ animations: "disabled" });
  } finally {
    await text.evaluate((node) => {
      const original = node.getAttribute("data-original-color") ?? "";
      (node as HTMLElement).style.color = original;
      node.removeAttribute("data-original-color");
    });
    await scrollInstantly(page, scrollPosition);
  }
  expect(backdrop).toBeDefined();
  const renderedRaw = await sharp(rendered)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const backdropRaw = await sharp(backdrop!)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(renderedRaw.info).toEqual(backdropRaw.info);
  const foregroundLuminance =
    0.2126 * channelToLinear(foreground[0]!) +
    0.7152 * channelToLinear(foreground[1]!) +
    0.0722 * channelToLinear(foreground[2]!);
  let glyphPixels = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (
    let offset = 0;
    offset < backdropRaw.data.length;
    offset += backdropRaw.info.channels
  ) {
    const delta = [0, 1, 2].reduce(
      (sum, channel) =>
        sum + Math.abs(renderedRaw.data[offset + channel]! - backdropRaw.data[offset + channel]!),
      0,
    );
    if (delta < 24) continue;
    glyphPixels += 1;
    const backgroundLuminance =
      0.2126 * channelToLinear(backdropRaw.data[offset]!) +
      0.7152 * channelToLinear(backdropRaw.data[offset + 1]!) +
      0.0722 * channelToLinear(backdropRaw.data[offset + 2]!);
    minimum = Math.min(
      minimum,
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
    );
  }
  expect(glyphPixels).toBeGreaterThan(10);
  return rounded(minimum);
}

async function box(page: import("@playwright/test").Page, selector: string) {
  const value = await page.locator(selector).first().boundingBox();
  expect(value, `${selector} must have a layout box`).not.toBeNull();
  return Object.fromEntries(
    Object.entries(value!).map(([key, number]) => [key, rounded(number)]),
  ) as { height: number; width: number; x: number; y: number };
}

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  return layout;
}

async function assertInteractiveTargets(
  root: import("@playwright/test").Locator,
): Promise<number> {
  const targets = root.locator(
    'a:visible, button:visible, input:visible:not([type="hidden"]):not([type="checkbox"]), select:visible, summary:visible, label:visible:has(input[type="checkbox"])',
  );
  let checked = 0;
  for (const target of await targets.all()) {
    const targetBox = await target.boundingBox();
    if (!targetBox) continue;
    const accessibleName =
      (await target.getAttribute("aria-label")) ??
      (await target.textContent())?.trim() ??
      (await target.getAttribute("name")) ??
      "interactive target";
    expect(targetBox.height, accessibleName).toBeGreaterThanOrEqual(43.99);
    expect(targetBox.width, accessibleName).toBeGreaterThanOrEqual(43.99);
    checked += 1;
  }
  expect(checked).toBeGreaterThan(0);
  return checked;
}

async function assertVisibleFocus(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
  options: { readonly preserve?: boolean } = {},
) {
  await page.evaluate(() => {
    document.documentElement.tabIndex = -1;
    document.documentElement.focus();
  });
  let reached = false;
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press("Tab");
    reached = await target.evaluate((element) => document.activeElement === element);
    if (reached) break;
  }
  expect(reached).toBe(true);
  const focus = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(3);
  if (!options.preserve) {
    await target.evaluate((element) => {
      (element as HTMLElement).blur();
      document.documentElement.removeAttribute("tabindex");
    });
  }
  return focus;
}

async function capture(
  page: import("@playwright/test").Page,
  fileName: string,
  metadata: Record<string, unknown>,
  options: { readonly fullPage?: boolean } = {},
) {
  await mkdir(evidenceRoot, { recursive: true });
  const outputPath = path.join(evidenceRoot, fileName);
  const fullPage = options.fullPage ?? true;
  if (fullPage) await scrollInstantly(page, { x: 0, y: 0 });
  await waitForImages(page.locator("img"));
  await page.screenshot({
    animations: "disabled",
    fullPage,
    path: outputPath,
  });
  const sha256 = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  receipts.push({ ...metadata, file: `evidence/visual/${fileName}`, sha256 });
}

async function captureBlockedLoading(
  page: import("@playwright/test").Page,
  url: string,
  selector: string,
  fileName: string,
  metadata: Record<string, unknown>,
) {
  const database = openPostgresDatabase(unit02DatabaseUrl!);
  const connection = await database.connect();
  await connection.query("BEGIN");
  await connection.query("LOCK TABLE catalog_book_read_models IN ACCESS EXCLUSIVE MODE");
  let assertionFailure: unknown;
  let navigationFailure: unknown;
  const navigation = page.goto(url).catch((error: unknown) => {
    navigationFailure = error;
    return null;
  });
  try {
    await expect(page.locator(selector)).toBeVisible({ timeout: 15_000 });
    await capture(page, fileName, metadata);
  } catch (error) {
    assertionFailure = error;
  } finally {
    await connection.query("ROLLBACK");
    connection.release?.();
    await database.close();
  }
  await navigation;
  if (assertionFailure) throw assertionFailure;
  if (navigationFailure) throw navigationFailure;
}

test.beforeEach(async ({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
});

test.afterAll(async () => {
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(
    path.join(evidenceRoot, "unit02-visual-matrix.json"),
    `${JSON.stringify(
      {
        baseline_id: "AVB-UKIEBOOK-AURORA-7B-V2",
        console_errors: consoleErrors,
        implementation_revision: implementationRevision,
        receipts,
        status:
          consoleErrors.length === 0 && receipts.length === expectedReceiptCount
            ? "passed"
            : "failed",
        target_bundle_hash:
          "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d",
        verified_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  expect(consoleErrors).toEqual([]);
  expect(receipts.length).toBe(expectedReceiptCount);
});

test("S-01 keeps the locked 1280 geometry, official logo and additive hovers", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Затишні вечори/u })).toBeVisible();
  const activeMain = page.locator("main:not([aria-label])");
  await expect(activeMain).toBeVisible();

  const heroGradientContrast = await minimumHeroGlyphContrast(
    page,
    activeMain.locator("section").filter({ has: page.locator("#catalog-hero-title") }),
    activeMain.locator("#catalog-hero-title span"),
  );
  expect(heroGradientContrast, "hero gradient on Aurora mesh").toBeGreaterThanOrEqual(4.5);
  const desktopNavigation = activeMain.getByRole("navigation", { name: "Основна навігація" });
  const navigationContrasts: Record<string, number> = {};
  for (const label of ["Жанри", "Знижки", "Авторам"] as const) {
    const contrast = await minimumSolidGlyphContrast(
      page,
      desktopNavigation.locator("a").filter({ hasText: label }),
    );
    expect(contrast, label).toBeGreaterThanOrEqual(4.5);
    navigationContrasts[label] = contrast;
  }

  const geometry = {
    formula: await box(page, 'main:not([aria-label]) section[aria-labelledby="formula-title"]'),
    header: await box(page, "main:not([aria-label]) > div > header"),
    hero: await box(page, "main:not([aria-label]) > div > section"),
    shelf: await box(page, 'main:not([aria-label]) section[aria-label="Вибір редакції"]'),
    tiles: await box(page, 'main:not([aria-label]) section[aria-label="Популярні книжки"]'),
  };
  expect(geometry.header).toEqual({ height: 72, width: 1220, x: 30, y: 24 });
  expect(geometry.hero).toEqual({ height: 212.219, width: 1220, x: 30, y: 96 });
  expect(geometry.shelf).toEqual({ height: 270, width: 1220, x: 30, y: 308.219 });
  expect(geometry.tiles).toEqual({ height: 172, width: 1220, x: 30, y: 578.219 });
  expect(geometry.formula).toEqual({ height: 98, width: 1140, x: 70, y: 776.219 });

  const logo = activeMain.getByRole("link", { name: "UkieBook — головна" }).locator("img");
  await expect(logo).toBeVisible();
  expect(await logo.boundingBox()).toMatchObject({ height: 26, width: 26, x: 70, y: 47 });
  await expect(logo).toHaveAttribute("src", /UkieBook-logo\.jpg/u);

  const covers = activeMain.locator('section[aria-label="Вибір редакції"] > a');
  await expect(covers).toHaveCount(5);
  const coverContrasts: Record<"result" | "shelf" | "tile", number[]> = {
    result: [],
    shelf: [],
    tile: [],
  };
  for (const [variant, roots] of [
    ["shelf", covers],
    ["tile", activeMain.locator('section[aria-label="Популярні книжки"] > a')],
    ["result", activeMain.locator("section#catalog-results article > a")],
  ] as const) {
    expect(await roots.count(), `${variant} covers`).toBeGreaterThan(0);
    for (const root of await roots.all()) {
      const coverBox = await root.locator("span").first().boundingBox();
      expect(coverBox).not.toBeNull();
      expect(coverBox!.height / coverBox!.width).toBeGreaterThan(1.4);
      const minimumContrast = await minimumCoverCopyContrast(page, root);
      expect(minimumContrast, `${variant} cover copy`).toBeGreaterThanOrEqual(4.5);
      coverContrasts[variant].push(minimumContrast);
    }
  }
  const segments = await page
    .locator('main:not([aria-label]) section[aria-labelledby="formula-title"] [role="img"] > span')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  const total = segments.reduce((sum, width) => sum + width, 0);
  const percentages = segments.map((width) => (width / total) * 100);
  for (const [index, expected] of [6, 65.8, 28.2].entries()) {
    expect(percentages[index]).toBeCloseTo(expected, 1);
  }
  const formulaAuthorContrast = await minimumWhiteContrastAcrossElement(
    activeMain.locator(
      'section[aria-labelledby="formula-title"] [role="img"] > span:nth-child(2)',
    ),
  );
  expect(formulaAuthorContrast, "author formula segment").toBeGreaterThanOrEqual(4.5);
  const semanticContrast = await page.evaluate(() => {
    function toLinear(value: number) {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    }
    function channels(value: string) {
      const hex = value.trim().replace(/^#/u, "");
      return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    }
    function contrast(left: string, right: string) {
      const luminance = (value: string) => {
        const [red = 0, green = 0, blue = 0] = channels(value);
        return (
          0.2126 * toLinear(red) +
          0.7152 * toLinear(green) +
          0.0722 * toLinear(blue)
        );
      };
      const first = luminance(left);
      const second = luminance(right);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    }
    const root = getComputedStyle(document.documentElement);
    return {
      accentOnCanvas: contrast(
        root.getPropertyValue("--color-accent-action"),
        root.getPropertyValue("--color-bg"),
      ),
      formulaPlatform: contrast(
        root.getPropertyValue("--color-formula-platform-text-active"),
        root.getPropertyValue("--color-formula-platform"),
      ),
    };
  });
  expect(semanticContrast.accentOnCanvas).toBeGreaterThanOrEqual(4.5);
  expect(semanticContrast.formulaPlatform).toBeGreaterThanOrEqual(4.5);
  const targetCount = await assertInteractiveTargets(activeMain);
  const layout = await assertNoHorizontalOverflow(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Затишні вечори/u })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })))
    .toEqual({ x: 0, y: 0 });
  await waitForImages(
    activeMain.locator(
      'section[aria-label="Вибір редакції"] img, section[aria-label="Популярні книжки"] img',
    ),
    { intersectingOnly: false },
  );
  expect(await logo.boundingBox()).toMatchObject({ height: 26, width: 26, x: 70, y: 47 });
  await capture(
    page,
    "s01-default-1280@2x.png",
    {
      accessibility: {
        coverContrasts,
        formulaAuthorContrast,
        heroGradientContrast,
        navigationContrasts,
        semanticContrast,
        targetCount,
      },
      geometry,
      layout,
      screen: "S-01",
      state: "default",
      viewport: { height: 900, width: 1280 },
    },
    { fullPage: false },
  );

  const shelfTarget = covers.nth(2);
  const coverBefore = await shelfTarget.boundingBox();
  await shelfTarget.hover();
  await page.waitForTimeout(220);
  const coverAfter = await shelfTarget.boundingBox();
  const shelfLift = rounded(coverAfter!.y - coverBefore!.y);
  expect(shelfLift).toBe(-16);
  expect(rounded(coverAfter!.width)).toBe(rounded(coverBefore!.width));
  await capture(
    page,
    "s01-shelf-hover-1280@2x.png",
    {
      interaction: { shelfLift },
      screen: "S-01",
      state: "shelf-hover",
      viewport: { height: 900, width: 1280 },
    },
    { fullPage: false },
  );

  await page.mouse.move(1260, 890);
  await page.waitForTimeout(220);
  const tile = activeMain.locator('section[aria-label="Популярні книжки"] > a').first();
  const tileBefore = await tile.boundingBox();
  await tile.hover();
  await page.waitForTimeout(220);
  const tileAfter = await tile.boundingBox();
  const tileLift = rounded(tileAfter!.y - tileBefore!.y);
  expect(tileLift).toBe(-4);
  await capture(
    page,
    "s01-tile-hover-1280@2x.png",
    {
      interaction: { tileLift },
      screen: "S-01",
      state: "tile-hover",
      viewport: { height: 900, width: 1280 },
    },
    { fullPage: false },
  );

  await page.mouse.move(1260, 890);
  await page.waitForTimeout(220);
  const shelfFocus = await assertVisibleFocus(page, shelfTarget, { preserve: true });
  await capture(
    page,
    "s01-shelf-focus-1280@2x.png",
    {
      accessibility: { focus: shelfFocus },
      screen: "S-01",
      state: "shelf-keyboard-focus",
      viewport: { height: 900, width: 1280 },
    },
    { fullPage: false },
  );
  await shelfTarget.evaluate((element) => (element as HTMLElement).blur());
  const tileFocus = await assertVisibleFocus(page, tile, { preserve: true });
  await capture(
    page,
    "s01-tile-focus-1280@2x.png",
    {
      accessibility: { focus: tileFocus },
      screen: "S-01",
      state: "tile-keyboard-focus",
      viewport: { height: 900, width: 1280 },
    },
    { fullPage: false },
  );
  await tile.evaluate((element) => {
    (element as HTMLElement).blur();
    document.documentElement.removeAttribute("tabindex");
  });
});

test("S-01 reflows deterministically without clipping at required widths", async ({ page }) => {
  for (const width of responsiveWidths) {
    const height = width <= 430 ? 844 : 900;
    await page.setViewportSize({ height, width });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Затишні вечори/u })).toBeVisible();
    const activeMain = page.locator("main:not([aria-label])");
    await expect(activeMain).toBeVisible();
    const layout = await assertNoHorizontalOverflow(page);
    const targetCount = await assertInteractiveTargets(activeMain);
    const formulaSegments = await activeMain
      .locator('section[aria-labelledby="formula-title"] [role="img"] > span')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    const formulaTotal = formulaSegments.reduce((sum, segmentWidth) => sum + segmentWidth, 0);
    for (const [index, expected] of [6, 65.8, 28.2].entries()) {
      expect((formulaSegments[index]! / formulaTotal) * 100).toBeCloseTo(expected, 1);
    }
    let disclosureFocus: Record<string, unknown> | undefined;
    let mobileTargetCount: number | undefined;
    if (width <= 430) {
      await expect(
        activeMain.locator('header details:not([open]) form[role="search"]'),
      ).not.toBeVisible();
      await activeMain.locator('header summary[aria-label="Відкрити меню"]').click();
      const mobileSearch = activeMain.locator('header details[open] form[role="search"]');
      await expect(mobileSearch).toBeVisible();
      await expect(mobileSearch.getByRole("button", { name: "Знайти" })).toBeVisible();
      mobileTargetCount = await assertInteractiveTargets(
        activeMain.locator('header details[open]'),
      );
      await expect(page.locator('section[aria-label="Популярні книжки"]')).toHaveCSS(
        "grid-template-columns",
        /.+px .+px/u,
      );
      const menuSummary = activeMain.locator('header summary[aria-label="Відкрити меню"]');
      disclosureFocus = await assertVisibleFocus(page, menuSummary);
      await menuSummary.click();
      await expect(mobileSearch).not.toBeVisible();

      const filterSummary = activeMain.locator(
        'section#catalog-results details > summary',
      );
      await filterSummary.click();
      mobileTargetCount += await assertInteractiveTargets(
        activeMain.locator('section#catalog-results details[open]'),
      );
      await filterSummary.click();
    }
    await capture(
      page,
      `s01-default-${width}@2x.png`,
      {
        accessibility: { disclosureFocus, mobileTargetCount, targetCount },
        layout,
        screen: "S-01",
        state: "responsive-default",
        viewport: { height, width },
      },
      { fullPage: false },
    );
  }
});

test("S-01 honors reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/");
  const activeMain = page.locator("main:not([aria-label])");
  await expect(activeMain).toBeVisible();
  const cover = activeMain.locator('section[aria-label="Вибір редакції"] > a').nth(2);
  const motion = await cover.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  });
  const seconds = (value: string) =>
    value.split(",").map((duration) =>
      duration.trim().endsWith("ms")
        ? Number.parseFloat(duration) / 1000
        : Number.parseFloat(duration),
    );
  expect(Math.max(...seconds(motion.transitionDuration))).toBeLessThanOrEqual(0.001);
  expect(Math.max(...seconds(motion.animationDuration))).toBeLessThanOrEqual(0.001);
  await capture(
    page,
    "s01-reduced-motion-1280@2x.png",
    {
      accessibility: { motion },
      screen: "S-01",
      state: "prefers-reduced-motion",
      viewport: { height: 900, width: 1280 },
    },
    { fullPage: false },
  );
});

test("S-01 covers empty, filtered, query and long-result states at every responsive width", async ({
  page,
}) => {
  test.setTimeout(300_000);
  for (const width of responsiveWidths) {
    const height = width <= 430 ? 844 : 900;
    await page.setViewportSize({ height, width });
    for (const [state, url, visibleText, resetName] of [
      ["empty", "/?q=невідома#catalog-results", "Нічого не знайдено", "Скинути фільтри"],
      ["discount", "/?discounted=1#catalog-results", "Знайдіть наступну книжку", "Скинути все"],
      ["query", "/?q=Ірина#catalog-results", "Результати для «Ірина»", "Скинути все"],
      ["long-results", "/?page=2#catalog-results", "Сторінка 2 із 2", null],
    ] as const) {
      await page.goto(url);
      await expect(page.getByText(visibleText, { exact: true }).first()).toBeVisible();
      const activeMain = page.locator("main:not([aria-label])");
      const results = activeMain.locator("section#catalog-results");
      await results.scrollIntoViewIfNeeded();
      const resetContrast =
        resetName && (width === 390 || (width === 1440 && state === "discount"))
        ? await minimumSolidGlyphContrast(
            page,
            activeMain.getByRole("link", { name: resetName }).first(),
          )
        : undefined;
      if (resetContrast !== undefined) expect(resetContrast).toBeGreaterThanOrEqual(4.5);
      const layout = await assertNoHorizontalOverflow(page);
      await capture(
        page,
        `s01-${state}-${width}@2x.png`,
        {
          accessibility: { resetContrast },
          layout,
          screen: "S-01",
          state,
          viewport: { height, width },
        },
        { fullPage: false },
      );
    }
  }
});

test("S-01 captures the streaming loading shell at every responsive width", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of responsiveWidths) {
    const height = width <= 430 ? 844 : 900;
    await page.setViewportSize({ height, width });
    await captureBlockedLoading(
      page,
      "/",
      'main[aria-label="Каталог завантажується"]',
      `s01-loading-${width}@2x.png`,
      {
        screen: "S-01",
        state: "loading",
        viewport: { height, width },
      },
    );
  }
});

test("S-01 captures its inline repository error at every responsive width", async ({ page }) => {
  test.setTimeout(120_000);
  const database = openPostgresDatabase(unit02DatabaseUrl!);
  await database.query(
    "ALTER TABLE catalog_book_read_models RENAME TO catalog_book_read_models_unit02_error",
  );
  try {
    for (const width of responsiveWidths) {
      const height = width <= 430 ? 844 : 900;
      await page.setViewportSize({ height, width });
      await page.goto("/");
      const activeMain = page.locator("main:not([aria-label])");
      await expect(activeMain).toBeVisible();
      const alert = activeMain.getByRole("alert");
      await expect(alert).toContainText("Не вдалося завантажити каталог");
      await alert.scrollIntoViewIfNeeded();
      const layout = await assertNoHorizontalOverflow(page);
      await capture(
        page,
        `s01-error-${width}@2x.png`,
        {
          layout,
          screen: "S-01",
          state: "repository-error",
          viewport: { height, width },
        },
        { fullPage: false },
      );
    }
  } finally {
    await database.query(
      "ALTER TABLE catalog_book_read_models_unit02_error RENAME TO catalog_book_read_models",
    );
    await database.close();
  }
});

test("S-02 covers Discount on/off, sample, paged reviews and unavailable states", async ({ page }) => {
  test.setTimeout(300_000);
  for (const width of [390, 768, 1280] as const) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ height, width });
    for (const [state, url, visibleText] of [
      ["discount", "/books/44444444-4444-4444-8444-444444444444", "−16%"],
      ["discount-inactive", "/books/11111111-1111-4111-8111-111111111111", "265 грн"],
      [
        "sample-open",
        "/books/44444444-4444-4444-8444-444444444444?sample=1#sample",
        "Першого птаха Ірина побачила під грушею.",
      ],
      [
        "reviews-page-2",
        "/books/44444444-4444-4444-8444-444444444444?reviews=2#reviews",
        "2 / 2",
      ],
      [
        "unavailable",
        "/books/77777777-7777-4777-8777-777777777777",
        "Книжка недоступна",
      ],
    ] as const) {
      await page.goto(url);
      const stateMarker = page.getByText(visibleText, { exact: state !== "sample-open" }).first();
      await expect(stateMarker).toBeVisible();
      const activeMain = page.locator("main:not([aria-label])");
      await expect(activeMain).toBeVisible();
      const layout = await assertNoHorizontalOverflow(page);
      const targetCount = await assertInteractiveTargets(activeMain);
      const detailCoverContrast =
        state === "discount"
          ? await minimumCoverCopyContrast(
              page,
              activeMain.locator("article > section").first().locator(":scope > div").last(),
            )
          : undefined;
      if (detailCoverContrast !== undefined) {
        expect(detailCoverContrast).toBeGreaterThanOrEqual(4.5);
      }
      const backContrast =
        state === "discount"
          ? await minimumSolidGlyphContrast(
              page,
              activeMain.getByRole("link", { name: "До каталогу" }),
            )
          : undefined;
      if (backContrast !== undefined) expect(backContrast).toBeGreaterThanOrEqual(4.5);
      const sampleSummary = activeMain.locator("details#sample > summary");
      const disclosureFocus =
        state === "sample-open" && (await sampleSummary.count()) > 0
          ? await assertVisibleFocus(page, sampleSummary)
          : undefined;
      if (state === "sample-open" || state === "reviews-page-2") {
        await stateMarker.scrollIntoViewIfNeeded();
      }
      if (width === 390 && state === "discount") {
        const titleBox = await activeMain.getByRole("heading", { level: 1 }).boundingBox();
        const coverBox = await activeMain.locator("article img").first().boundingBox();
        const fragmentBox = await activeMain
          .getByRole("link", { name: "Читати фрагмент" })
          .boundingBox();
        const descriptionBox = await activeMain
          .locator('section[aria-labelledby="description-title"]')
          .boundingBox();
        expect(titleBox!.y).toBeLessThan(coverBox!.y);
        expect(fragmentBox!.y).toBeLessThan(descriptionBox!.y);
        await expect(
          activeMain.locator("article").getByRole("link", { name: "Додати в кошик" }),
        ).toBeVisible();
        await expect(activeMain.getByRole("link", { name: "Додати в кошик" })).toHaveCount(1);
      }
      await capture(
        page,
        `s02-${state}-${width}@2x.png`,
        {
          accessibility: { backContrast, detailCoverContrast, disclosureFocus, targetCount },
          layout,
          screen: "S-02",
          state,
          viewport: { height, width },
        },
        { fullPage: false },
      );
    }
  }
});

test("S-02 captures its streaming loading shell at every public viewport", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [390, 768, 1280] as const) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ height, width });
    await captureBlockedLoading(
      page,
      "/books/44444444-4444-4444-8444-444444444444",
      'main[aria-label="Книжка завантажується"]',
      `s02-loading-${width}@2x.png`,
      {
        screen: "S-02",
        state: "loading",
        viewport: { height, width },
      },
    );
  }
});

test("S-02 mobile menu escapes the Aurora header crop and remains keyboard reachable", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/books/44444444-4444-4444-8444-444444444444");
  const activeMain = page.locator("main:not([aria-label])");
  await expect(activeMain).toBeVisible();
  await activeMain.locator('header summary[aria-label="Відкрити меню"]').click();
  const mobileNavigation = activeMain.getByRole("navigation", { name: "Мобільна навігація" });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Авторам" })).toBeVisible();
  const signIn = mobileNavigation.getByRole("link", { name: "Увійти" });
  await expect(signIn).toBeVisible();
  const focus = await assertVisibleFocus(page, signIn);
  const targetCount = await assertInteractiveTargets(
    activeMain.locator('header details[open]'),
  );
  const layout = await assertNoHorizontalOverflow(page);
  await capture(
    page,
    "s02-menu-open-390@2x.png",
    {
      accessibility: { focus, targetCount },
      layout,
      screen: "S-02",
      state: "mobile-menu-open",
      viewport: { height: 844, width: 390 },
    },
    { fullPage: false },
  );
});

test("S-02 has no horizontal overflow at the remaining supported widths", async ({ page }) => {
  for (const width of [430, 1440] as const) {
    const height = width === 430 ? 844 : 900;
    await page.setViewportSize({ height, width });
    await page.goto("/books/44444444-4444-4444-8444-444444444444");
    const activeMain = page.locator("main:not([aria-label])");
    await expect(activeMain).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(activeMain);
  }
});
