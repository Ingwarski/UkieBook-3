import { describe, expect, it } from "vitest";

import { coverTitleLines } from "../../modules/publishing/server/service";

describe("fallback cover title fitting", () => {
  it("keeps a short title intact", () => {
    expect(coverTitleLines("Ніч над Дніпром")).toEqual([
      "Ніч над Дніпром",
      "",
      "",
    ]);
  });

  it("bounds a long title to three fitted lines with an ellipsis", () => {
    const lines = coverTitleLines(
      "Надзвичайно довга назва української книжки, яка не повинна виходити за межі обкладинки",
    );

    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/…$/u);
    for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(18);
  });

  it("splits an unbroken long word without overflowing", () => {
    const lines = coverTitleLines("супердовгесловобезжодногопробілуякетребапомістити");

    expect(lines.every((line) => Array.from(line).length <= 18)).toBe(true);
    expect(lines.every(Boolean)).toBe(true);
  });
});
