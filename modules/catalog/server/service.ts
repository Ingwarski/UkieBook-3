import "server-only";

import { productionDatabase } from "../../platform/server/database";
import type { BookCatalogReadModel, BookPageReadModel, CatalogQuery } from "../types";
import { findBookPage, searchCatalog } from "./repository";

export function loadCatalog(
  query: CatalogQuery,
  asOf = new Date(),
): Promise<BookCatalogReadModel> {
  return searchCatalog(productionDatabase(), query, asOf);
}
export function loadBookPage(
  bookId: string,
  options: { readonly asOf?: Date; readonly reviewsPage: number },
): Promise<BookPageReadModel | null> {
  return findBookPage(productionDatabase(), bookId, {
    asOf: options.asOf ?? new Date(),
    reviewsPage: options.reviewsPage,
  });
}
