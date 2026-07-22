import {
  CATALOG_BOOK_FIXTURES,
  CATALOG_FEATURED_SHELF_IDS,
  CATALOG_FEATURED_TILE_IDS,
  CATALOG_GENRE_FIXTURES,
  type CatalogFixtureBook,
} from "./fixtures";
import { CATALOG_PAGE_SIZE } from "./query";
import { presentPrice } from "./price";
import {
  CATALOG_READ_MODEL_SCHEMA_VERSION,
  type BookCatalogReadModel,
  type CatalogBookSummary,
  type CatalogQuery,
} from "./types";

function toSummary(book: CatalogFixtureBook, asOf: Date): CatalogBookSummary {
  return {
    author: { id: book.authorId, publicName: book.authorName },
    cover: {
      alt: `${book.title} — ${book.authorName}`,
      src: book.coverPath,
      theme: book.coverTheme,
    },
    genre: {
      name:
        CATALOG_GENRE_FIXTURES.find((genre) => genre.slug === book.genreSlug)?.label ??
        book.genreSlug,
      slug: book.genreSlug,
    },
    id: book.id,
    price: presentPrice(
      {
        basePriceKopiykas: book.basePriceKopiykas,
        discountEndsAt: book.discountEndsAt,
        discountPriceKopiykas: book.discountPriceKopiykas,
        discountStartsAt: book.discountStartsAt,
      },
      asOf,
    ),
    rating: { average: book.ratingAverage, count: book.ratingCount },
    title: book.title,
  };
}
/** Keeps the locked merchandising shell visible while a read-store error is shown inline. */
export function catalogFixtureShell(
  query: CatalogQuery,
  asOf = new Date(),
): BookCatalogReadModel {
  const byId = new Map(
    CATALOG_BOOK_FIXTURES.map((book) => [book.id, toSummary(book, asOf)]),
  );
  return {
    featuredShelf: CATALOG_FEATURED_SHELF_IDS.flatMap((id) => {
      const book = byId.get(id);
      return book ? [book] : [];
    }),
    featuredTiles: CATALOG_FEATURED_TILE_IDS.flatMap((id) => {
      const book = byId.get(id);
      return book ? [book] : [];
    }),
    genres: CATALOG_GENRE_FIXTURES.map((genre) => ({
      name: genre.label,
      slug: genre.slug,
    })),
    pagination: {
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      totalItems: 0,
      totalPages: 1,
    },
    query: { ...query, page: 1 },
    results: [],
    schemaVersion: CATALOG_READ_MODEL_SCHEMA_VERSION,
  };
}
