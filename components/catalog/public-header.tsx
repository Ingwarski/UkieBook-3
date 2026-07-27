import {
  Books,
  List,
  MagnifyingGlass,
  ShoppingCartSimple,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import { catalogQueryHref } from "../../modules/catalog/query";
import type { CatalogQuery } from "../../modules/catalog/types";

import styles from "./catalog.module.css";

export interface PublicHeaderViewer {
  readonly cartCount: number;
  readonly isAuthor: boolean;
  readonly signedIn: boolean;
}

interface PublicHeaderProps {
  readonly currentPage?: "cart" | "catalog";
  readonly query?: CatalogQuery;
  readonly viewer: PublicHeaderViewer;
}

function PrimaryLinks({
  currentPage,
  query,
}: {
  readonly currentPage?: "cart" | "catalog";
  readonly query?: CatalogQuery;
}) {
  const defaultQuery: CatalogQuery = query ?? {
    discountedOnly: false,
    genre: null,
    page: 1,
    q: null,
    sort: "featured",
  };
  return (
    <>
      <Link
        aria-current={currentPage === "catalog" ? "page" : undefined}
        href="/"
      >
        Каталог
      </Link>
      <a
        aria-current={query?.genre ? "location" : undefined}
        href={catalogQueryHref(defaultQuery, {}, { anchor: "catalog-filters" })}
      >
        Жанри
      </a>
      <a
        aria-current={query?.discountedOnly ? "location" : undefined}
        href={catalogQueryHref(
          defaultQuery,
          { discountedOnly: true },
          { anchor: "catalog-results", resetPage: true },
        )}
      >
        Знижки
      </a>
      <a href="/login?intent=author&amp;returnTo=%2Fauthor%2Fbooks">Авторам</a>
    </>
  );
}

function cartAccessibleLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 0) return "Кошик, порожній";
  if (lastTwo >= 11 && lastTwo <= 14) return `Кошик, ${count} книжок`;
  if (last === 1) return `Кошик, ${count} книжка`;
  if (last >= 2 && last <= 4) return `Кошик, ${count} книжки`;
  return `Кошик, ${count} книжок`;
}

export function PublicHeader({ currentPage, query, viewer }: PublicHeaderProps) {
  const cartCount = Number.isFinite(viewer.cartCount)
    ? Math.max(0, Math.floor(viewer.cartCount))
    : 0;
  return (
    <header className={styles.publicHeader}>
      <Link aria-label="UkieBook — головна" className={styles.brand} href="/">
        <Image
          alt=""
          aria-hidden="true"
          className={styles.brandMark}
          height={26}
          priority
          src="/brand/UkieBook-logo-transparent.svg"
          width={26}
        />
        <span className={styles.wordmark}>
          Ukie<strong>Book</strong>
        </span>
      </Link>

      <nav aria-label="Основна навігація" className={styles.desktopNavigation}>
        <PrimaryLinks currentPage={currentPage} query={query} />
      </nav>

      <div className={styles.headerActions}>
        <form action="/" className={styles.headerSearch} role="search">
          {query?.genre ? <input name="genre" type="hidden" value={query.genre} /> : null}
          {query?.discountedOnly ? <input name="discounted" type="hidden" value="1" /> : null}
          {query?.sort && query.sort !== "featured" ? (
            <input name="sort" type="hidden" value={query.sort} />
          ) : null}
          <MagnifyingGlass aria-hidden="true" className={styles.searchIcon} size={15} />
          <input
            aria-label="Пошук за назвою або автором"
            defaultValue={query?.q ?? ""}
            name="q"
            placeholder="Назва або автор…"
            type="search"
          />
          <button aria-label="Знайти" type="submit">
            <MagnifyingGlass aria-hidden="true" size={18} />
          </button>
        </form>

        <a
          aria-current={currentPage === "cart" ? "page" : undefined}
          aria-label={cartAccessibleLabel(cartCount)}
          className={styles.cartHitArea}
          href="/cart"
        >
          <span aria-hidden="true" className={styles.cartVisual}>
            <ShoppingCartSimple size={18} weight="regular" />
          </span>
          {cartCount > 0 ? (
            <span aria-hidden="true" className={styles.cartBadge}>
              {cartCount > 99 ? "99+" : cartCount}
            </span>
          ) : null}
        </a>

        {viewer.signedIn ? (
          <details className={styles.accountMenu}>
            <summary aria-label="Меню профілю">
              <UserCircle aria-hidden="true" size={22} />
            </summary>
            <div className={styles.accountPopover}>
              <a href="/library">
                <Books aria-hidden="true" size={18} /> Бібліотека
              </a>
              <a href={viewer.isAuthor ? "/author/books" : "/author/profile"}>
                <UserCircle aria-hidden="true" size={18} />
                {viewer.isAuthor ? "Кабінет автора" : "Профіль"}
              </a>
            </div>
          </details>
        ) : null}

        <details className={styles.mobileMenu}>
          <summary aria-label="Відкрити меню">
            <List aria-hidden="true" size={22} />
          </summary>
          <nav aria-label="Мобільна навігація" className={styles.mobilePopover}>
            <form action="/" className={styles.mobileSearch} role="search">
              {query?.genre ? <input name="genre" type="hidden" value={query.genre} /> : null}
              {query?.discountedOnly ? (
                <input name="discounted" type="hidden" value="1" />
              ) : null}
              {query?.sort && query.sort !== "featured" ? (
                <input name="sort" type="hidden" value={query.sort} />
              ) : null}
              <MagnifyingGlass aria-hidden="true" size={17} />
              <input
                aria-label="Пошук за назвою або автором"
                defaultValue={query?.q ?? ""}
                name="q"
                placeholder="Назва або автор…"
                type="search"
              />
              <button aria-label="Знайти" type="submit">
                Знайти
              </button>
            </form>
            <PrimaryLinks currentPage={currentPage} query={query} />
            {viewer.signedIn ? (
              <>
                <a href="/library">Бібліотека</a>
                <a href={viewer.isAuthor ? "/author/books" : "/author/profile"}>
                  {viewer.isAuthor ? "Кабінет автора" : "Профіль"}
                </a>
              </>
            ) : (
              <a href="/login">Увійти</a>
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}
