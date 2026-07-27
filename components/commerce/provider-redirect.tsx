"use client";

import { useEffect } from "react";

interface ProviderRedirectProps {
  readonly autoRedirect?: boolean;
  readonly checkoutUrl: string;
}

export function ProviderRedirect({
  autoRedirect = true,
  checkoutUrl,
}: ProviderRedirectProps) {
  useEffect(() => {
    if (!autoRedirect) return;
    window.location.replace(checkoutUrl);
  }, [autoRedirect, checkoutUrl]);

  return (
    <a href={checkoutUrl} rel="noreferrer">
      Відкрити захищену сторінку mono
    </a>
  );
}
