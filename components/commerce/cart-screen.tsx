import { ArrowLeft, LockKey, ShoppingBagOpen } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import { AuroraGlassSurface } from "../aurora";
import { CommerceNotice } from "./commerce-notice";
import { CommerceShell } from "./commerce-shell";
import {
  CommerceRemoveButton,
  CommerceSubmitButton,
} from "./commerce-submit-button";
import type {
  CartScreenModel,
  CommerceBookItemViewModel,
} from "./types";

import styles from "./commerce.module.css";

export interface CartScreenProps {
  readonly checkoutAction?: string;
  readonly loginHref?: string;
  readonly model: CartScreenModel;
  readonly removeAction?: string;
}

function CartPrice({ item }: { readonly item: CommerceBookItemViewModel }) {
  const discounted =
    Boolean(item.discountLabel) &&
    item.formattedActualPrice !== item.formattedBasePrice;

  return (
    <div className={styles.priceCluster}>
      {discounted ? (
        <>
          <span className={styles.discountLabel}>{item.discountLabel}</span>
          <del>{item.formattedBasePrice}</del>
        </>
      ) : null}
      <strong>{item.formattedActualPrice}</strong>
    </div>
  );
}

function CartItem({
  editable,
  csrfToken,
  item,
  removeAction,
}: {
  readonly editable: boolean;
  readonly csrfToken?: string;
  readonly item: CommerceBookItemViewModel;
  readonly removeAction: string;
}) {
  return (
    <li className={styles.cartRow}>
      <Link
        aria-label={`${item.title}, ${item.authorName}`}
        className={styles.coverLink}
        href={`/books/${encodeURIComponent(item.bookId)}`}
      >
        <Image
          alt={`${item.title}, ${item.authorName}`}
          className={styles.cartCover}
          height={108}
          src={item.coverSrc}
          width={72}
        />
      </Link>
      <div className={styles.itemIdentity}>
        <h2>
          <Link href={`/books/${encodeURIComponent(item.bookId)}`}>
            {item.title}
          </Link>
        </h2>
        <p>Автор · {item.authorName}</p>
      </div>
      <CartPrice item={item} />
      <form action={removeAction} className={styles.removeForm} method="post">
        <input name="bookId" type="hidden" value={item.bookId} />
        <input name="intent" type="hidden" value="remove" />
        <input name="returnTo" type="hidden" value="/cart" />
        {csrfToken ? (
          <input name="csrfToken" type="hidden" value={csrfToken} />
        ) : null}
        <CommerceRemoveButton disabled={!editable} title={item.title} />
      </form>
    </li>
  );
}

export function CartScreen({
  checkoutAction = "/api/checkout/start",
  loginHref = "/login?returnTo=%2Fcart%3Fstep%3Dcheckout",
  model,
  removeAction = "/api/cart/items/remove",
}: CartScreenProps) {
  const viewer = {
    cartCount: model.cartCount,
    isAuthor: model.isAuthor,
    signedIn: model.signedIn,
  };

  return (
    <CommerceShell currentPage="cart" viewer={viewer}>
      <header className={styles.pageHeading}>
        <p className={styles.eyebrow}>Ваш вибір</p>
        <h1>Кошик</h1>
        <p>Перевірте книжки й оплатіть їх одним платежем.</p>
      </header>

      {model.errorMessage ? (
        <CommerceNotice tone="error">{model.errorMessage}</CommerceNotice>
      ) : null}
      {model.noticeMessage ? (
        <CommerceNotice tone="success">{model.noticeMessage}</CommerceNotice>
      ) : null}

      {model.items.length === 0 ? (
        <AuroraGlassSurface
          aria-labelledby="empty-cart-title"
          as="section"
          className={styles.emptyState}
        >
          <ShoppingBagOpen aria-hidden="true" size={40} weight="duotone" />
          <h2 id="empty-cart-title">Кошик порожній</h2>
          <p>Знайдіть книжку до настрою — сюди можна додати кілька видань.</p>
          <Link className={styles.primaryLink} href="/">
            До каталогу
          </Link>
        </AuroraGlassSurface>
      ) : (
        <div className={styles.cartLayout}>
          <AuroraGlassSurface
            aria-labelledby="cart-items-title"
            as="section"
            className={styles.cartPanel}
          >
            <div className={styles.sectionHeading}>
              <h2 id="cart-items-title">Книжки</h2>
              <span>{model.cartCount}</span>
            </div>
            <ul className={styles.cartList}>
              {model.items.map((item) => (
                <CartItem
                  csrfToken={model.csrfToken}
                  editable={model.cartEditable}
                  item={item}
                  key={item.bookId}
                  removeAction={removeAction}
                />
              ))}
            </ul>
            <Link className={styles.continueLink} href="/">
              <ArrowLeft aria-hidden="true" size={18} /> Продовжити покупки
            </Link>
          </AuroraGlassSurface>

          <AuroraGlassSurface
            aria-labelledby="cart-total-title"
            as="section"
            className={styles.summaryPanel}
            role="complementary"
          >
            <div className={styles.totalLine}>
              <h2 id="cart-total-title">Разом</h2>
              <strong>{model.formattedTotal}</strong>
            </div>

            {model.signedIn ? (
              <>
                <p className={styles.providerNote}>
                  <LockKey aria-hidden="true" size={19} />
                  Ви перейдете на захищену сторінку mono. UkieBook не зберігає
                  дані картки.
                </p>
                {model.checkoutBlockReason ? (
                  <p className={styles.authNote}>
                    {model.checkoutBlockReason}
                  </p>
                ) : null}
                <form action={checkoutAction} className={styles.checkoutForm} method="post">
                  <input name="returnTo" type="hidden" value="/checkout/result" />
                  {model.csrfToken ? (
                    <input name="csrfToken" type="hidden" value={model.csrfToken} />
                  ) : null}
                  <CommerceSubmitButton
                    className={styles.checkoutButton}
                    disabled={!model.checkoutAllowed}
                    pendingLabel="Переходимо до оплати…"
                  >
                    Оплатити
                  </CommerceSubmitButton>
                </form>
              </>
            ) : (
              <>
                <p className={styles.authNote}>Для оплати увійдіть через Google або Facebook.</p>
                <Link className={styles.primaryLink} href={loginHref}>
                  Оплатити
                </Link>
              </>
            )}
          </AuroraGlassSurface>
        </div>
      )}
    </CommerceShell>
  );
}
