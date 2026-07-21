import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  AURORA_BASELINE_ID,
  AURORA_TARGET_BUNDLE_HASH,
} from "../../components/aurora/tokens";
import { DATABASE_SCHEMA_REVISION } from "../../db/migrations";

const secretSentinel =
  process.env.UNIT00_SECRET_SENTINEL ??
  "unit00-browser-secret-sentinel-4f8d7b68";
const forbiddenBrowserMarkers = [
  secretSentinel,
  "UKIEBOOK_SERVER_ENV_ONLY_v1",
  "DATABASE_URL",
];
const evidenceDirectory = process.env.UNIT_EVIDENCE_DIR;

test("foundation health and Aurora fixture expose the shared contract without secrets", async ({
  page,
  request,
}) => {
  const browserErrors: string[] = [];
  const responseBodyPromises: Array<
    Promise<{ url: string; body: string } | null>
  > = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (/javascript|json|text|html/.test(contentType)) {
      responseBodyPromises.push(
        response
          .text()
          .then((body) => ({ url: response.url(), body }))
          // A navigation can cancel a response before its body is readable.
          .catch(() => null),
      );
    }
  });

  const healthResponse = await request.get("/api/health");
  expect(healthResponse.ok()).toBe(true);
  const healthBody = await healthResponse.text();
  const health = JSON.parse(healthBody);
  expect(health).toMatchObject({
    appRevision: process.env.APP_REVISION ?? "unit00-e2e",
    schemaRevision: DATABASE_SCHEMA_REVISION,
    service: "ukiebook-web",
    status: "ok",
    unit: "UNIT-00",
  });

  await page.goto("/fixtures/aurora");
  const fixture = page.locator("main");
  await expect(fixture).toHaveAttribute("data-baseline-id", AURORA_BASELINE_ID);
  await expect(fixture).toHaveAttribute(
    "data-target-bundle-hash",
    AURORA_TARGET_BUNDLE_HASH,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Aurora Pastel 7b foundation" }),
  ).toBeVisible();

  const button = page.getByRole("button", { name: "Основна дія" });
  await button.focus();
  await expect(button).toBeFocused();
  const targetSize = await button.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { height: rectangle.height, width: rectangle.width };
  });
  expect(targetSize.height).toBeGreaterThanOrEqual(44);
  expect(targetSize.width).toBeGreaterThanOrEqual(44);

  await page.waitForLoadState("networkidle");
  expect(browserErrors).toEqual([]);
  const responseBodies = (await Promise.all(responseBodyPromises)).filter(
    (response): response is { url: string; body: string } => response !== null,
  );

  const browserSurface = [
    await page.content(),
    healthBody,
    ...responseBodies.map(({ body }) => body),
  ].join("\n");
  for (const marker of forbiddenBrowserMarkers) {
    expect(browserSurface, `browser response contains ${marker}`).not.toContain(marker);
  }

  if (evidenceDirectory) {
    const evidenceRoot = path.resolve(evidenceDirectory);
    const architectureTarget = path.join(
      evidenceRoot,
      "evidence/architecture/web-runtime-identity.json",
    );
    const securityTarget = path.join(
      evidenceRoot,
      "evidence/security/browser-secret-boundary.json",
    );
    await mkdir(path.dirname(architectureTarget), { recursive: true });
    await mkdir(path.dirname(securityTarget), { recursive: true });
    await writeFile(
      architectureTarget,
      `${JSON.stringify(
        {
          identity: health,
          status: "passed",
          verified_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      securityTarget,
      `${JSON.stringify(
        {
          browser_errors: browserErrors,
          checked_response_urls: responseBodies.map(({ url }) => url),
          forbidden_marker_categories: [
            "sentinel",
            "server-bundle-marker",
            "environment-key",
          ],
          status: "passed",
          verified_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
});
