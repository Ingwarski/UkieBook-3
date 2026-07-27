import type { ReactNode } from "react";

import { PublicHeader } from "../catalog/public-header";
import type { CommerceViewerModel } from "./types";

import styles from "./commerce.module.css";

interface CommerceShellProps {
  readonly children: ReactNode;
  readonly currentPage?: "cart";
  readonly viewer: CommerceViewerModel;
}

export function CommerceShell({
  children,
  currentPage,
  viewer,
}: CommerceShellProps) {
  return (
    <main className={styles.commercePage}>
      <div className={styles.commerceTop}>
        <PublicHeader currentPage={currentPage} viewer={viewer} />
      </div>
      <div className={styles.commerceContent}>{children}</div>
    </main>
  );
}
