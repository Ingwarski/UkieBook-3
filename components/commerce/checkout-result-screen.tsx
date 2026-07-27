import {
  ArrowClockwise,
  CheckCircle,
  ClockCountdown,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import { AuroraGlassSurface } from "../aurora";
import { CommerceNotice } from "./commerce-notice";
import { CommerceShell } from "./commerce-shell";
import type {
  CheckoutResultScreenModel,
  CommerceBookItemViewModel,
  PurchaseEmailStatus,
} from "./types";

import styles from "./commerce.module.css";

export interface CheckoutResultScreenProps {
  readonly cartHref?: string;
  readonly catalogHref?: string;
  readonly libraryHref?: string;
  readonly model: CheckoutResultScreenModel;
}

function EmailMessage({ status }: { readonly status?: PurchaseEmailStatus | null }) {
  switch (status) {
    case "sent":
      return "Підтвердження покупки надіслано на email.";
    case "failed":
      return "Лист не вдалося надіслати, але оплату підтверджено. Доступ не залежить від листа.";
    case "queued":
      return "Підтвердження покупки готується до надсилання на email.";
    default:
      return "Підтвердження покупки надійде на email.";
  }
}

function ResultItems({
  items,
  title,
}: {
  readonly items: readonly CommerceBookItemViewModel[];
  readonly title: string;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="checkout-books-title" className={styles.resultItems}>
      <h2 id="checkout-books-title">{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.bookId}>
            <Image
              alt={`${item.title}, ${item.authorName}`}
              className={styles.resultCover}
              height={78}
              src={item.coverSrc}
              width={52}
            />
            <span>
              <strong>{item.title}</strong>
              <small>{item.authorName}</small>
            </span>
            <strong className={styles.resultPrice}>
              {item.formattedActualPrice}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CheckoutResultScreen({
  cartHref = "/cart",
  catalogHref = "/",
  libraryHref = "/library",
  model,
}: CheckoutResultScreenProps) {
  const viewer = {
    cartCount: model.cartCount,
    isAuthor: model.isAuthor,
    signedIn: model.signedIn,
  };

  const resultCopy = {
    failure: {
      description: "Кошик збережено — можна повернутися й повторити оплату.",
      eyebrow: "Оплату не завершено",
      title: "Оплату не підтверджено",
    },
    pending: {
      description: "Очікуємо підтвердження від mono. Це може тривати кілька секунд.",
      eyebrow: "Перевіряємо платіж",
      title: "Оплата підтверджується",
    },
    success: {
      description: "Платіж отримано. Ваші книжки готові до наступного кроку.",
      eyebrow: "Покупка завершена",
      title: "Дякуємо за покупку",
    },
  } as const;
  const copy = resultCopy[model.state];

  return (
    <CommerceShell viewer={viewer}>
      <AuroraGlassSurface
        aria-labelledby="checkout-result-title"
        as="section"
        className={[styles.resultPanel, styles[`${model.state}Result`]].join(" ")}
      >
        <div aria-hidden="true" className={styles.resultIcon}>
          {model.state === "success" ? (
            <CheckCircle size={48} weight="duotone" />
          ) : model.state === "failure" ? (
            <WarningCircle size={48} weight="duotone" />
          ) : (
            <ClockCountdown size={48} weight="duotone" />
          )}
        </div>
        <header className={styles.resultHeading}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="checkout-result-title">{copy.title}</h1>
          <p
            aria-live={model.state === "pending" ? "polite" : undefined}
            role={model.state === "pending" ? "status" : undefined}
          >
            {copy.description}
          </p>
        </header>

        {model.state === "failure" ? (
          <CommerceNotice tone="error">
            {model.failureMessage ??
              "Оплату не завершено. Поверніться в кошик і спробуйте ще раз."}
          </CommerceNotice>
        ) : null}

        <ResultItems
          items={model.items}
          title={model.state === "failure" ? "Кошик збережено" : "Книжки в замовленні"}
        />

        {model.items.length > 0 ? (
          <div className={styles.resultTotal}>
            <span>Разом</span>
            <strong>{model.formattedTotal}</strong>
          </div>
        ) : null}

        {model.state === "success" ? (
          <>
            <p
              aria-live="polite"
              className={[
                styles.emailMessage,
                model.emailStatus === "failed"
                  ? styles.emailFailed
                  : model.emailStatus === "queued"
                    ? styles.emailQueued
                    : "",
              ].filter(Boolean).join(" ")}
              role="status"
            >
              <EmailMessage status={model.emailStatus} />
            </p>
            <div className={styles.resultActions}>
              <Link className={styles.primaryLink} href={libraryHref}>
                Перейти в бібліотеку
              </Link>
              <Link className={styles.secondaryLink} href={catalogHref}>
                До каталогу
              </Link>
            </div>
          </>
        ) : model.state === "failure" ? (
          <div className={styles.resultActions}>
            <Link className={styles.primaryLink} href={cartHref}>
              Повернутися в кошик
            </Link>
            <Link className={styles.secondaryLink} href={catalogHref}>
              До каталогу
            </Link>
          </div>
        ) : (
          <div className={styles.resultActions}>
            <a
              className={styles.primaryLink}
              href={model.refreshHref ?? "/checkout/result"}
            >
              <ArrowClockwise aria-hidden="true" size={18} />
              Перевірити стан
            </a>
            <Link className={styles.secondaryLink} href={cartHref}>
              До кошика
            </Link>
          </div>
        )}
      </AuroraGlassSurface>
    </CommerceShell>
  );
}
