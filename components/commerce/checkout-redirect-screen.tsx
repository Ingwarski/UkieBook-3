import { CircleNotch, LockKey } from "@phosphor-icons/react/dist/ssr";

import { AuroraGlassSurface } from "../aurora";
import { CommerceShell } from "./commerce-shell";
import { ProviderRedirect } from "./provider-redirect";
import type { CommerceViewerModel } from "./types";

import styles from "./commerce.module.css";

export interface CheckoutRedirectScreenProps {
  readonly autoRedirect?: boolean;
  readonly checkoutUrl: string;
  readonly viewer: CommerceViewerModel;
}

export function CheckoutRedirectScreen({
  autoRedirect = true,
  checkoutUrl,
  viewer,
}: CheckoutRedirectScreenProps) {
  return (
    <CommerceShell viewer={viewer}>
      <AuroraGlassSurface
        aria-labelledby="checkout-redirect-title"
        as="section"
        className={styles.redirectPanel}
      >
        <div
          aria-live="polite"
          className={styles.redirectStatus}
          role="status"
        >
          <CircleNotch
            aria-hidden="true"
            className={styles.redirectSpinner}
            size={48}
          />
          <p className={styles.eyebrow}>Захищена оплата</p>
          <h1 id="checkout-redirect-title">Переходимо до оплати…</h1>
          <p>
            <LockKey aria-hidden="true" size={18} />
            Оплата відбудеться на сторінці mono. UkieBook не отримує дані картки.
          </p>
        </div>
        <div className={styles.providerRedirectLink}>
          <ProviderRedirect
            autoRedirect={autoRedirect}
            checkoutUrl={checkoutUrl}
          />
        </div>
      </AuroraGlassSurface>
    </CommerceShell>
  );
}
