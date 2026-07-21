import type { ReactNode } from "react";

import { IdentityNotice, IdentityShell } from "./identity-shell";
import {
  OAuthProviderButton,
  type OAuthProvider,
} from "./oauth-provider-button";
import styles from "./identity.module.css";

const defaultLegalNotice =
  "Продовжуючи, ви погоджуєтеся з умовами користування та політикою конфіденційності UkieBook.";

export interface LoginScreenProps {
  error?: string;
  facebookAction: string;
  googleAction: string;
  homeHref?: string;
  intent?: "author" | "default";
  legalNotice?: ReactNode;
  pendingProvider?: OAuthProvider;
  returnTo: string;
  returnHref: string;
  returnLabel?: string;
}

export function LoginScreen({
  error,
  facebookAction,
  googleAction,
  homeHref,
  intent = "default",
  legalNotice = defaultLegalNotice,
  pendingProvider,
  returnTo,
  returnHref,
  returnLabel = "Повернутися назад",
}: LoginScreenProps) {
  const pendingProviderName =
    pendingProvider === "google"
      ? "Google"
      : pendingProvider === "facebook"
        ? "Facebook"
        : undefined;

  return (
    <IdentityShell
      description="Вхід потрібен для покупки чи публікації"
      headingId="identity-login-title"
      homeHref={homeHref}
      title="Вхід"
    >
      {error ? <IdentityNotice tone="error">{error}</IdentityNotice> : null}

      <div className={styles.providerStack}>
        <OAuthProviderButton
          action={googleAction}
          busy={pendingProvider === "google"}
          intent={intent}
          provider="google"
          returnTo={returnTo}
        />
        <OAuthProviderButton
          action={facebookAction}
          busy={pendingProvider === "facebook"}
          intent={intent}
          provider="facebook"
          returnTo={returnTo}
        />
      </div>

      {pendingProviderName ? (
        <p aria-live="polite" className={styles.pendingMessage} role="status">
          Відкриваємо безпечний вхід через {pendingProviderName}…
        </p>
      ) : null}

      <p className={styles.legalNotice}>{legalNotice}</p>
      <a className={styles.returnLink} href={returnHref}>
        {returnLabel}
      </a>
    </IdentityShell>
  );
}
