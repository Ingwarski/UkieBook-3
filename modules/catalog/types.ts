export const CATALOG_READ_MODEL_SCHEMA_VERSION = 1 as const;

export type IsoTimestamp = string;

export type CatalogSort =
  | "featured"
  | "title"
  | "price_asc"
  | "price_desc";

export interface CatalogQuery {
  readonly q: string | null;
  readonly genre: string | null;
  readonly discountedOnly: boolean;
  readonly sort: CatalogSort;
  readonly page: number;
}
export type CoverTheme =
  | "teal"
  | "mustard"
  | "cobalt"
  | "coral"
  | "violet"
  | "indigo";

export interface PricePresentation {
  readonly currency: "UAH";
  readonly basePriceKopiykas: number;
  readonly actualPriceKopiykas: number;
  readonly formattedBasePrice: string;
  readonly formattedActualPrice: string;
  readonly discount: null | {
    readonly startsAt: IsoTimestamp;
    readonly endsAt: IsoTimestamp;
    readonly label: string;
  };
}

export interface CatalogBookSummary {
  readonly id: string;
  readonly title: string;
  readonly author: {
    readonly id: string;
    readonly publicName: string;
  };
  readonly genre: {
    readonly slug: string;
    readonly name: string;
  };
  readonly cover: {
    readonly src: string;
    readonly alt: string;
    readonly theme: CoverTheme;
  };
  readonly price: PricePresentation;
  readonly rating: {
    readonly average: number | null;
    readonly count: number;
  };
}

export interface BookCatalogReadModel {
  readonly schemaVersion: typeof CATALOG_READ_MODEL_SCHEMA_VERSION;
  readonly query: CatalogQuery;
  readonly featuredShelf: readonly CatalogBookSummary[];
  readonly featuredTiles: readonly CatalogBookSummary[];
  readonly genres: readonly {
    readonly slug: string;
    readonly name: string;
  }[];
  readonly results: readonly CatalogBookSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly totalItems: number;
    readonly totalPages: number;
  };
}

export interface PublicReviewReadModel {
  readonly id: string;
  readonly reviewerName: string;
  readonly rating: number;
  readonly text: string;
  readonly publishedAt: IsoTimestamp;
}

export interface BookPageReadModel {
  readonly schemaVersion: typeof CATALOG_READ_MODEL_SCHEMA_VERSION;
  readonly availability: "available" | "unavailable";
  readonly id: string;
  readonly title: string;
  readonly author: {
    readonly id: string;
    readonly publicName: string;
  };
  readonly genre: {
    readonly slug: string;
    readonly name: string;
  };
  readonly description: string;
  readonly cover: {
    readonly src: string;
    readonly alt: string;
    readonly theme: CoverTheme;
  };
  readonly price: PricePresentation | null;
  readonly rating: {
    readonly average: number | null;
    readonly count: number;
  };
  readonly freeSample: {
    readonly title: string;
    readonly blocks: readonly {
      readonly kind: "heading" | "paragraph";
      readonly text: string;
    }[];
  };
  readonly reviews: {
    readonly items: readonly PublicReviewReadModel[];
    readonly page: number;
    readonly totalPages: number;
    readonly totalItems: number;
  };
}
