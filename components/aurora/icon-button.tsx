import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./aurora.module.css";

export interface AuroraIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  "aria-label": string;
  children: ReactNode;
}

export function AuroraIconButton({
  "aria-label": accessibleLabel,
  children,
  className,
  type = "button",
  ...props
}: AuroraIconButtonProps) {
  return (
    <button
      {...props}
      aria-label={accessibleLabel}
      className={[styles.iconButton, className].filter(Boolean).join(" ")}
      type={type}
    >
      <span aria-hidden="true" className={styles.icon}>
        {children}
      </span>
    </button>
  );
}
