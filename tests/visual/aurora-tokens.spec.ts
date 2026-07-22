import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  AURORA_BASELINE_ID,
  AURORA_TARGET_BUNDLE_HASH,
  auroraCssVariables,
} from "../../components/aurora/tokens";

const evidenceDirectory = process.env.UNIT_EVIDENCE_DIR;

function normalizeCssValue(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

test("VIS-TOKENS matches the immutable Aurora V3 contract", async ({ page }, testInfo) => {
  await page.goto("/fixtures/aurora");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("main")).toHaveAttribute(
    "data-baseline-id",
    AURORA_BASELINE_ID,
  );
  await expect(page.locator("main")).toHaveAttribute(
    "data-target-bundle-hash",
    AURORA_TARGET_BUNDLE_HASH,
  );

  const browserTokens = await page.evaluate((expectedTokens) => {
    const computed = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    probe.hidden = true;
    document.body.append(probe);

    const canonicalize = (name: string, value: string): string => {
      probe.style.cssText = "";
      probe.hidden = true;
      const property = name.includes("gradient") || name.includes("mesh")
        ? "background-image"
        : name.includes("font")
          ? "font-family"
          : name.includes("radius")
            ? "border-radius"
            : name.includes("shadow")
              ? "box-shadow"
              : name.includes("motion")
                ? "transition"
                : "color";
      probe.style.setProperty(property, value);
      return getComputedStyle(probe).getPropertyValue(property).trim();
    };

    const result = Object.fromEntries(
      Object.entries(expectedTokens).map(([name, authored]) => {
        const actual = computed.getPropertyValue(name).trim();
        return [
          name,
          {
            actual,
            actual_canonical: canonicalize(name, actual),
            authored,
            expected_canonical: canonicalize(name, authored),
          },
        ];
      }),
    );
    probe.remove();
    return result;
  }, auroraCssVariables);

  for (const name of Object.keys(auroraCssVariables)) {
    expect(
      normalizeCssValue(browserTokens[name]?.actual_canonical ?? ""),
      `${name} drifted from the approved Aurora V3 token`,
    ).toBe(normalizeCssValue(browserTokens[name]?.expected_canonical ?? ""));
  }

  const visualDirectory = evidenceDirectory
    ? path.join(evidenceDirectory, "evidence", "visual")
    : testInfo.outputPath("visual-evidence");
  await mkdir(visualDirectory, { recursive: true });
  const screenshotPath = path.join(visualDirectory, "vis-tokens.png");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: screenshotPath,
  });

  const result = {
    baseline_id: AURORA_BASELINE_ID,
    browser_tokens: browserTokens,
    expected_tokens: auroraCssVariables,
    fixture: "Aurora token foundation fixture; not a product screen",
    match: true,
    permitted_variance:
      "Fixture composition only; immutable source tokens and target bundle hash have zero variance.",
    route: "/fixtures/aurora",
    state: "default",
    target_bundle_hash: AURORA_TARGET_BUNDLE_HASH,
    viewport: { height: 900, width: 1280 },
  };
  await writeFile(
    path.join(visualDirectory, "vis-tokens.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
});
