"use client";

import Image from "next/image";
import { useFormStatus } from "react-dom";

import { AuroraButton } from "../aurora";
import styles from "./identity.module.css";

export function OAuthSubmitControl({
  forcedBusy = false,
  label,
  provider,
}: {
  readonly forcedBusy?: boolean;
  readonly label: string;
  readonly provider: "facebook" | "google";
}) {
  const { pending } = useFormStatus();
  const busy = forcedBusy || pending;

  return (
    <button
      aria-busy={busy || undefined}
      aria-label={label}
      className={[styles.providerButton, styles[provider]].join(" ")}
      data-provider={provider}
      disabled={busy}
      type="submit"
    >
      {provider === "google" ? (
        <Image
          alt=""
          aria-hidden="true"
          className={styles.providerIcon}
          height="20"
          src="/brand/google-g.png"
          unoptimized
          width="20"
        />
      ) : null}
      <span className={styles.providerLabel}>{label}</span>
      {busy ? (
        <span aria-hidden="true" className={styles.providerProgress}>
          …
        </span>
      ) : null}
    </button>
  );
}

export function AuthorProfileSubmitControl({
  forcedBusy = false,
}: {
  readonly forcedBusy?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <AuroraButton
      busy={forcedBusy || pending}
      className={styles.submitButton}
      type="submit"
    >
      Зберегти
    </AuroraButton>
  );
}
