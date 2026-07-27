import type { Metadata } from "next";

import { CartScreen, type CartScreenModel } from "../../components/commerce";
import { formatUah } from "../../modules/catalog/price";
import {
  commerceRuntime,
  loadCart,
} from "../../modules/commerce/server";
import { currentSessionContext } from "../../modules/identity/server/next-session";
import {
  cartIdentity,
  currentAnonymousCartToken,
} from "../commerce-request";

export const metadata: Metadata = {
  title: "Кошик",
  description: "Книжки, вибрані для однієї захищеної оплати.",
};

export const dynamic = "force-dynamic";

interface CartPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const cartErrors: Readonly<Record<string, string>> = {
  book_unavailable: "Ця книжка зараз недоступна для купівлі.",
  cart_checkout_pending: "Поточна оплата ще не завершена.",
  cart_update_failed: "Не вдалося оновити кошик. Спробуйте ще раз.",
  payment_start_failed:
    "Не вдалося відкрити платіжну сторінку. Кошик збережено.",
  payment_start_pending:
    "Стан створення платежу уточнюється. Кошик збережено; не починайте нову оплату.",
  request_rejected: "Запит відхилено. Оновіть сторінку й спробуйте ще раз.",
};

function discountLabel(base: number, actual: number): string | null {
  if (base <= 0 || actual >= base) return null;
  return `−${Math.round(((base - actual) / base) * 100)}%`;
}

export default async function CartPage({ searchParams }: CartPageProps) {
  const query = await searchParams;
  const [sessionResult, tokenResult] = await Promise.allSettled([
    currentSessionContext(),
    currentAnonymousCartToken(),
  ]);
  const session =
    sessionResult.status === "fulfilled" ? sessionResult.value : null;
  const anonymousToken =
    tokenResult.status === "fulfilled" ? tokenResult.value : undefined;

  let cart: Awaited<ReturnType<typeof loadCart>> = null;
  let loadFailed = sessionResult.status === "rejected";
  try {
    const runtime = commerceRuntime();
    cart = await loadCart(
      runtime.database,
      cartIdentity(session, anonymousToken),
    );
  } catch {
    loadFailed = true;
  }

  const errorCode = first(query.error);
  const noticeMessage =
    first(query.added) === "1"
      ? "Книжку додано до кошика."
      : first(query.removed) === "1"
        ? "Книжку видалено з кошика."
        : first(query.step) === "checkout" && session
          ? "Вхід завершено. Тепер можна перейти до оплати."
          : undefined;

  const model: CartScreenModel = {
    cartCount: cart?.items.length ?? 0,
    cartEditable: cart?.status === "active",
    checkoutAllowed: cart?.checkoutAllowed ?? false,
    checkoutBlockReason:
      cart && !cart.checkoutAllowed && cart.items.length > 0
        ? cart.status === "checkout_pending"
          ? "Поточна оплата вже очікує підтвердження. Новий платіж тимчасово недоступний."
          : cart.items.some((item) => !item.available)
            ? "Видаліть недоступні книжки, щоб перейти до оплати."
            : "Цей кошик зараз не можна оплатити."
        : undefined,
    csrfToken: session?.csrfToken,
    errorMessage: loadFailed
      ? "Не вдалося завантажити кошик. Перевірте зʼєднання й повторіть спробу."
      : errorCode
        ? cartErrors[errorCode] ?? cartErrors.cart_update_failed
        : undefined,
    formattedTotal: cart?.formattedTotal ?? formatUah(0),
    isAuthor: session?.session.roles.includes("author") ?? false,
    items:
      cart?.items.map((item) => ({
        authorName: item.authorPublicName,
        bookId: item.bookId,
        coverSrc: item.coverPath,
        discountLabel: discountLabel(
          item.basePriceKopiykas,
          item.actualPriceKopiykas,
        ),
        formattedActualPrice: item.formattedActualPrice,
        formattedBasePrice: formatUah(item.basePriceKopiykas),
        title: item.title,
      })) ?? [],
    noticeMessage,
    signedIn: session !== null,
  };

  return (
    <CartScreen
      checkoutAction="/api/checkout/start"
      model={model}
      removeAction="/api/cart/items/remove"
    />
  );
}
