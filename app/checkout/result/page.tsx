import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  CheckoutResultScreen,
  type CheckoutResultState,
} from "../../../components/commerce";
import { formatUah } from "../../../modules/catalog/price";
import {
  commerceRuntime,
  getCartCount,
  loadCheckoutResult,
} from "../../../modules/commerce/server";
import { currentSessionContext } from "../../../modules/identity/server/next-session";
import {
  cartIdentity,
  currentAnonymousCartToken,
} from "../../commerce-request";

export const metadata: Metadata = {
  title: "Результат оплати",
  description: "Підтвердження стану покупки книжок.",
};

export const dynamic = "force-dynamic";

interface CheckoutResultPageProps {
  readonly searchParams: Promise<{
    order?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resultState(
  orderStatus: "cancelled" | "paid" | "payment_failed" | "payment_pending",
): CheckoutResultState {
  if (orderStatus === "paid") return "success";
  if (orderStatus === "payment_failed" || orderStatus === "cancelled") {
    return "failure";
  }
  return "pending";
}

export default async function CheckoutResultPage({
  searchParams,
}: CheckoutResultPageProps) {
  const orderId = first((await searchParams).order);
  const session = await currentSessionContext();
  if (!session) {
    const returnTo = orderId
      ? `/checkout/result?order=${encodeURIComponent(orderId)}`
      : "/cart";
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!orderId) notFound();

  const commerce = commerceRuntime();
  const result = await loadCheckoutResult(commerce.database, {
    buyerUserId: session.session.userId,
    orderId,
  }).catch(() => null);
  if (!result) notFound();
  const anonymousToken = await currentAnonymousCartToken();
  const cartCount = await getCartCount(
    commerce.database,
    cartIdentity(session, anonymousToken),
  ).catch(() => 0);

  return (
    <CheckoutResultScreen
      model={{
        cartCount,
        emailStatus: result.emailStatus,
        failureMessage: result.failureMessage ?? undefined,
        formattedTotal: result.formattedTotal,
        isAuthor: session.session.roles.includes("author"),
        items: result.items.map((item) => ({
          authorName: item.authorPublicName,
          bookId: item.bookId,
          coverSrc: item.coverPath,
          formattedActualPrice: formatUah(item.unitPriceKopiykas),
          formattedBasePrice: formatUah(item.unitPriceKopiykas),
          title: item.title,
        })),
        refreshHref: `/checkout/result?order=${encodeURIComponent(result.orderId)}`,
        signedIn: true,
        state: resultState(result.orderStatus),
      }}
    />
  );
}
