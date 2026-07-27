import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CheckoutRedirectScreen } from "../../../components/commerce";
import {
  commerceRuntime,
  getCartCount,
  loadPaymentRedirect,
} from "../../../modules/commerce/server";
import { currentSessionContext } from "../../../modules/identity/server/next-session";
import {
  cartIdentity,
  currentAnonymousCartToken,
} from "../../commerce-request";
import { readServerEnvironment } from "../../../modules/platform/environment/server";

export const metadata: Metadata = {
  title: "Переходимо до оплати",
  description: "Безпечний перехід на платіжну сторінку mono.",
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

interface CheckoutRedirectPageProps {
  readonly searchParams: Promise<{
    hold?: string | string[];
    paymentSession?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CheckoutRedirectPage({
  searchParams,
}: CheckoutRedirectPageProps) {
  const session = await currentSessionContext();
  const query = await searchParams;
  const paymentSessionId = first(query.paymentSession);
  if (!session) {
    const returnTo = paymentSessionId
      ? `/checkout/redirect?paymentSession=${encodeURIComponent(paymentSessionId)}`
      : "/cart";
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!paymentSessionId) notFound();

  const commerce = commerceRuntime();
  const payment = await loadPaymentRedirect(commerce.database, {
    buyerUserId: session.session.userId,
    paymentSessionId,
  }).catch(() => null);
  if (!payment) notFound();
  const anonymousToken = await currentAnonymousCartToken();
  const cartCount = await getCartCount(
    commerce.database,
    cartIdentity(session, anonymousToken),
  ).catch(() => 0);

  return (
    <CheckoutRedirectScreen
      autoRedirect={
        !(
          first(query.hold) === "1" &&
          readServerEnvironment().APP_ENV === "test"
        )
      }
      checkoutUrl={payment.checkoutUrl}
      viewer={{
        cartCount,
        isAuthor: session.session.roles.includes("author"),
        signedIn: true,
      }}
    />
  );
}
