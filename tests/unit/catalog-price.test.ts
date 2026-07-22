import { describe, expect, it } from "vitest";

import { formatUah, presentPrice } from "../../modules/catalog/price";

const price = {
  basePriceKopiykas: 25_000,
  discountEndsAt: "2026-08-01T00:00:00.000Z",
  discountPriceKopiykas: 21_000,
  discountStartsAt: "2026-07-01T00:00:00.000Z",
} as const;

describe("UNIT-02 price presentation", () => {
  it("formats only integer kopiykas as UAH", () => {
    expect(formatUah(21_000)).toBe("210 грн");
    expect(formatUah(21_050)).toBe("210,50 грн");
    expect(() => formatUah(21.5)).toThrow(/safe integer/u);
  });

  it("uses an inclusive start and exclusive end for a dated discount", () => {
    expect(presentPrice(price, new Date(price.discountStartsAt))).toMatchObject({
      actualPriceKopiykas: 21_000,
      discount: { label: "−16%" },
      formattedActualPrice: "210 грн",
    });
    expect(
      presentPrice(price, new Date("2026-07-31T23:59:59.999Z")).discount,
    ).not.toBeNull();
    expect(presentPrice(price, new Date(price.discountEndsAt))).toMatchObject({
      actualPriceKopiykas: 25_000,
      discount: null,
    });
  });

  it("ignores incomplete or non-lower discount data", () => {
    expect(
      presentPrice(
        { ...price, discountPriceKopiykas: 25_000 },
        new Date("2026-07-10T00:00:00.000Z"),
      ).discount,
    ).toBeNull();
    expect(
      presentPrice(
        {
          basePriceKopiykas: 20_000,
          discountEndsAt: null,
          discountPriceKopiykas: null,
          discountStartsAt: null,
        },
        new Date(),
      ).actualPriceKopiykas,
    ).toBe(20_000);
  });
});
