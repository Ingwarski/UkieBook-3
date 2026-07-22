import type { CatalogQuery, CatalogSort } from "./types";

export const CATALOG_PAGE_SIZE = 4;

export const DEFAULT_CATALOG_QUERY: CatalogQuery = {
  discountedOnly: false,
  genre: null,
  page: 1,
  q: null,
  sort: "featured",
};

const sorts = new Set<CatalogSort>([
  "featured",
  "title",
  "price_asc",
  "price_desc",
]);

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function normalizeSearch(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 120);
  return normalized || null;
}

function normalizeGenre(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("uk-UA");
  return /^[a-z0-9-]{1,64}$/u.test(normalized) ? normalized : null;
}

function normalizePage(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1;
}

export function normalizeCatalogQuery(
  input: Record<string, string | readonly string[] | undefined>,
): CatalogQuery {
  const sortCandidate = first(input.sort) as CatalogSort | undefined;
  return {
    discountedOnly: ["1", "true", "on"].includes(first(input.discounted) ?? ""),
    genre: normalizeGenre(first(input.genre)),
    page: normalizePage(first(input.page)),
    q: normalizeSearch(first(input.q)),
    sort: sortCandidate && sorts.has(sortCandidate) ? sortCandidate : "featured",
  };
}

export function catalogQueryHref(
  current: CatalogQuery,
  patch: Partial<CatalogQuery>,
  options: { readonly anchor?: string; readonly resetPage?: boolean } = {},
): string {
  const query: CatalogQuery = {
    ...current,
    ...patch,
    page: options.resetPage ? 1 : (patch.page ?? current.page),
  };
  const parameters = new URLSearchParams();
  if (query.q) parameters.set("q", query.q);
  if (query.genre) parameters.set("genre", query.genre);
  if (query.discountedOnly) parameters.set("discounted", "1");
  if (query.sort !== "featured") parameters.set("sort", query.sort);
  if (query.page !== 1) parameters.set("page", String(query.page));
  const serialized = parameters.toString();
  const anchor = options.anchor ? `#${options.anchor}` : "";
  return `${serialized ? `/?${serialized}` : "/"}${anchor}`;
}
