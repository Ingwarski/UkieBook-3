import { BookOpenText, Plus } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import { AuroraStatusBadge, type AuroraStatusTone } from "../aurora";
import type { AuthorBookListItem } from "../../modules/publishing/types";
import { createDraftAction } from "../../app/author/publish/actions";

import { AuthorShell } from "./author-shell";
import { PublishingSubmitButton } from "./publishing-submit-button";
import { publishingDraftResumeHref } from "./resume-href";
import styles from "./publishing.module.css";

interface AuthorBooksScreenProps {
  readonly books: readonly AuthorBookListItem[];
  readonly csrfToken: string;
  readonly error?: string;
  readonly submitted?: boolean;
}

function effectiveStatus(book: AuthorBookListItem): { readonly label: string; readonly tone: AuroraStatusTone } {
  if (book.status === "draft") {
    if (book.draftStatus === "converting") return { label: "Конвертується", tone: "info" };
    if (book.draftStatus === "conversion_failed") return { label: "Потрібна увага", tone: "error" };
    return { label: "Чернетка", tone: "info" };
  }
  if (book.status === "submitted") return { label: "На модерації", tone: "info" };
  if (book.status === "manual_review") return { label: "На ручній перевірці", tone: "warning" };
  if (book.status === "rejected") return { label: "Відхилено", tone: "error" };
  return { label: "Опубліковано", tone: "success" };
}

function NewBookForm({ csrfToken }: { readonly csrfToken: string }) {
  return (
    <form action={createDraftAction}>
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <PublishingSubmitButton><Plus aria-hidden="true" size={18} /> Опублікувати нову книжку</PublishingSubmitButton>
    </form>
  );
}

export function AuthorBooksScreen({ books, csrfToken, error, submitted }: AuthorBooksScreenProps) {
  return (
    <AuthorShell active="books" csrfToken={csrfToken}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Кабінет автора</p>
          <h1>Мої книжки</h1>
          <p>Чернетки, подані версії та їхній поточний стан — в одному спокійному місці.</p>
        </div>
        <NewBookForm csrfToken={csrfToken} />
      </header>
      {submitted ? <div className={styles.notice} role="status">Книжку подано. Вона вже має статус «На модерації».</div> : null}
      {error ? <div className={[styles.notice, styles.noticeError].join(" ")} role="alert">Не вдалося виконати дію. Оновіть сторінку й спробуйте ще раз.</div> : null}
      {books.length === 0 ? (
        <section className={[styles.panel, styles.emptyState].join(" ")}>
          <div>
            <span aria-hidden="true" className={styles.emptyIcon}><BookOpenText size={30} /></span>
            <h2>Опублікуйте першу книжку</h2>
            <p>Завантажте рукопис, перевірте готове видання та подайте його на модерацію.</p>
            <NewBookForm csrfToken={csrfToken} />
          </div>
        </section>
      ) : (
        <section aria-label="Книжки автора" className={[styles.panel, styles.bookList].join(" ")}>
          {books.map((book) => {
            const status = effectiveStatus(book);
            const resumeHref = publishingDraftResumeHref(book);
            return (
              <article className={styles.bookRow} key={book.id}>
                {book.coverUrl ? (
                  <Image alt={`${book.title} — обкладинка`} className={styles.bookThumb} height={108} src={book.coverUrl} unoptimized width={72} />
                ) : (
                  <span aria-hidden="true" className={styles.bookPlaceholder}><BookOpenText size={26} /></span>
                )}
                <div className={styles.bookMeta}>
                  <h2>{book.title}</h2>
                  <p>Оновлено {new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(book.updatedAt))}</p>
                  {book.rejectionCategory ? <p>Категорія причини: {book.rejectionCategory}</p> : null}
                </div>
                <AuroraStatusBadge label={status.label} tone={status.tone} />
                <div className={styles.rowAction}>
                  {resumeHref ? (
                    <Link className={styles.secondaryLink} href={resumeHref}>Продовжити</Link>
                  ) : (
                    <span className={styles.salesMeta}>{book.salesCount === null ? "Очікує наступного етапу" : `${book.salesCount} продажів`}</span>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </AuthorShell>
  );
}
