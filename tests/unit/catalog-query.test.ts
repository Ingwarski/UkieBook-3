import { describe, expect, it } from "vitest";

import {
  catalogQueryHref,
  normalizeCatalogQuery,
} from "../../modules/catalog/query";

describe("UNIT-02 catalog query", () => {
  it("normalizes safe composable URL state", () => {
    expect(
      normalizeCatalogQuery({
        discounted: "1",
        genre: "PROZA",
        page: "3",
        q: "  Ірина   Верес  ",
        sort: "price_asc",
      }),
    ).toEqual({
      discountedOnly: true,
      genre: "proza",
      page: 3,
      q: "Ірина Верес",
      sort: "price_asc",
    });
  });

  it("falls back from invalid and unbounded values", () => {
    expect(
      normalizeCatalogQuery({
        discounted: "yes",
        genre: "../private",
        page: "-2",
        sort: "drop_table",
      }),
    ).toEqual({
      discountedOnly: false,
      genre: null,
      page: 1,
      q: null,
      sort: "featured",
    });
    expect(normalizeCatalogQuery({ page: "999999" }).page).toBe(10_000);
  });

  it("serializes only non-default state and resets pagination for filter changes", () => {
    const current = normalizeCatalogQuery({
      page: "4",
      q: "сад",
      sort: "title",
    });
    expect(
      catalogQueryHref(
        current,
        { discountedOnly: true },
        { anchor: "catalog-results", resetPage: true },
      ),
    ).toBe("/?q=%D1%81%D0%B0%D0%B4&discounted=1&sort=title#catalog-results");
    expect(catalogQueryHref(normalizeCatalogQuery({}), {})).toBe("/");
  });
});
