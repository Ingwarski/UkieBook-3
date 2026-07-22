"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

interface ModerationNoticeProps {
  readonly children: ReactNode;
  readonly className: string;
  readonly role: "alert" | "status";
}

export function ModerationNotice({
  children,
  className,
  role,
}: ModerationNoticeProps) {
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    noticeRef.current?.focus();
  }, []);
  return (
    <div className={className} ref={noticeRef} role={role} tabIndex={-1}>
      {children}
    </div>
  );
}
