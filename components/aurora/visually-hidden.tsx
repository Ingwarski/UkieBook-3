import type { HTMLAttributes, ReactNode } from "react";

import styles from "./aurora.module.css";

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function VisuallyHidden({ children, className, ...props }: VisuallyHiddenProps) {
  return (
    <span {...props} className={[styles.visuallyHidden, className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
