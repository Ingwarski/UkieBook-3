import { ArrowLeft, ShoppingCartSimple, Star } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import type { BookPageReadModel } from "../../modules/catalog/types";

import { BookCover } from "./book-cover";
import { PublicHeader, type PublicHeaderViewer } from "./public-header";
import styles from "./catalog.module.css";

interface BookPageScreenProps {
  readonly book: BookPageReadModel;
  readonly sampleOpen?: boolean;
  readonly viewer: PublicHeaderViewer;
}

function ukrainianDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function ratingCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} оцінок`;
  if (last === 1) return `${count} оцінка`;
  if (last >= 2 && last <= 4) return `${count} оцінки`;
  return `${count} оцінок`;
}

function ReviewPagination({ book }: { readonly book: BookPageReadModel }) {
  if (book.reviews.totalPages <= 1) return null;
  return (
    <nav aria-label="Сторінки відгуків" className={styles.reviewPagination}>
      {book.reviews.page > 1 ? (
        <a href={`/books/${book.id}?reviews=${book.reviews.page - 1}#reviews`} rel="prev">
          Попередні
        </a>
      ) : null}
      <span>
        {book.reviews.page} / {book.reviews.totalPages}
      </span>
      {book.reviews.page < book.reviews.totalPages ? (
        <a href={`/books/${book.id}?reviews=${book.reviews.page + 1}#reviews`} rel="next">
          Наступні
        </a>
      ) : null}
    </nav>
  );
}

export function BookPageScreen({ book, sampleOpen = false, viewer }: BookPageScreenProps) {
  const available = book.availability === "available";
  const cartHref = viewer.signedIn
    ? `/cart?add=${encodeURIComponent(book.id)}`
    : `/login?returnTo=${encodeURIComponent(`/cart?add=${book.id}`)}`;
  return (
    <main className={styles.bookPage}>
      <div className={styles.bookAuroraHeader}>
        <PublicHeader viewer={viewer} />
        <Link className={styles.backToCatalog} href="/">
          <ArrowLeft aria-hidden="true" size={18} /> До каталогу
        </Link>
      </div>

      <article className={styles.bookArticle}>
        <section className={styles.bookHero}>
          <div className={styles.bookOverview}>
            <p className={styles.eyebrow}>{book.genre.name}</p>
            <h1>{book.title}</h1>
            <p className={styles.bookAuthor}>Автор · {book.author.publicName}</p>
            <p className={styles.detailRating}>
              <Star aria-hidden="true" size={20} weight="fill" />
              <strong>{book.rating.average?.toLocaleString("uk-UA") ?? "—"}</strong>
              <span>{ratingCountLabel(book.rating.count)}</span>
            </p>

            {available && book.price ? (
              <div className={styles.detailPurchase}>
                {book.price.discount ? (
                  <>
                    <span className={styles.discountBadge}>{book.price.discount.label}</span>
                    <div className={styles.detailPrice}>
                      <del>{book.price.formattedBasePrice}</del>
                      <strong>{book.price.formattedActualPrice}</strong>
                    </div>
                    <p>
                      Знижка діє до {ukrainianDate(book.price.discount.endsAt)}
                    </p>
                  </>
                ) : (
                  <p className={styles.detailPrice}>
                    <strong>{book.price.formattedActualPrice}</strong>
                  </p>
                )}
                <a className={styles.primaryCta} href={cartHref}>
                  <ShoppingCartSimple aria-hidden="true" size={20} /> Додати в кошик
                </a>
                <a className={styles.secondaryCta} href={`/books/${book.id}?sample=1#sample`}>
                  Читати фрагмент
                </a>
              </div>
            ) : (
              <div className={styles.unavailableNotice} role="status">
                <strong>Книжка недоступна</strong>
                <p>Її більше не можна придбати. Сторінку збережено як архівну.</p>
              </div>
            )}
          </div>
          <div className={styles.detailCoverWrap}>
            <BookCover book={book} priority variant="detail" />
          </div>
        </section>

        <section aria-labelledby="description-title" className={styles.bookSection}>
          <p className={styles.eyebrow}>Про книжку</p>
          <h2 id="description-title">Опис</h2>
          <details className={styles.descriptionDisclosure} open>
            <summary>Повний опис книжки</summary>
            <p className={styles.descriptionText}>{book.description}</p>
          </details>
        </section>

        {available ? (
          <details className={styles.sampleSection} id="sample" open={sampleOpen}>
            <summary>Читати безкоштовний фрагмент</summary>
            <div className={styles.sampleReader}>
              <p className={styles.eyebrow}>Безкоштовний фрагмент</p>
              <h2>{book.freeSample.title}</h2>
              {book.freeSample.blocks.map((block, index) =>
                block.kind === "heading" ? (
                  <h3 key={`${block.kind}-${index}`}>{block.text}</h3>
                ) : (
                  <p key={`${block.kind}-${index}`}>{block.text}</p>
                ),
              )}
            </div>
          </details>
        ) : null}

        <section aria-labelledby="reviews-title" className={styles.bookSection} id="reviews">
          <div className={styles.reviewsHeading}>
            <div>
              <p className={styles.eyebrow}>Думки читачів</p>
              <h2 id="reviews-title">Відгуки</h2>
            </div>
            <span>{book.reviews.totalItems}</span>
          </div>
          {book.reviews.items.length ? (
            <div className={styles.reviewList}>
              {book.reviews.items.map((review) => (
                <article className={styles.review} key={review.id}>
                  <header>
                    <strong>{review.reviewerName}</strong>
                    <span aria-label={`${review.rating} із 5`}>
                      <Star aria-hidden="true" size={17} weight="fill" /> {review.rating}
                    </span>
                  </header>
                  <p>{review.text}</p>
                  <time dateTime={review.publishedAt}>{ukrainianDate(review.publishedAt)}</time>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.noReviews}>Відгуків ще немає. Ця тиха полиця чекає першого читача.</p>
          )}
          <ReviewPagination book={book} />
          <aside className={styles.reviewSlot}>
            <strong>Придбали книжку?</strong>
            <p>Форма відгуку зʼявиться тут після підтвердженої покупки.</p>
          </aside>
        </section>
      </article>

    </main>
  );
}
