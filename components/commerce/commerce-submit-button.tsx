"use client";

import { CircleNotch, Trash } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { AuroraButton, type AuroraButtonVariant } from "../aurora";

import styles from "./commerce.module.css";

interface CommerceSubmitButtonProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly pendingLabel: string;
  readonly variant?: AuroraButtonVariant;
}

export function CommerceSubmitButton({
  children,
  className,
  disabled = false,
  pendingLabel,
  variant = "primary",
}: CommerceSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <AuroraButton
      busy={pending}
      className={className}
      disabled={disabled}
      type="submit"
      variant={variant}
    >
      {pending ? pendingLabel : children}
    </AuroraButton>
  );
}

export function CommerceRemoveButton({
  disabled = false,
  title,
}: {
  readonly disabled?: boolean;
  readonly title: string;
}) {
  const { pending } = useFormStatus();
  const label = pending
    ? `Видаляємо «${title}» з кошика`
    : `Видалити «${title}» з кошика`;

  return (
    <button
      aria-busy={pending || undefined}
      aria-label={label}
      className={styles.removeButton}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? (
        <CircleNotch aria-hidden="true" className={styles.removeSpinner} size={20} />
      ) : (
        <Trash aria-hidden="true" size={20} />
      )}
    </button>
  );
}
