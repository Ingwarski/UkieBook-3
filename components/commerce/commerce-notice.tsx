"use client";

import { useEffect, useRef } from "react";

import styles from "./commerce.module.css";

interface CommerceNoticeProps {
  readonly children: string;
  readonly tone: "error" | "success";
}

export function CommerceNotice({ children, tone }: CommerceNoticeProps) {
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tone === "error") noticeRef.current?.focus();
  }, [tone]);

  return (
    <div
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={[styles.notice, styles[`${tone}Notice`]].join(" ")}
      ref={noticeRef}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={tone === "error" ? -1 : undefined}
    >
      {children}
    </div>
  );
}
