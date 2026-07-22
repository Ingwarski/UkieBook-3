import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../../db/migrate";
import { adaptPGlite } from "../../db/pglite";
import { findBookPage, searchCatalog } from "../../modules/catalog/server/repository";
import type { CatalogQuery } from "../../modules/catalog/types";
import type { SqlDatabase } from "../../modules/platform/sql-port";

const now = new Date("2026-07-22T10:00:00.000Z");
const defaultQuery: CatalogQuery = {
  discountedOnly: false,
  genre: null,
  page: 1,
  q: null,
  sort: "featured",
};

describe("UNIT-02 catalog PostgreSQL read model", () => {
  let pglite: PGlite;
  let database: SqlDatabase;

  beforeEach(async () => {
    pglite = await PGlite.create();
    database = adaptPGlite(pglite);
    await applyMigrations(database);
    await database.query(
      "INSERT INTO catalog_genres (slug, label) VALUES ('proza', 'Проза'), ('istoriia', 'Історія')",
    );
    for (const book of [
      {
        author: "Ірина Верес",
        discount: 21_000,
        genre: "proza",
        id: "11111111-1111-4111-8111-111111111111",
        price: 25_000,
        rank: 1,
        title: "Сад 100% птахів",
      },
      {
        author: "Тарас Білик",
        discount: null,
        genre: "istoriia",
        id: "22222222-2222-4222-8222-222222222222",
        price: 26_500,
        rank: 2,
        title: "Хроніки степу",
      },
      {
        author: "Ірина Лісова",
        discount: 12_000,
        genre: "proza",
        id: "33333333-3333-4333-8333-333333333333",
        price: 15_000,
        rank: 3,
        title: "Тихий дім",
      },
      {
        author: "Марко Яворський",
        discount: null,
        genre: "proza",
        id: "44444444-4444-4444-8444-444444444444",
        price: 17_500,
        rank: 4,
        title: "Архівна книжка",
      },
    ] as const) {
      const unavailable = book.title === "Архівна книжка";
      await database.query(
        `
          INSERT INTO catalog_book_read_models (
            book_id, title, author_public_id, author_public_name, genre_slug,
            description, sample_title, sample_blocks, cover_path, cover_theme,
            base_price_kopiykas, discount_price_kopiykas, discount_starts_at,
            discount_ends_at, availability, catalog_rank, rating_average, rating_count
          )
          VALUES (
            $1, $2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $3, $4,
            'Публічний опис', 'Фрагмент', '[{"kind":"paragraph","text":"Текст"}]',
            '/books/covers/khroniky-stepu.png', 'teal', $5, $6,
            CASE WHEN $6::int IS NULL THEN NULL ELSE '2026-07-01T00:00:00Z'::timestamptz END,
            CASE WHEN $6::int IS NULL THEN NULL ELSE '2026-08-01T00:00:00Z'::timestamptz END,
            $7, $8, 4.8, 10
          )
        `,
        [
          book.id,
          book.title,
          book.author,
          book.genre,
          book.price,
          book.discount,
          unavailable ? "unavailable" : "published",
          book.rank,
        ],
      );
    }
    await database.query(
      `
        INSERT INTO catalog_featured_slots (section, position, book_id)
        VALUES
          ('shelf', 1, '11111111-1111-4111-8111-111111111111'),
          ('tile', 1, '22222222-2222-4222-8222-222222222222')
      `,
    );
    for (let index = 1; index <= 4; index += 1) {
      await database.query(
        `
          INSERT INTO catalog_review_read_models (
            review_id, book_id, reviewer_public_name, rating, review_text, published_at
          ) VALUES ($1, $2, $3, 5, $4, $5)
        `,
        [
          `90000000-0000-4000-8000-00000000000${index}`,
          "11111111-1111-4111-8111-111111111111",
          `Читач ${index}`,
          `Відгук ${index}`,
          `2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`,
        ],
      );
    }
  });

  afterEach(async () => {
    await database.close?.();
  });

  it("composes title/Author/Genre/active-Discount filters literally", async () => {
    const author = await searchCatalog(database, { ...defaultQuery, q: "Ірина" }, now);
    expect(author.results.map((book) => book.title)).toEqual([
      "Сад 100% птахів",
      "Тихий дім",
    ]);
    const literal = await searchCatalog(database, { ...defaultQuery, q: "%" }, now);
    expect(literal.results.map((book) => book.title)).toEqual(["Сад 100% птахів"]);
    const combined = await searchCatalog(
      database,
      { ...defaultQuery, discountedOnly: true, genre: "proza", q: "дім" },
      now,
    );
    expect(combined.results).toHaveLength(1);
    expect(combined.results[0]?.price.actualPriceKopiykas).toBe(12_000);
  });

  it("uses deterministic sorting and page state", async () => {
    const priced = await searchCatalog(
      database,
      { ...defaultQuery, sort: "price_asc" },
      now,
    );
    expect(priced.results.map((book) => book.title)).toEqual([
      "Тихий дім",
      "Сад 100% птахів",
      "Хроніки степу",
    ]);
    expect(priced.featuredShelf).toHaveLength(1);
    expect(priced.featuredTiles).toHaveLength(1);
    expect(priced.pagination).toMatchObject({ page: 1, totalItems: 3 });
  });

  it("keeps known unavailable books renderable but out of public search", async () => {
    const catalog = await searchCatalog(database, defaultQuery, now);
    expect(catalog.results.some((book) => book.title === "Архівна книжка")).toBe(false);
    const unavailable = await findBookPage(
      database,
      "44444444-4444-4444-8444-444444444444",
      { asOf: now, reviewsPage: 1 },
    );
    expect(unavailable).toMatchObject({ availability: "unavailable", price: null });
  });

  it("paginates public reviews and never widens public Author data", async () => {
    const page = await findBookPage(
      database,
      "11111111-1111-4111-8111-111111111111",
      { asOf: now, reviewsPage: 2 },
    );
    expect(page?.reviews).toMatchObject({ page: 2, totalItems: 4, totalPages: 2 });
    expect(page?.reviews.items).toHaveLength(1);
    expect(Object.keys(page?.author ?? {}).sort()).toEqual(["id", "publicName"]);
    expect(JSON.stringify(page)).not.toMatch(/email|payout|moderation/iu);
  });
});
