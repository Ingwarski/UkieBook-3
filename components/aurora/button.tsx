import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./aurora.module.css";

export type AuroraButtonVariant = "primary" | "secondary" | "danger";

export interface AuroraButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  children: ReactNode;
  variant?: AuroraButtonVariant;
}

export function AuroraButton({
  busy = false,
  children,
  className,
  disabled,
  type = "button",
  variant = "primary",
  ...props
}: AuroraButtonProps) {
  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
      disabled={disabled || busy}
      type={type}
    >
      {busy ? <span aria-hidden="true" className={styles.spinner} /> : null}
      <span className={styles.buttonContent}>{children}</span>
    </button>
  );
}
