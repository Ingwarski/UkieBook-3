"use client";

import { useEffect, useRef } from "react";

import styles from "./publishing.module.css";

export function PublishingErrorNotice({ message }: { readonly message: string }) {
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    noticeRef.current?.focus();
  }, []);

  return (
    <div
      className={[styles.notice, styles.noticeError].join(" ")}
      ref={noticeRef}
      role="alert"
      tabIndex={-1}
    >
      {message}
    </div>
  );
}
