"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import styles from "./publishing.module.css";

export function PreviewPending() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [router]);
  return (
    <section aria-live="polite" className={[styles.panel, styles.pendingState].join(" ")}>
      <div>
        <span aria-hidden="true" className={styles.pendingOrb} />
        <h2>Готуємо видання…</h2>
        <p>Перетворюємо рукопис на адаптивну книжку, EPUB і MOBI. Можна безпечно залишити цю сторінку — чернетка збережена.</p>
      </div>
    </section>
  );
}
