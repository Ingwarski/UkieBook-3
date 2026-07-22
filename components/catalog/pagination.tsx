import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { catalogQueryHref } from "../../modules/catalog/query";
import type { CatalogQuery } from "../../modules/catalog/types";

import styles from "./catalog.module.css";

interface CatalogPaginationProps {
  readonly page: number;
  readonly query: CatalogQuery;
  readonly totalPages: number;
}
export function CatalogPagination({ page, query, totalPages }: CatalogPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Сторінки каталогу" className={styles.pagination}>
      {page > 1 ? (
        <a
          href={catalogQueryHref(query, { page: page - 1 }, { anchor: "catalog-results" })}
          rel="prev"
        >
          <ArrowLeft aria-hidden="true" size={18} /> Попередня
        </a>
      ) : (
        <span aria-disabled="true">
          <ArrowLeft aria-hidden="true" size={18} /> Попередня
        </span>
      )}
      <p aria-live="polite">
        Сторінка <strong>{page}</strong> із {totalPages}
      </p>
      {page < totalPages ? (
        <a
          href={catalogQueryHref(query, { page: page + 1 }, { anchor: "catalog-results" })}
          rel="next"
        >
          Наступна <ArrowRight aria-hidden="true" size={18} />
        </a>
      ) : (
        <span aria-disabled="true">
          Наступна <ArrowRight aria-hidden="true" size={18} />
        </span>
      )}
    </nav>
  );
}
