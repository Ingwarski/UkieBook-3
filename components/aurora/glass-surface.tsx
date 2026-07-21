import type { HTMLAttributes, ReactNode } from "react";

import styles from "./aurora.module.css";

export interface AuroraGlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: "article" | "div" | "section";
  children: ReactNode;
}

export function AuroraGlassSurface({
  as: Component = "div",
  children,
  className,
  ...props
}: AuroraGlassSurfaceProps) {
  return (
    <Component {...props} className={[styles.surface, className].filter(Boolean).join(" ")}>
      {children}
    </Component>
  );
}
