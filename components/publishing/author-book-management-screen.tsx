import { ArrowLeft, BookOpenText, Storefront } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import type { AuthorBookManagementReadModel } from "../../modules/moderation/types";
import { AuroraStatusBadge } from "../aurora";

import { AuthorShell } from "./author-shell";
import { authorBookStatusPresentation } from "./book-status";
import styles from "./publishing.module.css";

interface AuthorBookManagementScreenProps {
  readonly book: AuthorBookManagementReadModel;
  readonly csrfToken: string;
}

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function lifecycleCopy(book: AuthorBookManagementReadModel): string {
  if (book.status === "submitted") {
    return "Книжку подано. Триває перевірка перед публікацією.";
  }
  if (book.status === "manual_review") {
    return "Книжка потребує перевірки менеджером. Результат зʼявиться тут.";
  }
  if (book.status === "rejected") {
    return "Книжка не пройшла перевірку. Нижче вказано коротку категорію причини.";
  }
  if (book.status === "unavailable") {
    return "Книжка більше не продається. Уже придбані файли залишаються в бібліотеках покупців.";
  }
  return "Книжка опублікована й доступна в Каталозі.";
}

export function AuthorBookManagementScreen({
  book,
  csrfToken,
}: AuthorBookManagementScreenProps) {
  const status = authorBookStatusPresentation(book.status);
  return (
    <AuthorShell active="books" csrfToken={csrfToken}>
      <Link className={styles.managementBack} href="/author/books">
        <ArrowLeft aria-hidden="true" size={18} /> До моїх книжок
      </Link>

      <header className={styles.managementHeading}>
        <p className={styles.eyebrow}>Керування книжкою</p>
        <h1>{book.title}</h1>
        <p>Поточний стан публікації та результат перевірки.</p>
      </header>

      <section aria-labelledby="book-state-title" className={[styles.panel, styles.managementOverview].join(" ")}>
        {book.coverUrl ? (
          <Image
            alt={`${book.title} — ${book.authorPublicName}`}
            className={styles.managementCover}
            height={198}
            priority
            src={book.coverUrl}
            unoptimized
            width={132}
          />
        ) : (
          <span aria-hidden="true" className={styles.managementCoverPlaceholder}>
            <BookOpenText size={34} />
          </span>
        )}
        <div className={styles.managementState}>
          <div className={styles.managementStatusLine}>
            <h2 id="book-state-title">Стан книжки</h2>
            <AuroraStatusBadge label={status.label} tone={status.tone} />
          </div>
          <p>{lifecycleCopy(book)}</p>
          <p className={styles.managementUpdated}>
            Оновлено {formattedDate(book.updatedAt)}
          </p>

          {book.reasonCategory ? (
            <section aria-labelledby="reason-category-title" className={styles.reasonCategory}>
              <h3 id="reason-category-title">Категорія причини</h3>
              <p>{book.reasonCategory.label}</p>
            </section>
          ) : null}

          <div className={styles.managementActions}>
            {book.publicHref ? (
              <Link className={styles.secondaryLink} href={book.publicHref}>
                <Storefront aria-hidden="true" size={18} /> Переглянути сторінку книжки
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </AuthorShell>
  );
}
