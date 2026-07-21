import { OAuthSubmitControl } from "./form-submit-controls";
import styles from "./identity.module.css";

export type OAuthProvider = "facebook" | "google";

const providerLabels: Record<OAuthProvider, string> = {
  facebook: "Увійти через Facebook",
  google: "Увійти через Google",
};

export interface OAuthProviderButtonProps {
  action: string;
  busy?: boolean;
  intent: "author" | "default";
  provider: OAuthProvider;
  returnTo: string;
}

export function OAuthProviderButton({
  action,
  busy = false,
  intent,
  provider,
  returnTo,
}: OAuthProviderButtonProps) {
  const label = providerLabels[provider];

  return (
    <form action={action} className={styles.providerForm} method="post">
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="intent" type="hidden" value={intent} />
      <OAuthSubmitControl forcedBusy={busy} label={label} provider={provider} />
    </form>
  );
}
