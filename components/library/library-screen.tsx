import { ArrowSquareOut, DownloadSimple, Star } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import type { LibraryItemReadModel, LibraryReadModel } from "../../modules/library/types";
import type { PublicHeaderViewer } from "../catalog/public-header";
import { PublicHeader } from "../catalog/public-header";

import { RefundRequestDialog } from "./refund-request-dialog";
import styles from "./library.module.css";

interface LibraryScreenProps {
  readonly csrfToken: string;
  readonly downloads: Readonly<Record<string, Partial<Record<"epub" | "mobi", string>>>>;
  readonly library: LibraryReadModel;
  readonly viewer: PublicHeaderViewer;
  readonly refundResult?: string;
}

function status(item: LibraryItemReadModel): string {
  if (item.entitlementStatus === "refunded") return "Повернення схвалено";
  if (item.refundStatus === "pending") return "Заявку на повернення розглядають";
  if (item.refundStatus === "declined") return "У поверненні відмовлено";
  if (item.refundStatus === "approved") return "Повернення схвалено";
  return "У вашій бібліотеці";
}

function reviewAction(item: LibraryItemReadModel): string {
  if (item.reviewStatus === "pending_moderation") return "Відгук на модерації";
  if (item.reviewStatus === "published") return "Відгук опубліковано";
  if (item.reviewStatus === "not_published") return "Відгук не опубліковано";
  return "Залишити відгук";
}

function LibraryItem({
  csrfToken,
  downloads,
  item,
}: {
  readonly csrfToken: string;
  readonly downloads: Partial<Record<"epub" | "mobi", string>>;
  readonly item: LibraryItemReadModel;
}) {
  const canRequestRefund = item.entitlementStatus === "active" && item.refundStatus === null;
  const reviewHref = `/books/${item.bookId}#reviews`;
  return (
    <article className={styles.libraryItem}>
      <div className={styles.coverFrame}>
        <Image
          alt={`${item.title} — ${item.authorPublicName}`}
          className={styles.coverImage}
          height={174}
          src={item.coverPath}
          width={116}
        />
      </div>
      <div className={styles.itemBody}>
        <p className={styles.eyebrow}>{status(item)}</p>
        <h2>{item.title}</h2>
        <p className={styles.author}>{item.authorPublicName}</p>
        {item.entitlementStatus === "active" ? (
          <div className={styles.fileActions} aria-label={`Файли ${item.title}`}>
            {downloads.epub ? (
              <a className={styles.downloadAction} href={downloads.epub}>
                <DownloadSimple aria-hidden="true" size={18} /> EPUB
              </a>
            ) : null}
            {downloads.mobi ? (
              <a className={styles.downloadAction} href={downloads.mobi}>
                <DownloadSimple aria-hidden="true" size={18} /> MOBI
              </a>
            ) : null}
          </div>
        ) : (
          <p className={styles.refundedNotice}>Файли більше не доступні після схваленого повернення.</p>
        )}
        <div className={styles.itemFooter}>
          <Link className={styles.reviewAction} href={reviewHref}>
            <Star aria-hidden="true" size={17} /> {reviewAction(item)}
          </Link>
          {canRequestRefund ? (
            <RefundRequestDialog csrfToken={csrfToken} entitlementId={item.id} />
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function LibraryScreen({
  csrfToken,
  downloads,
  library,
  viewer,
  refundResult,
}: LibraryScreenProps) {
  return (
    <main className={styles.libraryPage}>
      <div className={styles.auroraHeader}>
        <PublicHeader viewer={viewer} />
      </div>
      <section className={styles.libraryContent} aria-labelledby="library-title">
        <p className={styles.eyebrow}>Покупки</p>
        <h1 id="library-title">Бібліотека</h1>
        <p className={styles.intro}>
          Ваші придбані книжки. EPUB і MOBI завжди мають однаковий пріоритет.
        </p>
        {refundResult === "submitted" ? (
          <p className={styles.notice} role="status">Заявку на повернення надіслано Менеджеру.</p>
        ) : null}
        {library.items.length ? (
          <div className={styles.libraryList}>
            {library.items.map((item) => (
              <LibraryItem
                csrfToken={csrfToken}
                downloads={downloads[item.id] ?? {}}
                item={item}
                key={item.id}
              />
            ))}
          </div>
        ) : (
          <section className={styles.emptyState}>
            <h2>Тут ще немає книжок</h2>
            <p>Після успішної покупки книжка зʼявиться тут автоматично.</p>
            <Link href="/">Перейти до каталогу <ArrowSquareOut aria-hidden="true" size={16} /></Link>
          </section>
        )}
      </section>
    </main>
  );
}
