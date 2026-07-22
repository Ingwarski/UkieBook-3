import { Funnel, Star } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { catalogQueryHref } from "../../modules/catalog/query";
import type { BookCatalogReadModel, CatalogBookSummary } from "../../modules/catalog/types";

import { BookCover } from "./book-cover";
import { FormulaRibbon } from "./formula-ribbon";
import { CatalogPagination } from "./pagination";
import { PublicHeader, type PublicHeaderViewer } from "./public-header";
import styles from "./catalog.module.css";

const shelfTransforms = [
  { offset: "-6px", rotation: "-2deg" },
  { offset: "-14px", rotation: "-2deg" },
  { offset: "-30px", rotation: "-3deg" },
  { offset: "10px", rotation: "2deg" },
  { offset: "18px", rotation: "3deg" },
] as const;

interface CatalogScreenProps {
  readonly errorMessage?: string;
  readonly model: BookCatalogReadModel;
  readonly viewer: PublicHeaderViewer;
}

function bookCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} книжок`;
  if (last === 1) return `${count} книжка`;
  if (last >= 2 && last <= 4) return `${count} книжки`;
  return `${count} книжок`;
}

function Price({ book }: { readonly book: CatalogBookSummary }) {
  return book.price.discount ? (
    <span className={styles.priceCluster}>
      <del>{book.price.formattedBasePrice}</del>
      <strong>{book.price.formattedActualPrice}</strong>
    </span>
  ) : (
    <strong>{book.price.formattedActualPrice}</strong>
  );
}

function CatalogFilters({ model }: { readonly model: BookCatalogReadModel }) {
  const form = (
    <form action="/" className={styles.filtersForm} method="get">
      {model.query.q ? <input name="q" type="hidden" value={model.query.q} /> : null}
      <label>
        <span>Жанр</span>
        <select defaultValue={model.query.genre ?? ""} name="genre">
          <option value="">Усі жанри</option>
          {model.genres.map((genre) => (
            <option key={genre.slug} value={genre.slug}>
              {genre.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.discountControl}>
        <input defaultChecked={model.query.discountedOnly} name="discounted" type="checkbox" value="1" />
        <span>Зі знижкою</span>
      </label>
      <label>
        <span>Сортування</span>
        <select defaultValue={model.query.sort} name="sort">
          <option value="featured">Рекомендовані</option>
          <option value="title">За назвою</option>
          <option value="price_asc">Спершу дешевші</option>
          <option value="price_desc">Спершу дорожчі</option>
        </select>
      </label>
      <button className={styles.applyFilters} type="submit">
        Застосувати
      </button>
    </form>
  );
  return (
    <>
      <div className={styles.desktopFilters}>{form}</div>
      <details className={styles.mobileFilters}>
        <summary>
          <Funnel aria-hidden="true" size={19} /> Фільтри й сортування
        </summary>
        {form}
      </details>
    </>
  );
}

export function CatalogScreen({ errorMessage, model, viewer }: CatalogScreenProps) {
  return (
    <main className={styles.catalogPage}>
      <div className={styles.auroraRegion}>
        <PublicHeader currentPage="catalog" query={model.query} viewer={viewer} />
        <section aria-labelledby="catalog-hero-title" className={styles.hero}>
          <h1 id="catalog-hero-title">
            Затишні вечори
            <br />
            <span>з українською книжкою</span>
          </h1>
          <p>EPUB і MOBI одразу в бібліотеку. 65,8% — автору.</p>
        </section>

        <section aria-label="Вибір редакції" className={styles.shelf}>
          {model.featuredShelf.map((book, index) => {
            const transform = shelfTransforms[index] ?? shelfTransforms[0];
            return (
              <a
                aria-label={`${book.title}, ${book.author.publicName}`}
                className={styles.shelfCoverLink}
                href={`/books/${book.id}`}
                key={book.id}
                style={
                  {
                    "--cover-offset": transform.offset,
                    "--cover-rotation": transform.rotation,
                  } as React.CSSProperties
                }
              >
                <BookCover book={book} priority variant="shelf" />
              </a>
            );
          })}
        </section>
      </div>

      <section aria-label="Популярні книжки" className={styles.featuredTiles}>
        {model.featuredTiles.map((book) => (
          <a
            aria-label={`${book.title}, ${book.author.publicName}, ${book.price.formattedActualPrice}`}
            className={styles.featuredTile}
            href={`/books/${book.id}`}
            key={book.id}
          >
            <BookCover book={book} variant="tile" />
            <span className={styles.tileMetadata}>
              <strong>{book.title}</strong>
              <span>{book.author.publicName}</span>
              <strong>{book.price.formattedActualPrice}</strong>
            </span>
          </a>
        ))}
      </section>

      <FormulaRibbon />

      <section aria-labelledby="results-title" className={styles.catalogResults} id="catalog-results">
        <header className={styles.resultsHeader} id="catalog-filters">
          <div>
            <p className={styles.eyebrow}>Каталог</p>
            <h2 id="results-title">
              {model.query.q ? `Результати для «${model.query.q}»` : "Знайдіть наступну книжку"}
            </h2>
            <p>{bookCountLabel(model.pagination.totalItems)}</p>
          </div>
          {model.query.q || model.query.genre || model.query.discountedOnly ? (
            <Link className={styles.resetLink} href="/#catalog-results">
              Скинути все
            </Link>
          ) : null}
        </header>
        <CatalogFilters model={model} />

        {errorMessage ? (
          <div className={styles.resultsNotice} role="alert">
            <h3>Не вдалося завантажити каталог</h3>
            <p>{errorMessage}</p>
            <a href={catalogQueryHref(model.query, {}, { anchor: "catalog-results" })}>
              Спробувати ще раз
            </a>
          </div>
        ) : model.results.length === 0 ? (
          <div className={styles.resultsNotice}>
            <h3>Нічого не знайдено</h3>
            <p>Спробуйте іншу назву, автора або скиньте фільтри.</p>
            <Link href="/#catalog-results">Скинути фільтри</Link>
          </div>
        ) : (
          <div className={styles.resultsGrid}>
            {model.results.map((book) => (
              <article className={styles.resultCard} key={book.id}>
                <a aria-label={`${book.title}, ${book.author.publicName}`} href={`/books/${book.id}`}>
                  <BookCover book={book} variant="result" />
                </a>
                <div className={styles.resultMetadata}>
                  <p>{book.genre.name}</p>
                  <h3>
                    <a href={`/books/${book.id}`}>{book.title}</a>
                  </h3>
                  <span>{book.author.publicName}</span>
                  <span className={styles.ratingLine}>
                    <Star aria-hidden="true" size={16} weight="fill" />
                    {book.rating.average?.toLocaleString("uk-UA") ?? "—"} · {book.rating.count}
                  </span>
                  <Price book={book} />
                </div>
              </article>
            ))}
          </div>
        )}

        {!errorMessage ? (
          <CatalogPagination
            page={model.pagination.page}
            query={model.query}
            totalPages={model.pagination.totalPages}
          />
        ) : null}
      </section>
    </main>
  );
}
